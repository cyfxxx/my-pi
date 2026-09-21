/**
 * Voice Feature — TTS 朗读/调度（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/tts.ts`。
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VoiceConfig } from './config';
import { runCommand, type CommandResult } from './types';

function isTermux(): boolean {
  return process.platform === 'android' || existsSync('/data/data/com.termux') || Boolean(process.env.TERMUX_VERSION);
}

/** TTS 朗读：termux 用 termux-tts-speak；linux/macOS 用 espeak-ng 合成 wav → paplay 播放。 */
export async function speak(cfg: VoiceConfig, text: string): Promise<CommandResult> {
  const clean = cleanForSpeech(text, cfg.ttsMaxChars);
  if (!clean) return { code: 0, stdout: '', stderr: '（空文本，跳过朗读）' };
  if (cfg.platform === 'termux' || isTermux()) {
    return runCommand(cfg.ttsBin, [clean], { timeoutMs: 60000 });
  }
  mkdirSync(cfg.tmpDir, { recursive: true });
  const stage = join(cfg.tmpDir, `tts-${process.pid}.wav`);
  try {
    const gen = await runCommand(
      'espeak-ng',
      ['-v', cfg.linuxTtsVoice, '-s', String(cfg.linuxTtsRate), '-w', stage, clean],
      { timeoutMs: 60000 },
    );
    if (gen.code !== 0) {
      return { ...gen, stderr: `${gen.stderr.trim()}（请确认已安装 espeak-ng：apt-get install espeak-ng）` };
    }
    const playArgs = cfg.linuxTtsSink ? ['--device', cfg.linuxTtsSink, stage] : [stage];
    return await runCommand('paplay', playArgs, { timeoutMs: 60000 });
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

/** 清理 TTS 暂存文本文件（预留） */
export function writeTtsInput(cfg: VoiceConfig, text: string): string {
  mkdirSync(cfg.tmpDir, { recursive: true });
  const file = join(cfg.tmpDir, `tts-input-${process.pid}.txt`);
  writeFileSync(file, text, 'utf-8');
  return file;
}
