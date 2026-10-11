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

/** 读 `/proc/<pid>/stat` 的状态字段（第 3 个字段）；读不到 ⇒ 返回 `''`（调用方须**保守**处理 ✓）。 */
function procState(pid: string): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const after = stat.slice(stat.lastIndexOf(')') + 2);
    return after.split(' ')[0] ?? '';
  } catch {
    return '';
  }
}

/**
 * PID 是否"真的还活着" —— **僵尸（`Z`）不算活着** ✗✓。
 *
 * 为什么必须区分：僵尸进程的 `/proc/<pid>` **同样存在** ✗，所以旧的 `existsSync('/proc/<pid>')`
 * 会把"已退出、只等父进程回收"的进程当成持锁者 ⇒ 调度锁**长期显示为被持有** ⇒ `runDueTasks`
 * 每轮"让出" ⇒ **调度器静默停摆**（2026-10-11 实测：僵尸 PID 占用时 `acquireSessionLock()` 返回 false ✗）。
 *
 * 保守性：读不到 stat 时**当作活着** ✓（宁可让出，也不误抢正在执行的锁 ✓）。
 * 非 Linux（无 `/proc`）⇒ 与旧行为一致（视作不活 ✓）。
 */
export function isPidAlive(pid: string): boolean {
  if (!/^[0-9]+$/.test(pid)) return false;
  if (!existsSync(`/proc/${pid}`)) return false;
  const st = procState(pid);
  if (st === 'Z') return false;
  return true;
}

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
        } else if (oldPid !== myPid && age <= LOCK_TTL_MS && isPidAlive(oldPid)) {
          return false;
        }
        // ★ 比较后再删（2026-10-11）：旧实现直接 unlink ✗ —— 两个实例可能**同时**判定同一把锁陈旧，
        // 于是 A 删旧锁+建新锁后，B 仍按**先前读到**的内容把 **A 的新锁**删掉 ✗✗ ⇒ 两边都以为持有 ⇒
        // 同一到期任务被并行执行（正是注释里说的"互相删锁"）。现在：只有内容**仍等于**判定时看到的那份才删 ✓。
        const recheck = readFileSync(lockF, 'utf-8').trim();
        if (recheck === raw) unlinkSync(lockF);
        else return false; // 期间有人动过锁 ⇒ 让出本轮，下次再试 ✓（宁可少跑，不可双跑 ✓）
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
      // ★ 建锁后回读校验（2026-10-11）：确认锁里**是我们**的 PID ✓ ——
      // 若在"创建"与"回读"之间被别人抢占，就不能认为自己持锁 ✗（否则仍是双跑 ✓）。
      const back = readFileSync(lockF, 'utf-8').trim();
      if (back.split(':')[0] !== myPid) return false;
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
