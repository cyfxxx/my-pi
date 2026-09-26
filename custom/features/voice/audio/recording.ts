/**
 * Voice Feature — 录音会话/转码（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/{platform,recording}.ts`（termux/linux；Windows dshow 暂缓）。
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getAgentDir } from '../../../core/config';
import type { VoiceConfig } from '../config';
import { runCommand, nowStamp, type CommandResult } from '../types';

export type ResolvedPlatform = 'termux' | 'linux' | 'windows';

export interface RecorderSpec {
  bin: string;
  ext: 'wav' | 'm4a';
  needsConvert: boolean;
  startArgs(file: string): string[];
  stopArgs(): string[] | null;
  queryArgs(): string[] | null;
}

function isTermux(): boolean {
  return process.platform === 'android' || existsSync('/data/data/com.termux') || Boolean(process.env.TERMUX_VERSION);
}

export function resolvePlatform(cfg: VoiceConfig): ResolvedPlatform {
  if (cfg.platform === 'auto') return isTermux() ? 'termux' : 'linux';
  return cfg.platform;
}

export function recorderSpec(cfg: VoiceConfig): RecorderSpec {
  const kind = resolvePlatform(cfg);
  if (kind === 'windows') {
    const micBin = cfg.micBin === 'termux-microphone-record' ? 'ffmpeg' : cfg.micBin;
    return {
      bin: micBin,
      ext: 'wav',
      needsConvert: false,
      startArgs: (file) => {
        const args = ['-f', 'dshow', '-i', `audio=${cfg.micDevice}`];
        if (cfg.maxSeconds > 0) args.push('-t', String(cfg.maxSeconds));
        args.push('-y', file);
        return args;
      },
      stopArgs: () => null,
      queryArgs: () => null,
    };
  }
  if (kind === 'termux') {
    return {
      bin: 'termux-microphone-record',
      ext: 'm4a',
      needsConvert: true,
      startArgs: (file) => ['-e', 'aac', '-f', file, '-l', '0'],
      stopArgs: () => ['-q'],
      queryArgs: () => ['-i'],
    };
  }
  const micBin = cfg.micBin === 'termux-microphone-record' ? 'parec' : cfg.micBin;
  return {
    bin: micBin,
    ext: 'wav',
    needsConvert: false,
    startArgs: (file) => {
      const args: string[] = [];
      if (cfg.linuxMicDevice) args.push('--device', cfg.linuxMicDevice);
      args.push('--format=s16le', '--rate=16000', '--channels=1', '--file-format=wav', file);
      return args;
    },
    stopArgs: () => null,
    queryArgs: () => null,
  };
}

/** 录音程序显示名（错误提示用） */
export function micLabel(cfg: VoiceConfig): string {
  const kind = resolvePlatform(cfg);
  if (kind === 'termux') return 'termux-microphone-record';
  if (kind === 'windows') return `ffmpeg dshow${cfg.micDevice ? ` [${cfg.micDevice}]` : ''}`;
  const micBin = cfg.micBin === 'termux-microphone-record' ? 'parec' : cfg.micBin;
  return `${micBin}${cfg.linuxMicDevice ? ` (${cfg.linuxMicDevice})` : ''}`;
}

let activeRecorder: { child: ChildProcess; file: string } | null = null;
let termuxSessionActive = false;

