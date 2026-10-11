/**
 * 产品侧加固：**任何测试都不可能驱动真实调度器**（2026-10-11）
 *
 * 背景（本会话实测的两起污染）✗：
 * ① 大批 `tool-stats-daily` 失败日志里，那些进程的 `argv[1]` 正是 **vitest worker** ⇒ 它们确实是被
 *    **测试运行器进程**驱动的（并发触发）；② 更早一次是 `usage.jsonl` 被 e2e 污染（只隔离了一个变量）。
 * ⇒ 结论：**只靠"逐个测试记得隔离"永远会漏**（两次先例）⇒ 必须在**调度器入口**加**测试环境早退** ✓。
 *
 * 本测试刻意**不设 `PI_MEMORY_DIR`**（指向**真实**调度器目录 ✓），并在**强制有到期任务**的前提下，
 * 真正走一遍 `session_start` 处理器 ⇒ 断言真实调度器目录**毫发无损**（日志数不变、`tasks.json` 不变）。
 * 加早退之前，这条会**失败**（真实目录被驱动）✗ —— 这正是它作为回归守门的价值 ✓。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isTestEnvironment, isTestRunnerEntryPath } from '../run/runner';
import { getSchedulerSkipStats } from '../index';

type Handler = (event: unknown, ctx?: unknown) => unknown;
const MEM = process.env.PI_MEMORY_DIR || join(process.cwd(), 'portable', 'memory');
const SCHED = join(MEM, 'scheduler');
const LOGS = join(SCHED, 'logs');
const TASKS = join(SCHED, 'tasks.json');

/** 宽松假 pi：已知桩 + 未知方法一律 no-op（避免因枚举不完备而假失败） */
function makeFakePi(): { pi: unknown; hooks: Map<string, Handler[]> } {
  const hooks = new Map<string, Handler[]>();
  const base: Record<string, unknown> = {
    hooks,
    on: (ev: string, h: Handler) => {
      const arr = hooks.get(ev) ?? [];
      arr.push(h);
      hooks.set(ev, arr);
    },
    sendMessage: () => {},
  };
  const pi = new Proxy(base, {
    get: (t, k: string) => (k in t ? t[k] : () => {}),
  });
  return { pi, hooks };
}

let backup: string | null = null;

/**
 * **前提必须由测试自己造** ✓（否则会"真空通过"：没有到期任务 ⇒ 提前返回 ⇒ 什么都测不到 ✗）。
 * 做法：备份真实 `tasks.json` ⇒ 只留**一个到期任务**且提示词极短（避免连跑多个 pi 会话）✓；
 * `afterAll` 里**必须恢复并校验** ✓。
 */
beforeAll(() => {
  if (!existsSync(TASKS)) return;
  backup = readFileSync(TASKS, 'utf8');
  const d = JSON.parse(backup) as { tasks?: Array<Record<string, unknown>> };
  let forced = 0;
  for (const t of d.tasks ?? []) {
    if (t.name === 'tool-stats-daily') {
      t.enabled = true;
      t.nextRun = '2026-01-01T00:00:00.000Z'; // 明确"已到期"
      t.prompt = '直接回复 done，不要调用任何工具。';
      forced++;
    } else {
      t.enabled = false;
    }
  }
  if (forced > 0) writeFileSync(TASKS, JSON.stringify(d, null, 2) + '\n');
});

afterAll(() => {
  if (backup !== null) writeFileSync(TASKS, backup); // 无条件恢复 ✓
});

const snapshot = (): { logs: number; tasks: string } => ({
  logs: existsSync(LOGS) ? readdirSync(LOGS).length : 0,
  tasks: existsSync(TASKS) ? readFileSync(TASKS, 'utf8') : '',
});

describe('测试环境不得驱动真实调度器', () => {
  it('判据本身：vitest 环境为真；**真实 pi CLI 入口**判为假（生产不变 ✓）', () => {
    expect(isTestEnvironment()).toBe(true);
    // 生产形态：argv[1] 是 pi 的 CLI ⇒ 判据必须为假（否则会误伤生产 ✗）
    expect(isTestRunnerEntryPath('/root/my-pi/vendor/pi/packages/coding-agent/dist/cli.js')).toBe(false);
    // 测试运行器形态：vitest/jest/mocha 的入口 ⇒ 必须为真
    expect(isTestRunnerEntryPath('/root/my-pi/node_modules/vitest/dist/workers/forks.js')).toBe(true);
    expect(isTestRunnerEntryPath('/x/node_modules/jest/bin/jest.js')).toBe(true);
    expect(isTestRunnerEntryPath(undefined)).toBe(false);
  });

  it('走一遍真实 session_start（真实调度器目录 + 强制到期任务）⇒ 目录毫发无损', async () => {
    const parsed = JSON.parse(readFileSync(TASKS, 'utf8')) as { tasks: Array<{ enabled?: boolean; nextRun?: string; name?: string }> };
    const due = parsed.tasks.filter((t) => t.enabled && Date.parse(String(t.nextRun)) <= Date.now());
    expect(due.length, '前提不成立：必须有至少一个“已到期且启用”的任务，否则本测试会真空通过 ✗').toBeGreaterThan(0);
    expect(due.some((t) => t.name === 'tool-stats-daily')).toBe(true);

    const before = snapshot();
    const { pi, hooks } = makeFakePi();
    const mod = await import('../index');
    mod.register(pi as unknown as ExtensionAPI);

    const handlers = hooks.get('session_start') ?? [];
    expect(handlers.length).toBeGreaterThan(0);

    const ctx = {
      hasUI: true,
      isIdle: () => true,
      ui: { notify: () => {}, setStatus: () => {} },
      sessionManager: { getSessionFile: () => '/tmp/scheduler-guard.jsonl' },
      shutdown: () => {},
    };
    for (const h of handlers) await h({ type: 'session_start' }, ctx);

    // `runDueTasks` 是 fire-and-forget ⇒ 给它足够窗口；有早退则**任何**时刻都不会变
    await new Promise((r) => setTimeout(r, 5000));

    const stats = getSchedulerSkipStats();
    expect(
      stats.testEnvironment,
      '决定性断言：调度器入口必须因“测试环境”被跳到（计数为 0 ⇒ 早退缺失或未生效 ✗）',
    ).toBeGreaterThan(0);

    const after = snapshot();
    expect(after.logs, '真实调度器日志数不得变化（否则说明测试驱动了真实调度器）').toBe(before.logs);
    expect(after.tasks, '真实 tasks.json 不得被改写（nextRun/lastResult 等）').toBe(before.tasks);
  }, 60_000);
});
