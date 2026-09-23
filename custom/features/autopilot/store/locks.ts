import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync, closeSync } from 'node:fs';
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
  const tryOnce = (): boolean => {
    if (existsSync(lockF)) {
      try {
        const raw = readFileSync(lockF, 'utf-8').trim();
        const oldPid = raw.split(':')[0] ?? raw;
        const oldTs = Number(raw.split(':')[1] ?? 0);
        const staleByAge = oldTs > 0 && Date.now() - oldTs > LOCK_TTL_MS;
        if (oldPid && oldPid !== myPid && !staleByAge && existsSync(`/proc/${oldPid}`)) {
          return false;
        }
        unlinkSync(lockF);
      } catch {}
    }
    try {
      mkdirSync(schedulerDir(), { recursive: true });
      const fd = openSync(lockF, 'wx');
      closeSync(fd);
      writeFileSync(lockF, `${myPid}:${Date.now()}`, 'utf-8');
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
