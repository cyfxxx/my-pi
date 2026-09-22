/**
 * Link Feature — 状态文件（设备状态/活跃/信箱）与写锁（零 Pi 依赖）
 * 迁移自 pi-tools `pi-link/{state,state-writer,active,outbox}.ts`。
 *
 * 路径（my-pi）：收敛到 `portable/agent/`；`PI_LINK_STATE_DIR` 可重定向（测试/多实例）。
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { getAgentDir } from '../../core/config';
import type { ActiveState, DeviceState, LocalState, OutboxEntry } from './types';

function linkDir(): string {
  return getAgentDir();
}

// ── 路径 ──

function stateDir(): string {
  return process.env.PI_LINK_STATE_DIR || linkDir();
}
export function stateFilePath(): string {
  return join(stateDir(), 'pi-link-state.json');
}
export function localStateFilePath(): string {
  return stateFilePath();
}
export function activeFilePath(): string {
  return join(stateDir(), 'pi-link-active.json');
}
export function outboxFilePath(): string {
  return join(stateDir(), 'pi-link-outbox.json');
}

// ── 设备状态解析 ──

export function parseState(raw: string): DeviceState | null {
  try {
    const d = JSON.parse(raw) as Partial<DeviceState>;
    if (d.status !== 'idle' && d.status !== 'busy') return null;
    return {
      device: String(d.device ?? ''),
      status: d.status,
      currentTask: typeof d.currentTask === 'string' ? d.currentTask : undefined,
      tmuxSession: typeof d.tmuxSession === 'string' ? d.tmuxSession : undefined,
      currentSessionFile: typeof d.currentSessionFile === 'string' ? d.currentSessionFile : undefined,
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

// ── 写锁 ──

const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 15000;
const LOCK_POLL_MS = 10;

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* 自旋兜底 */
    }
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/** 锁是否可安全抢占：持有者进程已退出，或持锁时间超过 LOCK_STALE_MS。 */
function lockIsStale(lockPath: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(lockPath, 'utf-8')) as { pid?: number; ts?: number };
    if (typeof raw.pid === 'number' && !pidAlive(raw.pid)) return true;
    if (typeof raw.ts === 'number' && Date.now() - raw.ts > LOCK_STALE_MS) return true;
    return false;
  } catch {
    try {
      return Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
    } catch {
      return false;
    }
  }
}

/** 写锁：锁文件记录 pid+时间戳，仅在持锁者死亡或超时后抢占，避免误删他人锁。 */
export function withStateLock<T>(file: string, fn: () => T): T {
  const lockPath = `${file}.lock`;
  const start = Date.now();
  let fd: number | null = null;
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now(), host: hostname() }));
      } catch {
        /* 元数据写失败不阻断持锁 */
      }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') break;
      if (lockIsStale(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* 已被他人抢占 */
        }
        continue;
      }
      if (Date.now() - start >= LOCK_TIMEOUT_MS) break;
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }
  }
}

export function writeLocalState(partial: Partial<LocalState>): void {
  try {
    const file = localStateFilePath();
    mkdirSync(dirname(file), { recursive: true });
    withStateLock(file, () => {
      let cur: Partial<LocalState> = {};
      try {
        cur = JSON.parse(readFileSync(file, 'utf-8'));
      } catch {
        /* 首次写入 */
      }
      const next: LocalState = {
        device: partial.device ?? cur.device ?? '',
        status: partial.status ?? cur.status ?? 'idle',
        currentTask:
          partial.currentTask ?? ((partial.status ?? cur.status ?? 'idle') === 'idle' ? undefined : cur.currentTask),
        tmuxSession: partial.tmuxSession ?? cur.tmuxSession,
        currentSessionFile: partial.currentSessionFile ?? cur.currentSessionFile,
        updatedAt: Date.now(),
      };
      const tmp = file + '.tmp.' + process.pid;
      writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
      renameSync(tmp, file);
    });
  } catch {
    /* 写失败不影响主流程 */
  }
}

// ── 活跃状态 ──

export const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

export function isUnattendedEnv(): boolean {
  return process.env.PI_UNATTENDED === '1';
}

export function selfName(cfgName?: string): string {
  return cfgName || hostname();
}

export function readActive(file = activeFilePath()): ActiveState | null {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<ActiveState>;
    if (typeof raw.lastActiveAt !== 'number') return null;
    return {
      device: String(raw.device ?? ''),
      lastActiveAt: raw.lastActiveAt,
      lastInput: raw.lastInput,
      lastSendAt: raw.lastSendAt,
    };
  } catch {
    return null;
  }
}

export function writeActive(state: Partial<ActiveState>, file = activeFilePath()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    withStateLock(file, () => {
      const cur = readActive(file);
      const tmp = file + '.tmp.' + process.pid;
      writeFileSync(tmp, JSON.stringify({ ...(cur ?? {}), ...state, device: state.device ?? cur?.device ?? '' }, null, 2), 'utf-8');
      renameSync(tmp, file);
    });
  } catch {
    /* 写失败不影响主流程 */
  }
}

export function touchActive(device: string, inputText?: string): void {
  writeActive({ device, lastActiveAt: Date.now(), lastInput: inputText?.slice(0, 100) });
}

export function isActive(st?: ActiveState | null, windowMs = ACTIVE_WINDOW_MS): boolean {
  if (!st) return false;
  return Date.now() - st.lastActiveAt < windowMs;
}

// ── 信箱 ──

export const OUTBOX_MAX = 10;

export function readOutbox(): OutboxEntry[] {
  try {
    const d = JSON.parse(readFileSync(outboxFilePath(), 'utf8'));
    return Array.isArray(d?.entries) ? d.entries : [];
  } catch {
    return [];
  }
}

export function appendOutbox(device: string, text: string): void {
  try {
    mkdirSync(dirname(outboxFilePath()), { recursive: true });
    const entries = readOutbox();
    entries.push({ ts: Date.now(), text });
    while (entries.length > OUTBOX_MAX) entries.shift();
    const p = outboxFilePath();
    const tmp = `${p}.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify({ device, entries }, null, 2));
    renameSync(tmp, p);
  } catch {
    /* 静默失败 */
  }
}

/** 提取 assistant 消息文本（兼容 string 与 content blocks 两种形态） */
function assistantMessageText(m: unknown): string | undefined {
  const msg = m as { role?: string; content?: unknown };
  if (msg?.role !== 'assistant') return undefined;
  if (typeof msg.content === 'string') return msg.content.trim() || undefined;
  if (Array.isArray(msg.content)) {
    const text = (msg.content as Array<{ type?: string; text?: string }>)
      .filter((c) => c?.type === 'text' && typeof c.text === 'string' && c.text.trim())
      .map((c) => c.text as string)
      .join('\n')
      .trim();
    return text || undefined;
  }
  return undefined;
}

export function extractFinalReply(messages: unknown[]): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = assistantMessageText(messages[i]);
    if (text) return text;
  }
  return undefined;
}
