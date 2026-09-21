/**
 * Voice Feature — KWS 唤醒监听（Linux，纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/wake.ts`。
 * Termux 录音 API 无实时 PCM 流，Windows 暂未支持；Linux parec 流式采音 → sherpa /wake。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { VoiceConfig } from './config';
import { resolvePlatform } from './recording';

const WAKE_RING_MS = 3000;
const WAKE_UPLOAD_MS = 2500;
const WAKE_POLL_MS = 500;
const WAKE_STALL_MS = 8000;
const WAKE_MIN_ALIVE_MS = 8000;
const WAKE_MAX_RESTARTS = 3;
const WAKE_FILE_MAX_BYTES = 64 * 1024 * 1024;
const WAKE_PAREC_TIMEOUT_S = 2 * 60 * 60;
const WAV_HEADER_LEN = 44;

export interface WakeSession {
  start(): Promise<void>;
  stop(): string;
  isRunning(): boolean;
  hits(): number;
}

export interface WakeOptions {
  onHit: (keyword: string) => void;
  onStatus: (status: string) => void;
}

export function createWakeSession(cfg: VoiceConfig, opts: WakeOptions): WakeSession {
  const kind = resolvePlatform(cfg);
  if (kind !== 'linux') {
    throw new Error('唤醒监听仅支持 Linux 平台（Termux 录音 API 无实时 PCM 流；Windows 暂未支持）');
  }

  let child: ChildProcess | null = null;
  let ring: Buffer = Buffer.alloc(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let hitCount = 0;
  let inFlight = false;
  let lastDataAt = 0;
  let spawnAt = 0;
  let restartCount = 0;
  let lastReadPos = 0;
  const wakeFile = join(cfg.tmpDir, 'wake-listen.wav');

  const appender = (buf: Buffer): void => {
    lastDataAt = Date.now();
    restartCount = 0;
    ring = Buffer.concat([ring, buf]);
    const cap = WAKE_RING_MS * 16 * 2;
    if (ring.length > cap) ring = ring.subarray(ring.length - cap);
  };

  const fileRead = (): void => {
    try {
      const st = statSync(wakeFile);
      if (st.size <= WAV_HEADER_LEN) return;
      if (lastReadPos === 0) {
        lastReadPos = WAV_HEADER_LEN;
        return;
      }
      if (st.size <= lastReadPos) return;
      const fd = openSync(wakeFile, 'r');
      try {
        const len = Math.min(st.size - lastReadPos, 64 * 1024);
        const b = Buffer.alloc(len);
        const n = readSync(fd, b, 0, len, lastReadPos);
        if (n > 0) {
          lastReadPos += n;
          appender(b.subarray(0, n));
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      /* 文件暂不可读 */
    }
  };

  const poll = async (): Promise<void> => {
    if (!running || inFlight) return;
    fileRead();
    try {
      if (statSync(wakeFile).size > WAKE_FILE_MAX_BYTES) {
        rolloverFile();
        return;
      }
    } catch {
      /* 文件暂不可读 */
    }
    if (ring.length < 16000) return;
    const upLen = WAKE_UPLOAD_MS * 16 * 2;
    const seg = ring.length > upLen ? ring.subarray(ring.length - upLen) : ring;
    inFlight = true;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
      if (cfg.sherpaToken) headers.Authorization = `Bearer ${cfg.sherpaToken}`;
      const res = await fetch(`${cfg.sherpaEndpoint}/wake`, {
        method: 'POST',
        headers,
        body: new Uint8Array(seg),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = (await res.json()) as { hits?: string[] };
        if (data.hits && data.hits.length > 0) {
          hitCount += data.hits.length;
          opts.onHit(data.hits[0]);
          ring = Buffer.alloc(0);
        }
      }
    } catch {
      /* 服务临时不可达 */
    } finally {
      inFlight = false;
    }
  };

  const spawnRecorder = (): void => {
    const args: string[] = [];
    if (cfg.linuxMicDevice) args.push('--device', cfg.linuxMicDevice);
    args.push('--format=s16le', '--rate=16000', '--channels=1', '--file-format=wav', wakeFile);
    const parecBin = cfg.micBin === 'termux-microphone-record' ? 'parec' : cfg.micBin;
    child = spawn('timeout', [String(WAKE_PAREC_TIMEOUT_S), parecBin, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
    spawnAt = Date.now();
    lastReadPos = 0;
    child.on('error', (e) => {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      opts.onStatus(`唤醒监听启动失败：${(e as Error).message}`);
    });
    child.on('exit', (code) => {
      if (running) {
        running = false;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        opts.onStatus(code === 0 ? '唤醒监听已停止' : `唤醒监听异常退出（${code ?? '?'}）`);
      }
    });
  };

  const killChild = (c: ChildProcess): void => {
    c.removeAllListeners('exit');
    c.removeAllListeners('error');
    c.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (c.exitCode === null) c.kill('SIGKILL');
      } catch {
        /* 已退出 */
      }
    }, 500).unref();
  };

  const rolloverFile = (): void => {
    if (!child) return;
    const stale = child;
    child = null;
    ring = Buffer.alloc(0);
    lastDataAt = 0;
    lastReadPos = 0;
    killChild(stale);
    rmSync(wakeFile, { force: true });
    spawnRecorder();
  };

  const guard = (): void => {
    if (!running || !child || child.exitCode !== null) return;
    if (Date.now() - spawnAt < WAKE_MIN_ALIVE_MS) return;
    if (lastDataAt !== 0 && Date.now() - lastDataAt < WAKE_STALL_MS) return;
    if (restartCount >= WAKE_MAX_RESTARTS) {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (child) {
        const stale = child;
        child = null;
        killChild(stale);
      }
      try {
        rmSync(wakeFile, { force: true });
      } catch {
        /* ignore */
      }
      opts.onStatus('唤醒采集多次重启仍无数据（可能无麦克风输入），请确认麦克风后 /voice wake off 再开启');
      return;
    }
    restartCount++;
    const stale = child;
    child = null;
    ring = Buffer.alloc(0);
    lastDataAt = 0;
    lastReadPos = 0;
    killChild(stale);
    rmSync(wakeFile, { force: true });
    spawnRecorder();
  };

  return {
    async start() {
      if (running) return;
      mkdirSync(cfg.tmpDir, { recursive: true });
      running = true;
      hitCount = 0;
      restartCount = 0;
      rmSync(wakeFile, { force: true });
      spawnRecorder();
      opts.onStatus('🎧 唤醒监听中（说"开启语音输入"开始录音）');
      timer = setInterval(() => {
        void poll();
        guard();
      }, WAKE_POLL_MS);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const c = child;
      if (c && c.exitCode === null) killChild(c);
      running = false;
      ring = Buffer.alloc(0);
      try {
        rmSync(wakeFile, { force: true });
      } catch {
        /* ignore */
      }
      child = null;
      return '唤醒监听已停止';
    },
    isRunning: () => running,
    hits: () => hitCount,
  };
}
