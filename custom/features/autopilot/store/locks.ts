import { existsSync, readFileSync, mkdirSync, unlinkSync, openSync, closeSync, writeSync, statSync } from 'node:fs';
import { schedulerDir, lockPath } from './paths';

let storeWriteQueue: Promise<unknown> = Promise.resolve();
export function withStoreLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = storeWriteQueue.then(fn, fn);
  storeWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let lockPid: string | null = null;

export function isPidInTasklistOutput(stdout: string, pid: string | number): boolean {
  return stdout.split(/\s+/).includes(String(pid));
}

export function acquireSessionLock(): boolean {
  const lockF = lockPath();
  const myPid = String(process.pid);
  const LOCK_TTL_MS = 24 * 3600 * 1000;
  // 锁文件创建与内容写入之间存在极短的空文件窗口。旧实现把空内容当作「无主锁」直接
  // unlink，多个 pi 实例同刻启动（session_start 并发跑 runDueTasks）时会互相删锁，
  // 导致同一到期任务被并行执行（daily-review 双跑即由此而来）。
  // 空内容且 mtime 在宽限期内视为「正在写入」→ 退让；超期才视为崩溃残留并抢占。
  const EMPTY_LOCK_GRACE_MS = 60 * 1000;
  const tryOnce = (): boolean => {
    if (existsSync(lockF)) {
      try {
        const raw = readFileSync(lockF, 'utf-8').trim();
        const oldPid = raw.split(':')[0] ?? '';
        let lockTs = Number(raw.split(':')[1] ?? 0);
        if (!Number.isFinite(lockTs) || lockTs <= 0) {
          try {
            lockTs = statSync(lockF).mtimeMs;
          } catch {
            lockTs = 0;
          }
        }
        const age = lockTs > 0 ? Date.now() - lockTs : Number.POSITIVE_INFINITY;
        if (!oldPid) {
          if (age < EMPTY_LOCK_GRACE_MS) return false;
        } else if (oldPid !== myPid && age <= LOCK_TTL_MS && existsSync(`/proc/${oldPid}`)) {
          return false;
        }
        unlinkSync(lockF);
      } catch {}
    }
    try {
      mkdirSync(schedulerDir(), { recursive: true });
      // 原子写入：open('wx') 成功即持锁，内容与创建同一时刻落盘，消除空文件窗口。
      const fd = openSync(lockF, 'wx');
      try {
        writeSync(fd, `${myPid}:${Date.now()}`);
      } finally {
        closeSync(fd);
      }
      return true;
    } catch {
      return false;
    }
  };
  if (tryOnce()) {
    lockPid = myPid;
    return true;
  }
  return false;
}

export function releaseSessionLock(): void {
  if (!lockPid) return;
  try {
    const raw = readFileSync(lockPath(), 'utf-8').trim();
    if (raw.split(':')[0] === lockPid) unlinkSync(lockPath());
  } catch {}
  lockPid = null;
}
