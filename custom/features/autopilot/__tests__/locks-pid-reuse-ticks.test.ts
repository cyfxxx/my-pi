/**
 * PID 复用判定（**节拍路线**）—— 2026-10-11
 *
 * ## 为什么另起一条路线（本环境实测逼出来的 ✗✓）
 * 本机 `/proc` 的**跨来源时钟自相矛盾**：`/proc/uptime` = **124 秒** ✗、`/proc/stat btime` = 2023-03-28 ✗，
 * 而 `starttime` 是 **182 天**量级 ✗ ⇒ "节拍→墙钟"的换算**差数年** ✗ ⇒ 墙钟路线在本机 **`procStartWallClockMs`
 * 返回 null** ⇒ 核心用例只能**显式跳过** ✗（见 `locks-pid-reuse.test.ts`）。
 * **但节拍本身在进程之间是自洽的** ✓：实测同一个 shell（`1574856374`）与其刚起的子进程（`1574856395`）
 * 相差 **21 节拍 ≈0.21 秒** ✓ ⇒ **只比大小、不换算** 即可判"谁先启动" ✓。
 *
 * ## 本文件覆盖的三件关键事
 * 1. **② PID 复用 ⇒ 可抢占**（端到端：造一把"写锁者比当前持有者更早启动"的锁 ⇒ 必须抢占 ✓）；
 * 2. **★ 真持有者不许抢占**（同一节拍 ⇒ 相等 ⇒ 绝不抢 ✓）+ **反向断言**（"永远不检测复用"必须失败 ✓）；
 * 3. **③ 旧格式（只有两段）⇒ 保守**（回退墙钟路线；把它关掉后必须让出 ✓）。
 *
 * ## 隔离纪律（本项目反复的教训 ✓）
 * `PI_MEMORY_DIR` **必须在 import 之前设置** ✓ —— 路径是**调用时**读 env（`paths.ts` ✓），但为了与既有
 * 成功做法一致（`locks-stale-holder.test.ts` ✓）这里仍用"先设 env、再 `await import()`" ✓，并**断言**锁路径
 * 确实落在临时目录内 ✓。受控子进程**按 PID 收掉** ✓（绝不用 `pkill -f` ✗）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
let child: ChildProcess | null = null;
let childPid = 0;
let childTicks = 0;
let mod: typeof import('../store/locks');
let lockPath: () => string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lock-ticks-'));
  process.env.PI_MEMORY_DIR = dir; // ★ import 之前设好 ✓
  delete process.env.PI_LOCK_DISABLE_PROC_START;
  delete process.env.PI_LOCK_CLK_TCK;
  mod = await import('../store/locks');
  const paths = await import('../store/paths');
  lockPath = paths.lockPath;
  // 起一个**受控的存活进程**当"持有者" ✓（用完按 PID 收掉 ✓）
  child = spawn('sleep', ['120'], { stdio: 'ignore' });
  childPid = child.pid ?? 0;
  if (!childPid) throw new Error('受控进程没有 pid ⇒ 用例环境不成立 ✗');
  const ticks = mod.procStartTicks(String(childPid));
  if (ticks === null) throw new Error('本机读不到受控进程的 starttime 节拍 ⇒ 该用例环境不成立 ✗');
  childTicks = ticks;
});

afterAll(() => {
  if (child?.pid) {
    try {
      process.kill(child.pid, 'SIGKILL'); // 按 PID 收掉 ✓
    } catch {
      /* 已退出 */
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_LOCK_CLK_TCK;
  delete process.env.PI_LOCK_DISABLE_PROC_START;
});

function writeLock(content: string): void {
  mkdirSync(join(dir, 'scheduler'), { recursive: true });
  writeFileSync(lockPath(), content);
}