function sessionStateFile(): string {
  return join(getAgentDir(), '.my-pi-voice-session.json');
}
function writeSessionOwner(): void {
  try {
    mkdirSync(dirname(sessionStateFile()), { recursive: true });
    writeFileSync(sessionStateFile(), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch {
    /* ignore */
  }
}
function clearSessionOwner(): void {
  try {
    unlinkSync(sessionStateFile());
  } catch {
    /* ignore */
  }
}
export function ownerOrphaned(): boolean {
  try {
    const data = JSON.parse(readFileSync(sessionStateFile(), 'utf-8')) as { pid?: number };
    if (typeof data.pid !== 'number' || !Number.isFinite(data.pid)) {
      clearSessionOwner();
      return false;
    }
    try {
      process.kill(data.pid, 0);
      return false;
    } catch {
      clearSessionOwner();
      return true;
    }
  } catch {
    return false;
  }
}

export function startRecording(
  cfg: VoiceConfig,
  onExit: (code: number, stderr?: string) => void,
  opts: { forceClean?: boolean } = {},
): { child: ChildProcess; file: string } {
  const kind = resolvePlatform(cfg);
  const spec = recorderSpec(cfg);
  const residuePattern = kind === 'termux' ? 'termux-microphone-record' : `${spec.bin} .*${cfg.tmpDir}`;
  const allowClean = termuxSessionActive || ownerOrphaned() || (kind === 'linux' && opts.forceClean === true);
  if (allowClean) {
    try {
      execFileSync('pkill', ['-f', residuePattern]);
    } catch {
      /* 无残留 */
    }
  }
  mkdirSync(cfg.tmpDir, { recursive: true });
  const file = join(cfg.tmpDir, `pi-voice-${nowStamp()}-${Math.random().toString(36).slice(2, 8)}.${spec.ext}`);
  let args = spec.startArgs(file);
  let recBin = spec.bin;
  if (kind === 'linux') {
    const margin = cfg.maxSeconds > 0 ? cfg.maxSeconds + 30 : 86400;
    args = [String(margin), recBin, ...args];
    recBin = 'timeout';
  }
  const child = spawn(recBin, args, { stdio: kind === 'windows' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
  if (kind === 'linux' || kind === 'windows') {
    const prev = activeRecorder;
    if (prev && prev.child.exitCode === null && prev.child.pid !== undefined) {
      try {
        prev.child.kill('SIGTERM');
      } catch {
        /* 已退出 */
      }
    }
    activeRecorder = { child, file };
  } else if (kind === 'termux' && child.pid !== undefined) {
    termuxSessionActive = true;
    writeSessionOwner();
    activeRecorder = null;
  }
  let errBuf = '';
  child.stderr?.on('data', (d: Buffer) => {
    errBuf = (errBuf + d.toString()).slice(-500);
  });
  child.on('error', () => {
    if (kind === 'termux') {
      termuxSessionActive = false;
      clearSessionOwner();
    }
    onExit(-2, errBuf.trim() || undefined);
  });
  child.on('exit', (code) => {
    if (activeRecorder?.child === child) activeRecorder = null;
    if (kind === 'termux' && (code ?? -1) !== 0) {
      termuxSessionActive = false;
      clearSessionOwner();
    }
    onExit(code ?? -1, errBuf.trim() || undefined);
  });
  return { child, file };
}

export async function stopRecording(cfg: VoiceConfig): Promise<CommandResult> {
  const kind = resolvePlatform(cfg);
  if (kind === 'windows') {
    const rec = activeRecorder;
    if (!rec || rec.child.exitCode !== null) return { code: 0, stdout: '', stderr: '' };
    return new Promise<CommandResult>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          rec.child.kill('SIGKILL');
        } catch {
          /* 已退出 */
        }
        resolve({ code: 0, stdout: '', stderr: 'stdin q 超时已强制终止' });
      }, 2000);
      rec.child.once('exit', () => {
        clearTimeout(killTimer);
        resolve({ code: 0, stdout: '', stderr: '' });
      });
      try {
        rec.child.stdin?.write('q');
      } catch {
        clearTimeout(killTimer);
        resolve({ code: 0, stdout: '', stderr: '' });
      }
    });
  }
  if (kind === 'linux') {
    const rec = activeRecorder;
    if (!rec || rec.child.exitCode !== null || rec.child.pid === undefined) return { code: 0, stdout: '', stderr: '' };
    return new Promise<CommandResult>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          process.kill(rec.child.pid as number, 'SIGKILL');
        } catch {
          /* 已退出 */
        }
        resolve({ code: 0, stdout: '', stderr: 'SIGTERM 超时已强制终止' });
      }, 1000);
      rec.child.once('exit', () => {
        clearTimeout(killTimer);
        resolve({ code: 0, stdout: '', stderr: '' });
      });
      try {
        process.kill(rec.child.pid as number, 'SIGTERM');
      } catch {
        clearTimeout(killTimer);
        resolve({ code: 0, stdout: '', stderr: '' });
      }
    });
  }
  if (!termuxSessionActive && !ownerOrphaned()) return { code: 0, stdout: '', stderr: '' };
  termuxSessionActive = false;
  const result = await runCommand(recorderSpec(cfg).bin, recorderSpec(cfg).stopArgs() ?? ['-q'], { timeoutMs: 15000 });
  clearSessionOwner();
  return result;
}

