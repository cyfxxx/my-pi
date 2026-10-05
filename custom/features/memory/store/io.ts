/**
 * Memory Feature — 存储底层 I/O 助手（纯逻辑，零 Pi 依赖）
 *
 * 供 notes/summaries/storage 共享：数据目录解析、目录创建、损坏文件备份、JSON 读取。
 */

import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir, getMemoryNamespace } from '../../../core/config';
import { withFileLock, type FileLockOptions } from '../../../core/file-lock';

/** 记忆数据目录：<memoryDir>[/<namespace>]。命名空间由 mode 隔离注入（roleplay 等）。 */
export function dataDir(): string {
  const base = process.env.PI_MEMORY_DIR || getMemoryDir();
  const ns = getMemoryNamespace();
  return ns ? join(base, ns) : base;
}

export function ensureDir(): void {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function backupCorruptFile(file: string, kind: string): void {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.corrupt-${stamp}`;
    renameSync(file, backup);
    console.error(`[memory] ${kind} 存储损坏（${file}）：已备份到 ${backup}，请人工检查恢复。`);
  } catch (e) {
    console.error(`[memory] ${kind} 存储损坏（${file}）且备份失败，原文件保持原位：`, e);
  }
}

export function readStoreFile<T>(file: string, kind: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch (err) {
    if (!existsSync(file)) return null;
    const isParseError = err instanceof SyntaxError;
    if (!isParseError) {
      console.error(`[memory] ${kind} 读取失败（非解析错误，不备份）:`, err instanceof Error ? err.message : err);
      return null;
    }
    backupCorruptFile(file, kind);
    return null;
  }
}

// ── 跨进程 RMW 锁 ──

/** 数据文件的锁路径：与数据同目录的 `<file>.lock`（`portable/memory/*` 已被 gitignore） */
export function memoryLockPath(file: string): string {
  return `${file}.lock`;
}

/** 锁参数可环境覆盖（用例里缩短超时；与 tmux/registry.ts 同约定） */
function lockOptions(): FileLockOptions {
  const opts: FileLockOptions = {};
  const timeout = Number(process.env.PI_MEMORY_LOCK_TIMEOUT_MS);
  if (Number.isFinite(timeout) && timeout >= 0) opts.timeoutMs = timeout;
  const stale = Number(process.env.PI_MEMORY_LOCK_STALE_MS);
  if (Number.isFinite(stale) && stale > 0) opts.staleMs = stale;
  return opts;
}

/**
 * 在跨进程文件锁下执行「读 → 改 → 原子写」。
 *
 * 为什么需要：`entries.json`/`summaries.json`/`notes.json` 的并发写者不止一个——pi 会话内
 * 的记忆工具、`scripts/memory-store.mjs`（headless 入库）、回顾/订阅类定时任务，可能同时
 * 在同一台机器上跑。原子写只能保证文件不半截，防不住「A 读 → B 读 → A 写 → B 写」的丢更新。
 * 现有的"写前重读盘 + 按 id/键合并"已经大幅缩小了窗口，锁把剩下的窗口也关掉。
 *
 * 拿不到锁时（超时/IO 错误）`withFileLock` 告警后按无锁继续，保证不会死锁——退化为与加锁前
 * 相同的极小概率丢更新，不会更差。
 */
export function withMemoryLock<T>(file: string, fn: () => T): T {
  return withFileLock(memoryLockPath(file), fn, lockOptions());
}