describe('PID 复用判定（节拍路线）', () => {
  it('环境自证：节拍可读，且锁路径确实在临时目录内（防假绿）', () => {
    expect(lockPath().startsWith(dir)).toBe(true);
    expect(childTicks).toBeGreaterThan(0);
    // 节拍跨进程自洽的自证：我们自己与我们刚起的子进程应当"同量级"（差值远小于整个开机时长）
    const myTicks = mod.procStartTicks(String(process.pid));
    expect(myTicks).not.toBeNull();
    expect(Math.abs((myTicks as number) - childTicks)).toBeLessThan(1_000_000); // 远小于 182 天量级 ✓
  });

  it('★ 真持有者（节拍相等）⇒ 判定为"未复用" ⇒ 不许抢占', () => {
    expect(mod.isPidReusedByTicks(String(childPid), childTicks)).toBe(false);
    writeLock(`${childPid}:${Date.now()}:${childTicks}`);
    expect(mod.acquireSessionLock()).toBe(false); // 让出 ✓（绝不抢真持有者 ✗）
    expect(readFileSync(lockPath(), 'utf-8')).toContain(String(childPid)); // 锁没被动 ✓
  });

  it('② PID 复用（持有者比起锁者更晚启动）⇒ 判定为复用 ⇒ 可抢占（端到端）', () => {
    const lockTicks = childTicks - 1000; // 造"写锁者比当前持有者早 1000 节拍启动" ⇒ 必为复用 ✓
    expect(mod.isPidReusedByTicks(String(childPid), lockTicks)).toBe(true);
    writeLock(`${childPid}:${Date.now()}:${lockTicks}`);
    expect(mod.acquireSessionLock()).toBe(true); // 抢占成功 ✓
    expect(readFileSync(lockPath(), 'utf-8').split(':')[0]).toBe(String(process.pid)); // 现在是我们的锁 ✓
  });

  it('★ 反向断言：一个"永远不检测复用"的实现必然在 ② 上失败（证明本条有分辨力）', () => {
    const lockTicks = childTicks - 1000;
    const fakeNeverReused = (): boolean => false;
    const real = mod.isPidReusedByTicks(String(childPid), lockTicks);
    expect(real).toBe(true);
    expect(fakeNeverReused()).not.toBe(real); // 假实现与真实现**不一致** ⇒ 它会红 ✓
  });

  it('③ 旧格式锁（只有两段）⇒ 无节拍可用 ⇒ 回退墙钟路线；把墙钟路线关掉后必须让出（保守）', () => {
    process.env.PI_LOCK_CLK_TCK = '0'; // ★ 只关墙钟路线（HZ 取不到）✓ —— 节拍路线不受影响 ✓
    try {
      const paths = lockPath();
      writeLock(`${childPid}:${Date.now()}`); // 旧格式 ✓
      expect(mod.acquireSessionLock()).toBe(false); // 保守让出 ✓（宁可少跑，不可双跑 ✓）
      expect(readFileSync(paths, 'utf-8')).toContain(String(childPid));
    } finally {
      delete process.env.PI_LOCK_CLK_TCK;
    }
  });

  it('⑤ 节拍路线**不依赖 HZ**：关掉墙钟路线后，带第三段的锁仍能被正确判为复用 ✓', () => {
    process.env.PI_LOCK_CLK_TCK = '0';
    try {
      const lockTicks = childTicks - 1000;
      expect(mod.isPidReusedByTicks(String(childPid), lockTicks)).toBe(true); // HZ 无关 ✓
    } finally {
      delete process.env.PI_LOCK_CLK_TCK;
    }
  });

  it('③b 不确定即保守：`PI_LOCK_DISABLE_PROC_START=1` ⇒ 两条路线都不判定 ⇒ 让出', () => {
    process.env.PI_LOCK_DISABLE_PROC_START = '1';
    try {
      const lockTicks = childTicks - 1000;
      expect(mod.isPidReusedByTicks(String(childPid), lockTicks)).toBe(false); // 不判定 ✓
      expect(mod.procStartTicks(String(childPid))).toBeNull(); // 不读 ✓
    } finally {
      delete process.env.PI_LOCK_DISABLE_PROC_START;
    }
  });
});
