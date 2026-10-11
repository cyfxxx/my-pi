/**
 * 调度锁的"陈旧持有者"回归测试（2026-10-11）
 *
 * ## 为什么需要这个测试
 *
 * `acquireSessionLock()` 判定"锁是否仍被持有"时用的是：
 *   `oldPid !== myPid && age <= TTL(24h) && existsSync('/proc/<oldPid>')`
 * ⇒ **只要 `/proc/<oldPid>` 存在就算"活着"** ✗ —— 但 **僵尸进程（zombie）的 `/proc/<pid>` 同样存在** ✗✗：
 *   一个已退出、只等父进程回收的进程，会让调度锁**长期显示为"被持有"** ⇒ `runDueTasks` 每轮"让出"
 *   ⇒ **调度器静默停摆**（无告警）✗。
 *
 * 本测试用**真实的僵尸进程**制造该环境（`fork` 后子进程立即退出、父进程不 `wait` ⇒ 子进程保持 Z 状态），
 * 然后断言：**锁应当被视为陈旧并被抢占**（`acquireSessionLock()` 返回 `true`）。
 *
 * ## 自证要求（必须能证伪）
 * 1. **前提断言**：先证明"(a) 该 PID 在 `/proc` 里存在 ✓、(b) 它的状态是 Z（僵尸）✓、(c) 锁文件确实写了该 PID ✓"
 *    —— 否则测试会**真空通过** ✗（"没测到真东西"却显示绿）。
 * 2. **反向断言**：另造一个**真正活着**的持有者（自己的另一个进程）⇒ 锁**必须仍被视为被持有** ✓
 *    —— 证明"陈旧判定"没有把正常持锁也误判成可抢占 ✗。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PY_OK = (() => {
  try {
    return spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

let dir = '';
let holder: ChildProcess | null = null;
let zombiePid = 0;

/** 读 /proc/<pid>/stat 的状态字段（第 3 个字段） */
function procState(pid: number): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] ?? '';
  } catch {
    return '';
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pi-lock-test-'));
  mkdirSync(join(dir, 'scheduler'), { recursive: true });
  process.env.PI_MEMORY_DIR = dir; // 隔离：绝不碰真实调度器状态

  if (!PY_OK) return;
  // 造一个真实僵尸：父进程 fork 后不 wait（子进程立即 _exit ⇒ 保持 Z 状态），父进程睡 120s
  const code =
    'import os,time\np=os.fork()\nif p==0:\n    os._exit(0)\nprint(p,flush=True)\ntime.sleep(120)\n';
  holder = spawn('python3', ['-c', code], { stdio: ['ignore', 'pipe', 'ignore'] });
  zombiePid = await new Promise<number>((resolve) => {
    let buf = '';
    holder?.stdout?.on('data', (d) => {
      buf += String(d);
      const n = Number(buf.trim().split('\n')[0]);
      if (Number.isInteger(n) && n > 0) resolve(n);
    });
    setTimeout(() => resolve(0), 5000);
  });
});

afterAll(() => {
  try {
    holder?.kill('SIGKILL'); // 按 PID 杀（绝不用 pkill -f）
  } catch {
    /* ignore */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  delete process.env.PI_MEMORY_DIR;
});

describe('调度锁：僵尸持有者必须被视为陈旧（否则调度器静默停摆）', () => {
  it('僵尸 PID 占用的锁 ⇒ 应当可被抢占；而真正活着的持有者 ⇒ 必须仍然阻挡', async () => {
    if (!PY_OK) {
      console.log('（跳过：本环境没有 python3，无法制造真实僵尸进程）');
      return;
    }
    const locks = await import('../store/locks');
    const { lockPath } = await import('../store/paths');

    // ---- 前提断言（防"真空通过"）----
    expect(zombiePid).toBeGreaterThan(0);
    expect(existsSync(`/proc/${zombiePid}`)).toBe(true); // 在 /proc 里存在（这正是旧判据被骗的原因）
    expect(procState(zombiePid)).toBe('Z'); // 而且确实是僵尸
    expect(lockPath()).toBe(join(dir, 'scheduler', 'scheduler.lock')); // 隔离生效（没落到真实目录）

    // ---- 案例 1：陈旧（僵尸）持有者 ⇒ 应当可抢占 ----
    writeFileSync(lockPath(), `${zombiePid}:${Date.now()}`);
    expect(readFileSync(lockPath(), 'utf-8')).toContain(String(zombiePid)); // 锁确实写了僵尸 PID
    const stolen = locks.acquireSessionLock();
    locks.releaseSessionLock();
    expect(stolen).toBe(true); // ← 当前实现会返回 false（僵尸被当成活人）⇒ 改前红

    // ---- 反向断言：真正活着的持有者 ⇒ 必须仍然阻挡（不能把正常持锁误判为可抢占）----
    const live = spawn('sleep', ['30'], { stdio: 'ignore' });
    try {
      writeFileSync(lockPath(), `${live.pid}:${Date.now()}`);
      expect(procState(live.pid as number)).not.toBe('Z');
      const blocked = locks.acquireSessionLock();
      locks.releaseSessionLock();
      expect(blocked).toBe(false); // 活着 ⇒ 必须让出
    } finally {
      try {
        live.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  });
});
