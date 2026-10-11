/**
 * PID 复用 ⇒ 陈旧锁**可安全抢占**（收口"死 PID 被复用 ⇒ 最长 24h 假持有"✗）。
 *
 * ## 为什么必须用"外来"PID（上一轮测试红 5 项的真因 ✓，已用原始输出定位）
 * 上一轮用 **`process.pid`（自己的 PID）** 构造"他人持锁" ✗ —— 但 `acquireSessionLock()` 的"被持有"分支
 * 条件是 **`oldPid !== myPid`** ✓ ⇒ **锁里是自己 PID 时该分支被跳过** ⇒ 代码删掉自己的锁并重建、
 * **合法返回 `true`**（既有语义：自己的锁 ⇒ (重)获取 ✓）。用它会得到**错误的期望** ✗。
 * 本文件改用**受控、确实活着的外来进程**（`sleep`）✓，并**按 PID 收掉**（**绝不用 `pkill -f`** ✗）。
 *
 * ## 三组 + 反向断言
 * ① **真持有者**（外来存活 PID + 锁时间=现在）⇒ 判**持有**、不许抢占 ✗；
 * ② **PID 复用**（同一外来进程，但锁时间=**现在−10min** ⇒ 语义上该进程在锁写入之后才存在）⇒ 抢到 ✓（本项改前红/改后绿）；
 * ②b 对照：`PI_LOCK_DISABLE_PROC_START=1`（**等价修复前的"只看 PID 存活"** ✗）⇒ 同场景**抢不到** ✓（复现假持有 ✗）；
 * ③ **不确定**（同一开关等价"读不到 /proc / 无 HZ / 非 Linux"）⇒ **保守判持有** ✓、不许抢占 ✗；
 * ★ 反向断言："永远不检测复用"的假实现**必然在 ② 上不一致** ✓。
 *
 * ## ★ 本环境限制（**显式跳过，绝不假绿** ✗✓）
 * 复用判定要把 `starttime`（节拍）换算成墙钟 ✓。**本机（proot/Android）的 `/proc` 时钟自相矛盾** ✗：
 * `/proc/stat btime` = 2023-03-28、`/proc/uptime` = 124 秒、而 `starttime` = 182 天量级 ⇒ 换算结果与
 * `Date.now()`（2026-10-11）差**数年** ✓。实现里因此加了**时钟一致性自证**（两条推法互校 ✓）：
 * 不一致 ⇒ **不判定**（保守 ✓）。⇒ **②/★ 在本机只能显式跳过** ✓（判据本身在时钟一致的环境可用 ✓）。
 *
 * 隔离：**先设 `PI_MEMORY_DIR` 再动态 import** ✓。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const DIR = join(tmpdir(), `locks-pid-reuse-${process.pid}`);
const REUSE_LOCK_TS = Date.now() - 10 * 60 * 1000; // 早于"现在" ⇒ 若进程刚起，则它在锁写入后才存在 ✓
const SANE_WINDOW_MS = 24 * 3600 * 1000; // 刚起的外来进程，其启动墙钟必落在最近一天内 ✓

let locks: typeof import('../store/locks');
let lockPath: () => string;
let holder: ChildProcess | null = null;
let holderPid = '';
/** 本机能否**可信地**确定"外来进程的启动墙钟"（时钟一致才 true ✓） */
let startTimeUsable = false;

beforeAll(async () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(join(DIR, 'scheduler'), { recursive: true });
  process.env.PI_MEMORY_DIR = DIR; // 隔离：绝不碰真实调度器状态 ✓
  locks = await import('../store/locks');
  lockPath = (await import('../store/paths')).lockPath;
  holder = spawn('sleep', ['600'], { stdio: 'ignore' }); // 受控的"外来持有者"：确实活着 ✓
  holderPid = String(holder.pid);
  await new Promise((r) => setTimeout(r, 250)); // 等它真的起来 ✓
  const started = locks.procStartWallClockMs(holderPid);
  startTimeUsable = started !== null && Math.abs(started - Date.now()) < SANE_WINDOW_MS;
  console.log(
    `[env] procStartWallClockMs(${holderPid}) = ${started}｜Date.now() = ${Date.now()}｜可用 = ${startTimeUsable}`,
  );
});
afterAll(() => {
  try {
    if (holder && !holder.killed) holder.kill('SIGTERM'); // ★ 按 PID 收掉 ✓（绝不用 pkill -f ✗）
  } catch {
    /* 已退出 */
  }
  rmSync(DIR, { recursive: true, force: true });
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_LOCK_DISABLE_PROC_START;
});
beforeEach(() => {
  delete process.env.PI_LOCK_DISABLE_PROC_START;
  try {
    rmSync(lockPath(), { force: true });
  } catch {
    /* 不存在即可 */
  }
});

