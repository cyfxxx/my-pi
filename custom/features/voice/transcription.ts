/**
 * Voice Feature — 转写后端（whisper / sherpa）（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/transcription.ts`。
 */

import { readFileSync } from 'node:fs';
import type { VoiceConfig } from './config';
import { runCommand, type CommandResult, type TranscribeResult } from './types';

export interface EnsureDeps {
  health?: () => Promise<boolean>;
  start?: () => Promise<CommandResult>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export function defaultWhisperHealth(cfg: VoiceConfig): () => Promise<boolean> {
  return async () => {
    try {
      const headers: Record<string, string> = {};
      if (cfg.whisperToken) headers.Authorization = `Bearer ${cfg.whisperToken}`;
      const res = await fetch(`${cfg.whisperEndpoint}/health`, { headers, signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  };
}

export function defaultSherpaHealth(cfg: VoiceConfig): () => Promise<boolean> {
  return async () => {
    try {
      const headers: Record<string, string> = {};
      if (cfg.sherpaToken) headers.Authorization = `Bearer ${cfg.sherpaToken}`;
      const res = await fetch(`${cfg.sherpaEndpoint}/health`, { headers, signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  };
}

async function ensure(
  health: () => Promise<boolean>,
  start: () => Promise<CommandResult>,
  label: string,
  endpoint: string,
  pollIntervalMs = 2000,
  pollTimeoutMs = 120000,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await health()) return { ok: true };
  const res = await start();
  if (res.code !== 0) {
    return { ok: false, error: `${label} 服务不可用且自动启动失败：${res.stderr.trim() || res.stdout.trim() || '未知错误'}` };
  }
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    if (await health()) return { ok: true };
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return { ok: false, error: `${label} 服务自动启动后仍不可达（${endpoint}）` };
}

export function ensureWhisperService(cfg: VoiceConfig, deps: EnsureDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const start = deps.start ?? (() => runCommand('bash', [cfg.whisperScript, 'start'], { timeoutMs: 30000 }));
  return ensure(deps.health ?? defaultWhisperHealth(cfg), start, 'whisper', cfg.whisperEndpoint, deps.pollIntervalMs, deps.pollTimeoutMs);
}

export function ensureSherpaService(cfg: VoiceConfig, deps: EnsureDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const start = deps.start ?? (() => runCommand('bash', [cfg.sherpaScript, 'start'], { timeoutMs: 30000 }));
  return ensure(deps.health ?? defaultSherpaHealth(cfg), start, 'sherpa', cfg.sherpaEndpoint, deps.pollIntervalMs, deps.pollTimeoutMs);
}

async function postWav(endpoint: string, token: string, wavPath: string, lang: string, label: string): Promise<TranscribeResult> {
  let body: Buffer;
  try {
    body = readFileSync(wavPath);
  } catch (e) {
    return { text: '', language: '', error: `读取 wav 失败: ${(e as Error).message}` };
  }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'audio/wav', 'Content-Length': String(body.length) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = lang ? `${endpoint}/transcribe?lang=${encodeURIComponent(lang)}` : `${endpoint}/transcribe`;
    const res = await fetch(url, { method: 'POST', headers, body: new Uint8Array(body), signal: AbortSignal.timeout(120000) });
    if (!res.ok) return { text: '', language: '', error: `${label} 服务返回 ${res.status}` };
    const data = (await res.json()) as { text?: string; language?: string; error?: string };
    if (data.error) return { text: '', language: '', error: data.error };
    return { text: data.text ?? '', language: data.language ?? '' };
  } catch (e) {
    return { text: '', language: '', error: `${label} 服务不可达: ${(e as Error).message}` };
  }
}

export async function transcribe(cfg: VoiceConfig, wavPath: string): Promise<TranscribeResult> {
  const ready = await ensureWhisperService(cfg);
  if (!ready.ok) return { text: '', language: '', error: ready.error };
  return postWav(cfg.whisperEndpoint, cfg.whisperToken, wavPath, cfg.language, 'whisper');
}

export async function transcribeSherpa(cfg: VoiceConfig, wavPath: string): Promise<TranscribeResult> {
  const ready = await ensureSherpaService(cfg);
  if (!ready.ok) return { text: '', language: '', error: ready.error };
  return postWav(cfg.sherpaEndpoint, cfg.sherpaToken, wavPath, cfg.language, 'sherpa');
}

export function transcribeByBackend(cfg: VoiceConfig, wavPath: string): Promise<TranscribeResult> {
  return cfg.sttBackend === 'sherpa' ? transcribeSherpa(cfg, wavPath) : transcribe(cfg, wavPath);
}
