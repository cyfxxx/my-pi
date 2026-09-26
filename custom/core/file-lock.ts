/**
 * file-lock.ts — 跨进程文件锁（纯逻辑，零 Pi 依赖）
 *
 * 背景：读-改-写（RMW）JSON 状态文件在同一进程内是同步的，但多进程（多实例/
 * 后台脚本）并发时存在「A 读 → B 读 → A 写 → B 写」的丢更新窗口。原子写只能
 * 防半截文件，不能防丢更新，因此 RMW 需要跨进程串行化。
 *
 * 实现约定（与该仓库既有锁实现 link/state.ts、autopilot/store/locks.ts 一致）：
 *   - 锁文件用 `openSync(path, 'wx')` 独占创建；创建成功即持锁；
 *   - 锁内容写 `{pid, ts, host}`，用于陈旧判定；
 *   - 持有者进程已退出（本机 pid 不存在）或持锁超过 staleMs → 视为陈旧，抢占；
 *     进程异常退出时锁文件会残留，陈旧判定保证不会永久死锁；
 *   - 有界重试：超过 timeoutMs 仍拿不到锁 → 调用方告警后按无锁模式继续（原子写
 *     仍能保证文件完整，仅退化为极小概率丢更新），绝不无限等待。
 *
 * 为什么不用版本号 CAS / 单写队列：
 *   - 单写队列只串行化本进程，跨进程无效；
 *   - 文件系统上没有可移植的原子 CAS（Node 无 flock，rename 无法带「版本未变」条件，
 *     检查与 rename 之间存在 TOCTOU），除非依赖 Linux 专属 renameat2(RENAME_EXCHANGE)；
 *   - 注册表写入频率低、临界区为毫秒级，文件锁的代价可忽略。
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

export const FILE_LOCK_DEFAULT_TIMEOUT_MS = 2000;
export const FILE_LOCK_DEFAULT_STALE_MS = 15_000;
const DEFAULT_POLL_MS = 20;

export interface FileLockOptions {
  /** 最长等待时间，超时后告警并退化为无锁执行。默认 2000ms。 */
  timeoutMs?: number;
  /** 锁被持有超过该时长即视为陈旧（进程崩溃兜底）。默认 15s。 */
  staleMs?: number;
  /** 重试轮询间隔。默认 20ms。 */
  pollMs?: number;
  /** 超时告警回调；默认 console.error。 */
  onTimeout?: (info: { lockPath: string; timeoutMs: number; reason: string }) => void;
}

interface LockMeta {
  pid: number;
  ts: number;
  host: string;
}

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

function mtimeStale(lockPath: string, staleMs: number): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > staleMs;
  } catch {
    return false; // 文件已消失 → 下一轮 acquire 会成功
  }
}

/**
 * 判断锁是否可安全抢占：
 *   - 锁元数据所在主机与当前主机相同（或未记录）且 pid 已不存在 → 陈旧；
 *   - 持锁时间戳超过 staleMs → 陈旧（崩溃兜底，不依赖 pid 复用情况）；
 *   - 元数据损坏 → 退化为按文件 mtime 判断。
 */
export function isFileLockStale(lockPath: string, staleMs = FILE_LOCK_DEFAULT_STALE_MS): boolean {
  try {
    const raw = JSON.parse(readFileSync(lockPath, 'utf-8')) as Partial<LockMeta>;
    const pid = typeof raw.pid === 'number' ? raw.pid : null;
    const ts = typeof raw.ts === 'number' ? raw.ts : null;
    const host = typeof raw.host === 'string' ? raw.host : null;
    // 跨主机共享目录时不能拿本机 pid 表判断远端 pid；记录主机不同则只看时间戳
    if (pid !== null && (host === null || host === hostname()) && !pidAlive(pid)) return true;
    if (ts !== null) return Date.now() - ts > staleMs;
    return mtimeStale(lockPath, staleMs);
  } catch {
    return mtimeStale(lockPath, staleMs);
  }
}

/**
 * 尝试非阻塞获取锁。成功返回 release 函数，已被占用返回 null；
 * 其他 I/O 错误（如权限）抛出，由 withFileLock 捕获后告警降级。
 */
export function tryAcquireFileLock(lockPath: string): (() => void) | null {
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') return null;
    throw e;
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now(), host: hostname() }));
  } catch {
    /* 元数据写失败不阻断持锁；陈旧判定退化为 mtime/ts */
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* 已被他人抢占/删除 */
    }
  };
}

/**
 * 在文件锁保护下执行 fn（同步）。获取失败（超时/IO 错误）时告警并直接执行 fn，
 * 避免死锁；调用方若做 RMW，应保证写为原子写以降低降级风险。
 */
export function withFileLock<T>(lockPath: string, fn: () => T, opts: FileLockOptions = {}): T {
  const timeoutMs = opts.timeoutMs ?? FILE_LOCK_DEFAULT_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? FILE_LOCK_DEFAULT_STALE_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const warn = opts.onTimeout ?? defaultLockTimeoutWarning;

  const start = Date.now();
  const deadline = start + Math.max(0, timeoutMs);
  let release: (() => void) | null = null;
  let reason = `等待 ${timeoutMs}ms 超时，锁仍被占用`;
  try {
    for (;;) {
      if (isFileLockStale(lockPath, staleMs)) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* 已被他人抢占 */
        }
      }
      release = tryAcquireFileLock(lockPath);
      if (release) break;
      const now = Date.now();
      if (now >= deadline) break;
      sleepSync(Math.max(1, Math.min(pollMs, deadline - now)));
    }
  } catch (e) {
    reason = `锁不可用: ${e instanceof Error ? e.message : String(e)}`;
    release = null;
  }

  if (!release) warn({ lockPath, timeoutMs, reason });
  try {
    return fn();
  } finally {
    release?.();
  }
}

function defaultLockTimeoutWarning(info: { lockPath: string; timeoutMs: number; reason: string }): void {
  console.error(`[file-lock] 获取锁失败（${info.reason}）：${info.lockPath}，按无锁模式继续`);
}