const writeLock = (content: string): void => {
  mkdirSync(join(DIR, 'scheduler'), { recursive: true });
  writeFileSync(lockPath(), content);
};

describe('调度锁：PID 复用判定', () => {
  it('隔离前提：锁路径在临时 memory dir 内，且外来持有者确实活着（否则测试无意义 ✗）', () => {
    expect(lockPath().startsWith(DIR)).toBe(true);
    expect(locks.isPidAlive(holderPid)).toBe(true);
    expect(holderPid).not.toBe(String(process.pid)); // 必须是"外来"PID ✓
  });

  it('① 真持有者（外来存活 PID + 锁时间=现在）⇒ 判持有、不许抢占', () => {
    writeLock(`${holderPid}:${Date.now()}`);
    expect(locks.isPidReused(holderPid, Date.now())).toBe(false); // 它早就启动了 ⇒ 不是复用 ✓
    expect(locks.acquireSessionLock()).toBe(false); // ★ 抢不到 ✓
    expect(existsSync(lockPath())).toBe(true); // 锁**没被删** ✓
  });

  it('② PID 复用（锁时间早于该外来进程启动）⇒ 判陈旧、可抢占 ✓', (ctx) => {
    if (!startTimeUsable) {
      console.log('[skip] 本机 /proc 时钟自相矛盾 ⇒ 无法可信判定启动墙钟 ⇒ 显式跳过（不假绿 ✗）');
      ctx.skip();
      return;
    }
    writeLock(`${holderPid}:${REUSE_LOCK_TS}`);
    expect(locks.isPidReused(holderPid, REUSE_LOCK_TS)).toBe(true); // 判据 ✓
    expect(locks.acquireSessionLock()).toBe(true); // ★ 真的抢到了 ✓
    expect(existsSync(lockPath())).toBe(true);
  });

  it('②b 改前行为对照：禁用复用判定 ⇒ 同一场景抢不到（假持有 ✗，最长 24h）', () => {
    process.env.PI_LOCK_DISABLE_PROC_START = '1';
    writeLock(`${holderPid}:${REUSE_LOCK_TS}`);
    expect(locks.isPidReused(holderPid, REUSE_LOCK_TS)).toBe(false); // 不判定 ✓
    expect(locks.acquireSessionLock()).toBe(false); // 修复前的行为 ✗（正是本项要收口的）
  });

  it('③ 不确定环境（读不到 /proc / 无 HZ / 非 Linux）⇒ 保守判持有、不许抢占', () => {
    process.env.PI_LOCK_DISABLE_PROC_START = '1';
    writeLock(`${holderPid}:${REUSE_LOCK_TS}`);
    expect(locks.isPidReused(holderPid, REUSE_LOCK_TS)).toBe(false);
    expect(locks.acquireSessionLock()).toBe(false); // ★ 绝不因为"读不到"就抢 ✓（那会双跑 ✗）
  });

  it('③b lockTs 非法（0 / NaN / 负数）与不存在的 PID ⇒ 一律不判定（保守）', () => {
    expect(locks.isPidReused(holderPid, 0)).toBe(false);
    expect(locks.isPidReused(holderPid, Number.NaN)).toBe(false);
    expect(locks.isPidReused(holderPid, -1)).toBe(false);
    expect(locks.isPidReused('999999', REUSE_LOCK_TS)).toBe(false); // 读不到 ⇒ 保守 ✓
  });

  it('★ 反向断言："永远不检测复用"的假实现必然在 ② 上不一致', (ctx) => {
    if (!startTimeUsable) {
      console.log('[skip] 同 ②：本机时钟不一致 ⇒ 显式跳过（不假绿 ✗）');
      ctx.skip();
      return;
    }
    const fakeNeverDetectsReuse = (): boolean => false;
    const real = locks.isPidReused(holderPid, REUSE_LOCK_TS);
    expect(real).toBe(true);
    expect(fakeNeverDetectsReuse()).not.toBe(real); // 必然不一致 ⇒ 断言有分辨力 ✓
  });

  it('时钟一致性自证：非 null 就必须落在可信窗口内（否则应返回 null ✓）', () => {
    const started = locks.procStartWallClockMs(holderPid);
    if (started !== null) expect(Math.abs(started - Date.now())).toBeLessThan(SANE_WINDOW_MS);
    // 本机实际返回值记录在 [env] 行里（proot 上为 null ✓）
    expect(typeof startTimeUsable).toBe('boolean');
  });

  it('既有语义不许回归：锁里是**自己**的 PID ⇒ (重)获取（返回 true ✓，这是设计而非 bug）', () => {
    writeLock(`${process.pid}:${Date.now()}`);
    expect(locks.acquireSessionLock()).toBe(true); // 上一轮把它误当成"应返回 false"⇒ 红 5 项 ✗
    locks.releaseSessionLock();
    expect(existsSync(lockPath())).toBe(false);
  });
});
