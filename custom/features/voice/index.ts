/**
 * Voice Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-voice/{index,commands}.ts`（核心）。
 * 工具 voice_transcribe / voice_speak；命令 /voice；Ctrl+Alt+R；自动朗读钩子。
 * 录音/唤醒/诊断/听写均已在逻辑层实现；未迁移：sherpa/whisper 服务脚本（外部服务）。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { registerCommand, registerShortcut, sendMessage, sendUserMessage, Key } from '../../adapters/ui-adapter';
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
  createWakeSession,
  benchmark,
  micLabel,
  platformInstallGuide,
  fileExists,
  deleteAudioPair,
  waitForFileStable,
  detectAudioLevel,
  createDictation,
  type VoiceConfig,
  type WakeSession,
  type RecordingDeps,
} from './logic';

let activeRecording: { file: string; startedAt: number } | null = null;
let wakeSession: WakeSession | null = null;

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

  const dictationDeps: RecordingDeps = {
    startRecording,
    stopRecording,
    queryRecording,
    fileExists,
    convertToWav,
    transcribe: (c, w) => transcribeByBackend(c, w),
    deleteAudioPair,
    waitForFileStable,
    detectAudioLevel: (w) => detectAudioLevel(w, cfg.ffmpegBin),
    micLabel: micLabel(cfg),
    micInstallHint: platformInstallGuide(cfg).split('\n')[0],
    micPermissionHint: '检查系统麦克风权限（Android: 设置→应用→Termux:API→麦克风）',
  };
  const dictation = createDictation(cfg, dictationDeps, {
    onAutoComplete: (r) => {
      sendMessage(pi, { customType: 'voice-dictation', content: r.message, display: true });
      if (r.text) sendUserMessage(pi, r.text, { expandPromptTemplates: false });
    },
    onReady: () => {
      sendMessage(pi, { customType: 'voice-dictation', content: '🎤 录音中', display: true });
    },
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
        const useCfg = args.language ? { ...cfg, language: args.language as string } : cfg;
        const r = await transcribeByBackend(useCfg, wavPath);
        if (r.error) return `转写失败: ${r.error}`;
        return r.text || '(未识别到语音)';
      } catch (e) {
        return `转写失败: ${(e as Error).message}`;
      } finally {
        deleteAudioPair(cfg, wavPath);
      }
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
    description: '语音：朗读与录音转写',
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: 'status', label: 'status', description: '查看语音状态' },
        { value: 'toggle', label: 'toggle', description: '开关自动朗读' },
        { value: 'tts ', label: 'tts', description: '朗读控制（status / speak <文本>）' },
        { value: 'record ', label: 'record', description: '录音→转写→发送（Ctrl+Alt+R）' },
        { value: 'model ', label: 'model', description: '设置 whisper 模型' },
        { value: 'device ', label: 'device', description: '设置推理设备（auto/cpu/cuda）' },
        { value: 'backend ', label: 'backend', description: '设置转写后端（whisper/sherpa）' },
        { value: 'language ', label: 'language', description: '设置转写语言（空=自动）' },
        { value: 'doctor', label: 'doctor', description: '后端健康检查' },
        { value: 'wake ', label: 'wake', description: 'KWS 唤醒监听（Linux+sherpa）' },
        { value: 'bench', label: 'bench', description: '录音转写基准（RTF）' },
        { value: 'help', label: 'help', description: '显示用法' },
      ];
      const f = subs.filter((s) => s.value.startsWith(prefix));
      return f.length ? f : null;
    },
    handler: async (args, ctx) => {
      refresh();
      const [sub, ...rest] = args.trim().split(/\s+/);
      const help = `/voice <子命令>
  status                      查看语音状态
  toggle                      开关自动朗读
  tts status|speak <文本>     朗读控制
  record <start|stop|cancel|status>  录音→转写→发送（Ctrl+Alt+R）
  model <名> / device <auto|cpu|cuda> / backend <whisper|sherpa> / language <代码>  转写配置
  doctor                      后端健康检查
  wake <on|off|status>        KWS 唤醒监听（Linux+sherpa）
  bench                       录音→转写基准（RTF）`;

      if (!sub || sub === 'help') {
        ctx.ui.notify(help, 'info');
        return;
      }
      if (sub === 'toggle') {
        enabled = !enabled;
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
        ctx.ui.notify('用法: /voice tts <status|speak <文本>>', 'info');
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
      if (sub === 'wake') {
        const op = rest[0] ?? 'status';
        if (op === 'status') {
          ctx.ui.notify(wakeSession?.isRunning() ? `唤醒监听中（命中 ${wakeSession.hits()} 次）` : '唤醒监听未运行', 'info');
          return;
        }
        if (op === 'off') {
          const msg = wakeSession?.stop() ?? '唤醒监听未运行';
          wakeSession = null;
          ctx.ui.notify(msg, 'info');
          return;
        }
        if (op === 'on') {
          if (cfg.sttBackend !== 'sherpa') {
            ctx.ui.notify('唤醒监听需要 sttBackend=sherpa（/voice backend sherpa）', 'warning');
            return;
          }
          try {
            wakeSession = createWakeSession(cfg, {
              onHit: (kw) => {
                sendMessage(pi, { customType: 'voice-wake', content: `唤醒词命中: ${kw}`, display: true }, { triggerTurn: true });
              },
              onStatus: (s) => ctx.ui.notify(s, 'info'),
            });
            await wakeSession.start();
          } catch (e) {
            ctx.ui.notify(`唤醒启动失败: ${(e as Error).message}`, 'error');
          }
          return;
        }
        ctx.ui.notify('用法: /voice wake <on|off|status>', 'info');
        return;
      }
      if (sub === 'record') {
        const op = rest[0] ?? 'toggle';
        if (op === 'status') {
          ctx.ui.notify(dictation.isRecording() ? '录音中' : dictation.isTranscribing() ? '转写中' : '空闲', 'info');
          return;
        }
        if (op === 'cancel') {
          ctx.ui.notify(dictation.cancel(), 'info');
          return;
        }
        if (op === 'stop' || (op === 'toggle' && dictation.isRecording())) {
          const r = await dictation.stop();
          ctx.ui.notify(r.message, r.text ? 'info' : 'warning');
          if (r.text) sendUserMessage(pi, r.text, { expandPromptTemplates: false });
          return;
        }
        ctx.ui.notify(dictation.start(), 'info');
        return;
      }
      if (sub === 'bench') {
        ctx.ui.notify('正在进行录音基准测试（约 5s）...', 'info');
        const r = await benchmark(cfg);
        ctx.ui.notify(r.lines.join('\n'), 'info');
        return;
      }
      ctx.ui.notify(`未知子命令: ${sub}\n\n${help}`, 'info');
    },
  });

  // ── 快捷键 Ctrl+Alt+R：听写开关（录音 → 转写 → 发送）──
  registerShortcut(pi, Key.ctrlAlt('r'), {
    description: '语音听写开关 (Ctrl+Alt+R)',
    handler: async (ctx) => {
      if (dictation.isRecording()) {
        const r = await dictation.stop();
        if (ctx.hasUI) ctx.ui.notify(r.message, r.text ? 'info' : 'warning');
        if (r.text) sendUserMessage(pi, r.text, { expandPromptTemplates: false });
      } else {
        const msg = dictation.start();
        if (ctx.hasUI) ctx.ui.notify(msg, 'info');
      }
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

  registerHook(pi, {
    event: 'session_shutdown',
    handler: async () => {
      dictation.cleanup();
      if (wakeSession) {
        wakeSession.stop();
        wakeSession = null;
      }
    },
  });
}

export { sendMessage };
