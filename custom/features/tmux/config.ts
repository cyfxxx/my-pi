import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  rmSync,
  renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { getMemoryDir } from '../../core/config';

export const SESSION_PREFIX = 'pi-';
const NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/;
export const TMUX_LOG_MAX_BYTES = 10 * 1024 * 1024;

export interface TmuxOpts {
  bin: string;
  logDir: string;
  prefix: string;
}

export interface TmuxConfig extends TmuxOpts {
  defaultLines: number;
  defaultTimeoutSec: number;
}

// ── 路径与配置 ──

/** 默认日志目录（my-pi：portable/memory/tmux） */
export function defaultLogDir(): string {
  return join(getMemoryDir(), 'tmux');
}

export function registryPath(): string {
  return process.env.PI_TMUX_REGISTRY || join(getMemoryDir(), 'tmux-registry.json');
}

function resolveDir(p: string): string {
  return isAbsolute(p) ? p : join(homedir(), p.replace(/^~(\/|$)/, ''));
}

export function loadTmuxConfig(): TmuxConfig {
  let bin = 'tmux';
  let prefix = SESSION_PREFIX;
  let logDir = defaultLogDir();
  let defaultLines = 100;
  let defaultTimeoutSec = 120;

  // settings.json（agentDir）可选配置："pi-tmux" 或 "tmux" 节
  try {
    const settings = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'settings.json');
    if (existsSync(settings)) {
      const raw = JSON.parse(readFileSync(settings, 'utf-8')) as Record<string, Record<string, unknown> | undefined>;
      const section = raw['pi-tmux'] ?? raw['tmux'];
      if (section && typeof section === 'object') {
        if (typeof section.bin === 'string') bin = section.bin;
        if (typeof section.prefix === 'string') prefix = section.prefix;
        if (typeof section.logDir === 'string') logDir = resolveDir(section.logDir);
        if (typeof section.defaultLines === 'number') defaultLines = section.defaultLines;
        if (typeof section.defaultTimeoutSec === 'number') defaultTimeoutSec = section.defaultTimeoutSec;
      }
    }
  } catch {
    /* 配置损坏则用默认 */
  }

  if (process.env.PI_TMUX_BIN) bin = process.env.PI_TMUX_BIN;
  if (process.env.PI_TMUX_PREFIX) prefix = process.env.PI_TMUX_PREFIX;
  if (process.env.PI_TMUX_LOG_DIR) logDir = resolveDir(process.env.PI_TMUX_LOG_DIR);
  if (process.env.PI_TMUX_LINES) {
    const n = parseInt(process.env.PI_TMUX_LINES, 10);
    if (!Number.isNaN(n) && n > 0) defaultLines = n;
  }
  if (process.env.PI_TMUX_TIMEOUT_SEC) {
    const n = parseInt(process.env.PI_TMUX_TIMEOUT_SEC, 10);
    if (!Number.isNaN(n) && n > 0) defaultTimeoutSec = n;
  }
  return { bin, prefix, logDir, defaultLines, defaultTimeoutSec };
}

// ── 会话名 ──

export function normalizeSessionName(raw: string, prefix = SESSION_PREFIX): string {
  let name = (raw || '').trim();
  if (!name) throw new Error('会话名为空');
  if (name.startsWith(prefix)) name = name.slice(prefix.length);
  if (!NAME_RE.test(name)) {
    throw new Error(`非法会话名 "${raw}"：仅允许字母/数字/下划线/中划线，长度 1-40`);
  }
  return prefix + name;
}

export function isPiSession(name: string, prefix = SESSION_PREFIX): boolean {
  return name.startsWith(prefix);
}

export function shellSingleQuote(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ── 日志 ──

export function ensureLogDir(opts: TmuxOpts): string {
  mkdirSync(opts.logDir, { recursive: true });
  return opts.logDir;
}

export function logPathFor(opts: TmuxOpts, name: string): string {
  return join(opts.logDir, `${name}.log`);
}

/** 日志超限单代轮转：<log> → <log>.old（只保留一代历史），失败静默 */
export function rotateLogIfLarge(opts: TmuxOpts, name: string, maxBytes = TMUX_LOG_MAX_BYTES): boolean {
  const p = logPathFor(opts, name);
  try {
    if (!existsSync(p) || statSync(p).size <= maxBytes) return false;
    try {
      rmSync(p + '.old', { force: true });
    } catch {
      /* ignore */
    }
    renameSync(p, p + '.old');
    return true;
  } catch {
    return false;
  }
}

export function removeLog(opts: TmuxOpts, name: string): void {
  const p = logPathFor(opts, name);
  try {
    if (existsSync(p)) rmSync(p);
  } catch {
    /* ignore */
  }
}