export async function queryRecording(cfg: VoiceConfig): Promise<{ isRecording: boolean } | null> {
  const spec = recorderSpec(cfg);
  const q = spec.queryArgs();
  if (q === null) return null;
  const r = await runCommand(spec.bin, q, { timeoutMs: 10000 });
  if (r.code !== 0) return null;
  try {
    const data = JSON.parse(r.stdout.trim()) as { isRecording?: unknown };
    return { isRecording: data?.isRecording === true };
  } catch {
    return null;
  }
}

export function deleteAudioPair(_cfg: VoiceConfig, m4a: string): void {
  for (const p of [m4a, m4a.replace(/\.m4a$/, '.wav')]) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export function fileExists(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
}

export async function waitForFileStable(
  p: string,
  opts: { pollMs?: number; stableSamples?: number; maxWaitMs?: number } = {},
): Promise<boolean> {
  const { pollMs = 300, stableSamples = 3, maxWaitMs = 15000 } = opts;
  const deadline = Date.now() + maxWaitMs;
  let lastSize = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    let size = 0;
    try {
      size = statSync(p).size;
    } catch {
      size = 0;
    }
    if (size > 0) {
      if (size === lastSize) stable += 1;
      else stable = lastSize === -1 ? 1 : 0;
      lastSize = size;
      if (stable >= stableSamples) return true;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

export function cleanupStaleAudio(cfg: VoiceConfig, staleMs = 24 * 60 * 60 * 1000): number {
  let removed = 0;
  let names: string[] = [];
  try {
    names = readdirSync(cfg.tmpDir);
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith('.m4a') && !name.endsWith('.wav')) continue;
    const full = join(cfg.tmpDir, name);
    try {
      if (now - statSync(full).mtimeMs > staleMs) {
        rmSync(full, { force: true });
        removed += 1;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export async function detectAudioLevel(wavPath: string, ffmpegBin = 'ffmpeg'): Promise<{ maxDb: number; meanDb: number } | null> {
  const r = await runCommand(ffmpegBin, ['-i', wavPath, '-af', 'volumedetect', '-f', 'null', 'null'], { timeoutMs: 30000 });
  if (r.code !== 0) return null;
  const maxStr = /max_volume: ([-.\d]+) dB/.exec(r.stderr)?.[1];
  const meanStr = /mean_volume: ([-.\d]+) dB/.exec(r.stderr)?.[1];
  const maxDb = maxStr ? parseFloat(maxStr) : NaN;
  if (Number.isNaN(maxDb)) return null;
  return { maxDb, meanDb: meanStr ? parseFloat(meanStr) : -Infinity };
}

export async function convertToWav(cfg: VoiceConfig, m4a: string): Promise<{ wav: string | null; error: string }> {
  if (!recorderSpec(cfg).needsConvert) return { wav: m4a, error: '' };
  const wav = m4a.replace(/\.m4a$/, '.wav');
  const res = await runCommand(
    cfg.ffmpegBin,
    ['-y', '-loglevel', 'error', '-i', m4a, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
    { timeoutMs: 30000 },
  );
  if (res.code === 0) return { wav, error: '' };
  const err = res.stderr.trim() || res.stdout.trim();
  return { wav: null, error: err ? err.slice(0, 200) : `ffmpeg 退出码 ${res.code}` };
}
