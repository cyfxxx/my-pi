/**
 * Voice Feature — TTS 朗读/调度（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/tts.ts`。
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { VoiceConfig } from '../config';
import { runCommand, type CommandResult } from '../types';

function isTermux(): boolean {
  return process.platform === 'android' || existsSync('/data/data/com.termux') || Boolean(process.env.TERMUX_VERSION);
}

/** 选择非 termux 平台的合成引擎：显式指定优先，auto 则模型存在时用 piper，否则 espeak。 */
export function selectTtsEngine(cfg: VoiceConfig): 'piper' | 'espeak' {
  if (cfg.ttsEngine === 'piper') return 'piper';
  if (cfg.ttsEngine === 'espeak') return 'espeak';
  return existsSync(cfg.linuxPiperModel) ? 'piper' : 'espeak';
}

/** piper 通过 stdin 接收文本、`--output_file` 产出 wav（runCommand 无 stdin，故用 spawn）。 */
function synthesizeWithPiper(cfg: VoiceConfig, text: string, stage: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const done = (r: CommandResult): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('piper', ['--model', cfg.linuxPiperModel, '--output_file', stage], { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (e) {
      done({ code: 127, stdout: '', stderr: (e as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 已退出 */
      }
      done({ code: 124, stdout: '', stderr: 'piper 合成超时' });
    }, 60000);
    timer.unref?.();
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-500);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ code: 127, stdout: '', stderr: (e as Error).message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout: '', stderr });
    });
    try {
      child.stdin?.end(text);
    } catch {
      /* 进程可能提前退出 */
    }
  });
}

/** TTS 朗读：termux 用 termux-tts-speak；linux/macOS 用 piper/espeak-ng 合成 wav → paplay 播放。 */
export async function speak(cfg: VoiceConfig, text: string): Promise<CommandResult> {
  const clean = cleanForSpeech(text, cfg.ttsMaxChars);
  if (!clean) return { code: 0, stdout: '', stderr: '（空文本，跳过朗读）' };
  if (cfg.platform === 'termux' || isTermux()) {
    return runCommand(cfg.ttsBin, [clean], { timeoutMs: 60000 });
  }
  mkdirSync(cfg.tmpDir, { recursive: true });
  const stage = join(cfg.tmpDir, `tts-${process.pid}.wav`);
  const play = (): Promise<CommandResult> => {
    const playArgs = cfg.linuxTtsSink ? ['--device', cfg.linuxTtsSink, stage] : [stage];
    return runCommand('paplay', playArgs, { timeoutMs: 60000 });
  };
  try {
    if (selectTtsEngine(cfg) === 'piper') {
      const gen = await synthesizeWithPiper(cfg, clean, stage);
      if (gen.code === 0) return await play();
      // auto 模式下 piper 不可用时回退 espeak；显式 piper 则如实报告。
      if (cfg.ttsEngine === 'piper') {
        return { ...gen, stderr: `${gen.stderr.trim()}（piper 合成失败，请确认已安装 piper 且模型存在：${cfg.linuxPiperModel}）` };
      }
    }
    const gen = await runCommand(
      'espeak-ng',
      ['-v', cfg.linuxTtsVoice, '-s', String(cfg.linuxTtsRate), '-w', stage, clean],
      { timeoutMs: 60000 },
    );
    if (gen.code !== 0) {
      return { ...gen, stderr: `${gen.stderr.trim()}（请确认已安装 espeak-ng：apt-get install espeak-ng）` };
    }
    return await play();
  } finally {
    try {
      rmSync(stage, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export function cleanForSpeech(text: string, maxChars = 400): string {
  let out = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/^\s*>\s*/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  out = out.replace(/([，。！？!?；;：:,])\s+/g, '$1');
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}...`;
  return out;
}

export function isSpeechWorthy(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (/^[{[]/.test(t)) return false;
  if (/^[\s`~\-*#_>|+]+$/.test(t)) return false;
  return true;
}

export interface TtsDispatcher {
  enqueue(text: string): void;
  isSpeaking(): boolean;
  pendingCount(): number;
  flush(): Promise<void>;
}

export function createTtsDispatcher(opts: {
  speakFn: (text: string) => Promise<CommandResult>;
  onError?: (message: string) => void;
}): TtsDispatcher {
  let pending: string | null = null;
  let speaking = false;
  let chain: Promise<void> = Promise.resolve();
  let idle = true;

  function pump(): void {
    if (!idle) return;
    idle = false;
    chain = chain.then(async () => {
      try {
        while (pending !== null) {
          const text = pending;
          pending = null;
          speaking = true;
          try {
            const r = await opts.speakFn(text);
            if (r.code !== 0) opts.onError?.(r.stderr.trim() || r.stdout.trim() || `朗读进程退出码 ${r.code}`);
          } catch (e) {
            opts.onError?.((e as Error).message);
          } finally {
            speaking = false;
          }
        }
      } finally {
        idle = true;
      }
    });
  }

  return {
    enqueue(text: string) {
      pending = text;
      pump();
    },
    isSpeaking: () => speaking,
    pendingCount: () => (pending === null ? 0 : 1),
    flush: () => chain,
  };
}

export function extractAssistantText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type?: string; text?: string } => !!p && typeof p === 'object')
      .filter((p) => (p.type ?? '') === 'text')
      .map((p) => p.text ?? '')
      .join('\n');
  }
  return '';
}
