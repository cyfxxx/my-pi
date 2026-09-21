/**
 * Voice Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-voice/{index,commands}.ts`（核心）。
 * 工具 voice_transcribe / voice_speak；命令 /voice；Ctrl+Alt+R；自动朗读钩子。
 * 未迁移（后续）：录音（termux/sox）、唤醒词、诊断基准、sherpa 服务脚本。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { registerCommand, registerShortcut, sendMessage, Key } from '../../adapters/ui-adapter';
import {
  loadConfig,
  persistConfig,
  speak,
  cleanForSpeech,
  isSpeechWorthy,
  createTtsDispatcher,
  extractAssistantText,
  transcribeByBackend,
  whisperStatus,
  whisperModel,
  whisperDevice,
  startRecording,
  stopRecording,
  queryRecording,
  convertToWav,
  cleanupStaleAudio,
  type VoiceConfig,
} from './logic';

let activeRecording: { file: string; startedAt: number } | null = null;

export function register(pi: ExtensionAPI): void {
  let cfg: VoiceConfig = loadConfig();
  let enabled = cfg.ttsEnabled;
  const refresh = (): void => {
    cfg = loadConfig();
  };
  const dispatcher = createTtsDispatcher({
    speakFn: (text) => speak(cfg, text),
    onError: (m) => console.error('[voice] TTS:', m),
  });

  // ── 工具：转写 ──
  registerTool(pi, {
    name: 'voice_transcribe',
    description: '将 Base64 编码的 WAV 音频转写为文字（调用 whisper/sherpa 本地服务）。',
    parameters: {
      audio: { type: 'string', description: 'WAV 音频数据的 Base64 编码' },
      language: { type: 'string', description: '语言代码（可选，默认配置）', optional: true },
    },
    execute: async (args) => {
      if (!args.audio) return '错误：缺少音频数据';
      refresh();
      const wavPath = join(cfg.tmpDir, `stt-${Date.now()}-${process.pid}.wav`);
      try {
        writeFileSync(wavPath, Buffer.from(args.audio as string, 'base64'));
      } catch (e) {
        return `写入音频失败: ${(e as Error).message}`;
      }
      const useCfg = args.language ? { ...cfg, language: args.language as string } : cfg;
      const r = await transcribeByBackend(useCfg, wavPath);
      if (r.error) return `转写失败: ${r.error}`;
      return r.text || '(未识别到语音)';
    },
  });

  // ── 工具：朗读 ──
  registerTool(pi, {
    name: 'voice_speak',
    description: '将文本通过本地 TTS 朗读。',
    parameters: { text: { type: 'string', description: '要朗读的文本' } },
    execute: async (args) => {
      if (!args.text) return '错误：缺少文本参数';
      refresh();
      if (!isSpeechWorthy(args.text as string)) return '(文本不适合朗读，已跳过)';
      const r = await speak(cfg, args.text as string);
      return r.code === 0 ? '语音播放完成' : `朗读失败: ${r.stderr || r.stdout}`;
    },
  });

  // ── 工具：录音会话 ──
  registerTool(pi, {
    name: 'voice_record',
    description: '录音会话控制：start 开始录音，stop 结束并转码为 16k mono wav 返回路径，status 查询状态。',
    parameters: {
      action: { type: 'string', enum: ['start', 'stop', 'status'], description: '操作' },
    },
    execute: async (args) => {
      refresh();
      const action = args.action as string;
      if (action === 'status') {
        const q = await queryRecording(cfg);
        return activeRecording
          ? `录音中: ${activeRecording.file}`
          : q === null
            ? '无录音（当前平台不支持状态查询）'
            : q.isRecording
              ? '服务端报告录音中'
              : '空闲';
      }
      if (action === 'start') {
        cleanupStaleAudio(cfg);
        try {
          const { file } = startRecording(cfg, () => {
            /* 退出回调：状态由 stop/status 处理 */
          });
          activeRecording = { file, startedAt: Date.now() };
          return `开始录音: ${file}`;
        } catch (e) {
          return `录音启动失败: ${(e as Error).message}`;
        }
      }
      if (action === 'stop') {
        await stopRecording(cfg);
        const rec = activeRecording;
        activeRecording = null;
        if (!rec) return '当前无进行中的录音';
        const { wav, error } = await convertToWav(cfg, rec.file);
        if (!wav) return `转码失败: ${error}`;
        return `录音完成（${Math.round((Date.now() - rec.startedAt) / 1000)}s）: ${wav}`;
      }
      return '用法: voice_record <start|stop|status>';
    },
  });

  // ── /voice 命令 ──
  registerCommand(pi, 'voice', {
    description: '语音模式管理 (usage: /voice <on|off|status|toggle|tts|model|device|backend|language|doctor|help>)',
    getArgumentCompletions: (prefix) => {
      const subs = ['on', 'off', 'status', 'toggle', 'tts', 'model', 'device', 'backend', 'language', 'doctor', 'help'];
      const f = subs.filter((s) => s.startsWith(prefix));
      return f.length ? f.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      refresh();
      const [sub, ...rest] = args.trim().split(/\s+/);
      const help = `语音命令:
  /voice on|off|toggle        开关自动朗读
  /voice status               查看状态
  /voice tts <on|off|status|speak <文本>>  TTS 控制
  /voice model <名>           设置 whisper 模型（需重启服务）
  /voice device <auto|cpu|cuda> 设置推理设备
  /voice backend <whisper|sherpa> 设置转写后端
  /voice language <代码>      设置转写语言（空=自动）
  /voice doctor               后端健康检查
  /voice help                 本帮助`;

      if (!sub || sub === 'help') {
        ctx.ui.notify(help, 'info');
        return;
      }
      if (sub === 'on' || sub === 'off' || sub === 'toggle') {
        enabled = sub === 'toggle' ? !enabled : sub === 'on';
        persistConfig({ ttsEnabled: enabled });
        ctx.ui.notify(`语音自动朗读已${enabled ? '启用' : '禁用'}`, 'info');
        return;
      }
      if (sub === 'status') {
        const backend = cfg.sttBackend;
        const wStatus = await whisperStatus(cfg);
        ctx.ui.notify(
          `自动朗读: ${enabled ? '启用' : '禁用'}\n转写后端: ${backend}\nwhisper: ${wStatus}\n端点: ${backend === 'sherpa' ? cfg.sherpaEndpoint : cfg.whisperEndpoint}`,
          'info',
        );
        return;
      }
      if (sub === 'tts') {
        const [op, ...txt] = rest;
        if (op === 'on' || op === 'off') {
          enabled = op === 'on';
          persistConfig({ ttsEnabled: enabled });
          ctx.ui.notify(`自动朗读已${enabled ? '启用' : '禁用'}`, 'info');
          return;
        }
        if (op === 'status') {
          ctx.ui.notify(`自动朗读: ${enabled ? '启用' : '禁用'}${dispatcher.isSpeaking() ? '（正在朗读）' : ''}`, 'info');
          return;
        }
        if (op === 'speak') {
          const text = txt.join(' ');
          if (!text) {
            ctx.ui.notify('用法: /voice tts speak <文本>', 'info');
            return;
          }
          if (!isSpeechWorthy(text)) {
            ctx.ui.notify('该文本不适合朗读（过短或结构化）', 'info');
            return;
          }
          dispatcher.enqueue(text);
          ctx.ui.notify('已加入朗读队列', 'info');
          return;
        }
        ctx.ui.notify('用法: /voice tts <on|off|status|speak <文本>>', 'info');
        return;
      }
      if (sub === 'model') {
        const m = rest.join(' ');
        if (!m) {
          ctx.ui.notify(`当前模型: ${cfg.whisperModel}`, 'info');
          return;
        }
        persistConfig({ whisperModel: m });
        ctx.ui.notify(`whisper 模型已设为 ${m}（需重启服务生效）`, 'info');
        return;
      }
      if (sub === 'device') {
        const d = rest[0];
        if (!['auto', 'cpu', 'cuda'].includes(d)) {
          ctx.ui.notify(`当前设备: ${cfg.whisperDevice}。用法: /voice device <auto|cpu|cuda>`, 'info');
          return;
        }
        persistConfig({ whisperDevice: d as VoiceConfig['whisperDevice'] });
        ctx.ui.notify(`推理设备已设为 ${d}（需重启服务生效）`, 'info');
        return;
      }
      if (sub === 'backend') {
        const b = rest[0];
        if (!['whisper', 'sherpa'].includes(b)) {
          ctx.ui.notify(`当前后端: ${cfg.sttBackend}。用法: /voice backend <whisper|sherpa>`, 'info');
          return;
        }
        persistConfig({ sttBackend: b as VoiceConfig['sttBackend'] });
        ctx.ui.notify(`转写后端已设为 ${b}`, 'info');
        return;
      }
      if (sub === 'language') {
        const lang = rest.join(' ');
        persistConfig({ language: lang });
        ctx.ui.notify(lang ? `转写语言已设为 ${lang}` : '转写语言已设为自动检测', 'info');
        return;
      }
      if (sub === 'doctor') {
        const wm = await whisperModel(cfg);
        const wd = await whisperDevice(cfg);
        const ws = await whisperStatus(cfg);
        ctx.ui.notify(
          `whisper 状态: ${ws}\n模型: ${wm ?? '-'}\n设备: ${wd ?? '-'}\n端点: ${cfg.whisperEndpoint}\n后端: ${cfg.sttBackend}`,
          'info',
        );
        return;
      }
      ctx.ui.notify(`未知子命令: ${sub}\n\n${help}`, 'info');
    },
  });

  // ── 快捷键 Ctrl+Alt+R：切换自动朗读 ──
  registerShortcut(pi, Key.ctrlAlt('r'), {
    description: '切换语音自动朗读 (Ctrl+Alt+R)',
    handler: async (ctx) => {
      enabled = !enabled;
      persistConfig({ ttsEnabled: enabled });
      if (ctx.hasUI) ctx.ui.notify(enabled ? '语音自动朗读已启用' : '语音自动朗读已禁用', 'info');
    },
  });

  // ── 自动朗读：assistant 消息结束后朗读（可开关）──
  registerHook(pi, {
    event: 'message_end',
    handler: async (event) => {
      if (!enabled) return;
      const e = event as { message?: { role?: string; content?: unknown } };
      const msg = e.message;
      if (!msg || msg.role !== 'assistant') return;
      const text = extractAssistantText(msg.content);
      const clean = cleanForSpeech(text, cfg.ttsMaxChars);
      if (isSpeechWorthy(clean)) dispatcher.enqueue(clean);
    },
  });

  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      if (enabled && ctx.hasUI) ctx.ui.notify('语音自动朗读已启用（Ctrl+Alt+R 切换）', 'info');
    },
  });
}

export { sendMessage };
