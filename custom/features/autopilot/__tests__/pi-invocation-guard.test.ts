import { describe, it, expect } from 'vitest';
import { getPiInvocation, isPiCliEntryPath } from '../run/runner';

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

/**
 * ①-h（2026-10-11）：判据从"测试运行器**黑名单**"升级为"**正面要求**是 pi CLI 入口" ✓。
 * 起因 ✗：经 `tsx` 跑仓库内脚本时，`argv[1]` **既非 pi CLI 也非 vitest** ⇒ 旧判据放行 ⇒
 * 子进程被拼成 `node <脚本> --mode json …` ⇒ `Cannot find module '…/autopilot/index'` ✗。
 */
describe('isPiCliEntryPath（正面要求：只认有据可查的合法入口 ✓）', () => {
  it('(a) 真实 pi CLI 入口 ⇒ 合法 ✓（打包/源码构建两种形态，逐条有据）', () => {
    // 实测 scripts/pi-supervisor.sh:23 就用这个路径 ✓
    expect(isPiCliEntryPath('/root/my-pi/vendor/pi/packages/coding-agent/dist/cli.js')).toBe(true);
    expect(isPiCliEntryPath('/repo/vendor/pi/packages/coding-agent/src/cli.ts')).toBe(true);
    // 实测 command -v pi ⇒ …/pi-node/<ver>/bin/pi ✓（PATH 上的启动器）
    expect(isPiCliEntryPath('/root/.local/share/pi-node/node-v22.23.1-linux-arm64/bin/pi')).toBe(true);
  });

  it('(b) tsx 跑的仓库内脚本 ⇒ 不合法 ✗（这正是新失败场景；旧判据在此放行 ⇒ 必红 ✓）', () => {
    expect(isPiCliEntryPath('/tmp/sched-probe/due.mts')).toBe(false);
    expect(isPiCliEntryPath('/root/my-pi/custom/features/autopilot/__probe__.mts')).toBe(false);
  });

  it('(c) vitest worker 入口 ⇒ 不合法 ✗（不许回归 ✓），且不得放宽到"任意 .js/.ts" ✗', () => {
    expect(isPiCliEntryPath('/root/my-pi/node_modules/vitest/dist/workers/forks.js')).toBe(false);
    expect(isPiCliEntryPath('/root/my-pi/node_modules/vitest/dist/chunks/init-forks.X.js')).toBe(false);
    // 反面：普通 js/ts（哪怕叫 cli.js，只要不在 coding-agent 下）也不算合法 ✓
    expect(isPiCliEntryPath('/tmp/some/cli.js')).toBe(false);
    expect(isPiCliEntryPath('/tmp/some/index.ts')).toBe(false);
    expect(isPiCliEntryPath(undefined)).toBe(false);
  });

  it('反向断言：一个"永远返回 true"的假实现必然在上述 ✗ 用例上失败 ✓', () => {
    const fakeAlwaysLegit = () => true;
    const bad = ['/tmp/sched-probe/due.mts', '/root/my-pi/node_modules/vitest/dist/workers/forks.js'];
    // 真实现对每个都返回 false；假实现会返回 true ⇒ 二者必然不一致 ⇒ 断言有分辨力 ✓
    expect(bad.every((p) => isPiCliEntryPath(p) === false)).toBe(true);
    expect(bad.some((p) => fakeAlwaysLegit() !== isPiCliEntryPath(p))).toBe(true);
  });
});
