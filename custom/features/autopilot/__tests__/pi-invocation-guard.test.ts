import { describe, it, expect } from 'vitest';
import { getPiInvocation } from '../run/runner';

/**
 * 守卫回归（2026-10-11）：定时任务 `tool-stats-daily` 反复失败的根因是
 * `getPiInvocation` **无条件信任 `process.argv[1]`** —— 当本进程是 **vitest worker** 时，
 * `argv[1]` 是 vitest 的 forks 入口（`…/vitest/dist/chunks/init-forks.*.js`）
 * ⇒ 它会去 `node <init-forks.js> --mode json …` ⇒ 抛 `Expected worker to be run in node:child_process` ✗。
 *
 * 本测试**刻意跑在 vitest 里**：此时 `process.argv[1]` 就是那个 worker 入口 ✓
 * ⇒ 因此它能**真实复现**该场景，而不是"构造"一个假路径 ✓。
 */
describe('getPiInvocation 守卫（vitest worker 场景）', () => {
  it('premise：本测试进程的 argv[1] 确实指向 vitest（否则本测试无意义）', () => {
    const argv1 = process.argv[1] ?? '';
    // 打印真实值，便于人工核对；若这条 premise 不成立，下面的断言会失去意义 ⇒ 宁可让它红 ✓
    console.log('[premise] process.argv[1] =', argv1);
    expect(argv1).toContain('vitest');
  });

  it('绝不能把 vitest 的 worker 入口当成 pi 来调用（旧代码在此必红 ✗）', () => {
    const inv = getPiInvocation(['--mode', 'json', '-p', 'x']);
    const first = inv.args[0] ?? '';
    expect(first.includes('vitest')).toBe(false);
  });
});
