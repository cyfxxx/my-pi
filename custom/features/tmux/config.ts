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
  /** 同轮内 `tmux_wait` 的硬上限（秒）；≤0 表示停用上限 */
  waitCeilSec: number;
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
  // 同轮内等待的硬上限（P4 升格通道第一批，2026-10-01）：AGENTS.md 里"同轮内禁止等待、
  // 确需等待 timeout≤60s"是软引导。实测 `bash` 之外的顿挫同样集中在"前台同步等待"，
  // 而会话结束本来就有 watcher 注入通知（不必阻塞）——故把上限落到代码，≤0 停用。
  let waitCeilSec = 60;

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
  if (process.env.PI_TMUX_WAIT_CEIL_SEC) {
    const n = parseInt(process.env.PI_TMUX_WAIT_CEIL_SEC, 10);
    if (!Number.isNaN(n)) waitCeilSec = n;
  }
  return { bin, prefix, logDir, defaultLines, defaultTimeoutSec, waitCeilSec };
}

// ── 同轮内等待上限（P4 硬化：软引导"确需等待 timeout≤60s" → 代码约束）──

export interface WaitTimeout {
  /** 实际使用的超时秒数 */
  seconds: number;
  /** 是否被上限截断 */
  clamped: boolean;
  /** 生效上限（≤0 表示未启用） */
  ceiling: number;
  /** 请求值（未给或非法时为默认值） */
  requested: number;
}

/**
 * 计算 `tmux_wait` 的实际超时。
 *
 * 规则：显式给出的有限正数**原样尊重**（与 `bash` 上限的约定一致），随后按上限截断；
 * 未给/非法（非数、≤0）则用默认值，同样受上限约束。上限 ≤0 表示停用。
 */
export function clampWaitTimeout(
  requestedSec: number | undefined,
  defaultSec: number,
  ceilSec: number,
): WaitTimeout {
  const explicit =
    typeof requestedSec === 'number' && Number.isFinite(requestedSec) && requestedSec > 0
      ? requestedSec
      : defaultSec;
  const ceiling = Number.isFinite(ceilSec) ? ceilSec : 0;
  const clamped = ceiling > 0 && explicit > ceiling;
  return { seconds: clamped ? ceiling : explicit, clamped, ceiling, requested: explicit };
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
