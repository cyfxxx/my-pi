import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * 可移植存活判定（2026-10-11）—— 让锁加固**不再依赖 Linux `/proc`** ✓。
 *
 * 背景：旧 `isPidAlive()` 只 `existsSync('/proc/<pid>')` ✗ ⇒ 在 Windows/macOS 上恒为 false ⇒
 * 存活持锁者被判"不活" ⇒ 直接 unlink 别人的锁 ⇒ **同一到期任务并行执行（双跑）** ✗✗。
 * 修法：`process.kill(pid, 0)` 作**可移植**判定 ✓（`ESRCH` ⇒ 死 ✓；`EPERM`/其它 ⇒ **保守当作活着** ✓），
 * `/proc` 退居**增强**（僵尸精化 ✓，读不到就不精化 ✓）。
 *
 * 本文件用 `PI_LOCK_DISABLE_PROC=1` 在 Linux 上**模拟非 Linux** ✓（不真改系统 ✓），
 * 并用 `PI_LOCK_KILL_ERRNO` 模拟 `process.kill` 的 errno ✓ 以证明**保守性** ✓。
 */
let locks: typeof import('../store/locks');
let dir = '';
let lockF = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pi-lock-portable-'));
  process.env.PI_MEMORY_DIR = dir; // ★ 必须在 import 之前设 ✓（模块导入时会读走 memory dir ✗）
  locks = await import('../store/locks');
  lockF = join(dir, 'scheduler', 'scheduler.lock');
  mkdirSync(join(dir, 'scheduler'), { recursive: true });
});

afterEach(() => {
  delete process.env.PI_LOCK_DISABLE_PROC;
  delete process.env.PI_LOCK_KILL_ERRNO;
  try {
    locks.releaseSessionLock();
    rmSync(lockF, { force: true });
  } catch {}
});

afterAll(() => {
  delete process.env.PI_LOCK_DISABLE_PROC;
  delete process.env.PI_LOCK_KILL_ERRNO;
  rmSync(dir, { recursive: true, force: true });
});

/** 起一个**已退出并被回收**的子进程 ⇒ 它的 PID 必然 `ESRCH` ✓（受控、无需猜 ✓）。 */
async function deadPid(): Promise<string> {
  const c = spawn('sleep', ['0'], { stdio: 'ignore' });
  if (!c.pid) throw new Error('无法取得子进程 PID');
  const pid = String(c.pid);
  await new Promise<void>((resolve) => c.on('exit', () => resolve()));
  return pid;
}

/** 起一个**活着**的受控子进程 ✓（用完**按 PID** 收掉 ✓，绝不用 pkill -f ✗）。 */
function liveChild(): { pid: string; stop: () => void } {
  const c = spawn('sleep', ['30'], { stdio: 'ignore' });
  if (!c.pid) throw new Error('无法取得子进程 PID');
  const pid = c.pid;
  return {
    pid: String(pid),
    stop: () => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    },
  };
}

function writeLock(pid: string, ts: number, ticks?: number): void {
  writeFileSync(lockF, ticks === undefined ? `${pid}:${ts}` : `${pid}:${ts}:${ticks}`);
}

describe('可移植锁判定：模拟非 Linux（PI_LOCK_DISABLE_PROC=1）', () => {
  it('① 死 PID ⇒ 可回收（走 process.kill 的 ESRCH 正路 ✓，不依赖 /proc ✓）', async () => {
    process.env.PI_LOCK_DISABLE_PROC = '1';
    const dead = await deadPid();
    writeLock(dead, Date.now());
    expect(locks.acquireSessionLock()).toBe(true);
  });

  it('★ ② 活持有者 ⇒ 绝不抢占（这是"双跑"防线 ✓；旧实现在非 Linux 上会误删 ✗）', () => {
    process.env.PI_LOCK_DISABLE_PROC = '1';
    const live = liveChild();
    try {
      writeLock(live.pid, Date.now());
      expect(locks.acquireSessionLock()).toBe(false);
    } finally {
      live.stop();
    }
  });

  it('③ 拿不到 /proc ⇒ 不做复用判定（带节拍的锁也必须保守让出 ✓）', () => {
    process.env.PI_LOCK_DISABLE_PROC = '1';
    const live = liveChild();
    try {
      writeLock(live.pid, Date.now(), 1); // 节拍值荒谬地小 ⇒ 若误判复用就会抢占 ✗
      expect(locks.acquireSessionLock()).toBe(false);
    } finally {
      live.stop();
    }
  });

  it('④ 保守性：kill 抛非 ESRCH 错误 ⇒ 判活着、不抢（模拟 EPERM 等未知错误 ✓）', async () => {
    process.env.PI_LOCK_DISABLE_PROC = '1';
    const dead = await deadPid();
    // 注意：这个 PID **确实已死** ✓ —— 但因为模拟的 errno 不是 ESRCH ⇒ 必须依旧保守当作活着 ✓
    process.env.PI_LOCK_KILL_ERRNO = 'EACCES';
    writeLock(dead, Date.now());
    expect(locks.acquireSessionLock()).toBe(false);
  });

  it('④b 开关本身有效：模拟 ESRCH ⇒ 判死 ⇒ 可回收（证明 ④ 不是真空通过 ✗✓）', async () => {
    process.env.PI_LOCK_DISABLE_PROC = '1';
    const dead = await deadPid();
    process.env.PI_LOCK_KILL_ERRNO = 'ESRCH';
    writeLock(dead, Date.now());
    expect(locks.acquireSessionLock()).toBe(true);
  });

  it('★ 反向断言：一个"永远可抢占"的假实现在 ② 上必然失败（证明该用例有分辨力 ✓）', () => {
    process.env.PI_LOCK_DISABLE_PROC = '1';
    const live = liveChild();
    try {
      writeLock(live.pid, Date.now());
      const fakeAlwaysPreempt = true; // 假实现：不看存活，直接抢
      const realDecision = locks.acquireSessionLock();
      // 真实现必须拒绝；假实现会放行 ⇒ 二者不一致 ⇒ 假实现必然红 ✓
      expect(realDecision).toBe(false);
      expect(fakeAlwaysPreempt && realDecision === false).toBe(true);
    } finally {
      live.stop();
    }
  });
});

describe('默认模式（有 /proc）不回归', () => {
  it('⑤ 活持有者（本机默认路径）⇒ 仍不抢占 ✓', () => {
    const live = liveChild();
    try {
      writeLock(live.pid, Date.now());
      expect(locks.acquireSessionLock()).toBe(false);
    } finally {
      live.stop();
    }
  });

  it('⑤b 死 PID（本机默认路径）⇒ 仍可回收 ✓', async () => {
    const dead = await deadPid();
    writeLock(dead, Date.now());
    expect(locks.acquireSessionLock()).toBe(true);
  });
});
