/**
 * 会话切换守卫的守门测试（纯逻辑 + 真实 mode feature 接线）
 *
 * 背景（用户实测 2026-10-14）：TUI 里 `/new` / `/resume` 会**中止当前会话正在跑的那一轮**。
 * 根因在 pi：会话替换三条入口都先 `teardownCurrent()` → `session.abort()`
 * （`vendor/pi/.../core/agent-session-runtime.ts:167-177`）。守卫挂在 pi 的
 * `session_before_switch`（同文件 `:133-148`，在 `teardownCurrent` **之前**、且可 `cancel`），
 * 忙碌时**等到回合结束再放行**，于是 pi 的 abort 打不到任何东西。
 *
 * 这一层要锁死的是**行为契约**，不是实现细节：
 *   1) 空闲 ⇒ 立即放行（零延迟、零通知）；
 *   2) 忙碌 ⇒ **在回合结束前绝不 resolve**（这正是"改前必红"的判据：旧行为是立刻中止并切换）；
 *   3) 无 UI / 守卫关闭 ⇒ 一律放行，不改变非交互路径；
 *   4) 重复请求 ⇒ 取消后一条，不让回合结束后连切两次；
 *   5) 超预算 ⇒ 取消切换，但**绝不**替用户中断回合（文案与返回值都要对得上）；
 *   6) 守卫自身异常 ⇒ 放行（fail-open：不许因为守卫的 bug 让 `/new` 失效）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  SWITCH_GUARD_ENV,
  SWITCH_GUARD_BUDGET_ENV,
  isSwitchGuardEnabled,
  switchWaitBudgetMs,
  isBudgetExceeded,
  formatDuration,
  sessionLabel,
  switchTargetLabel,
  formatSwitchBusyNotice,
  formatSwitchWaitNotice,
  formatSwitchTimeoutNotice,
  waitForIdleStep,
} from '../session-switch-guard';

type Handler = (event: unknown, ctx?: unknown) => unknown;
type Notify = { message: string; level?: string };

interface FakePi {
  hooks: Map<string, Handler[]>;
}

let dir: string;
const ENV_KEYS = [SWITCH_GUARD_ENV, SWITCH_GUARD_BUDGET_ENV, 'PI_CODING_AGENT_DIR', 'PI_AGENT_MODE', 'PI_AGENT_MODE_SOURCE', 'PI_SESSION_MODE'];
let savedEnv: Record<string, string | undefined>;

function makeFakePi(): FakePi {
  const hooks = new Map<string, Handler[]>();
  const api: Record<string, unknown> = {
    hooks,
    on: (ev: string, h: Handler) => {
      const arr = hooks.get(ev) ?? [];
      arr.push(h);
      hooks.set(ev, arr);
    },
    registerTool: () => {},
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    registerToolRenderer: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    setSessionName: () => {},
    getActiveTools: () => [],
    setActiveTools: () => {},
    getAllTools: () => [],
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
  // 兜底空操作（与 mode-autopilot-restart.test.ts 同款）。then/catch/finally 必须返回 undefined，
  // 否则 `await` 会把假 pi 当 thenable 而挂死。
  return new Proxy(api, {
    get: (target, prop) => {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
      return prop in target ? target[prop as string] : () => {};
    },
  }) as unknown as FakePi;
}

async function setupMode(): Promise<FakePi> {
  vi.resetModules();
  const { register } = await import('../index');
  const pi = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  return pi;
}

function switchHandler(pi: FakePi): Handler {
  const handlers = pi.hooks.get('session_before_switch') ?? [];
  expect(handlers.length).toBe(1);
  return handlers[0];
}

interface CtxOptions {
  hasUI?: boolean;
  isIdle?: () => boolean;
  withUi?: boolean;
}

function makeCtx(opts: CtxOptions = {}): { ctx: Record<string, unknown>; notices: Notify[] } {
  const notices: Notify[] = [];
  const ctx: Record<string, unknown> = {
    hasUI: opts.hasUI ?? true,
    isIdle: opts.isIdle ?? (() => true),
  };
  if (opts.withUi !== false) {
    ctx.ui = {
      notify: (message: string, level?: string) => {
        notices.push({ message, level });
      },
    };
  }
  return { ctx, notices };
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'my-pi-switch-guard-'));
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'modes.json'), JSON.stringify({ default: 'full', modes: {} }));
  process.env.PI_CODING_AGENT_DIR = dir;
  delete process.env.PI_AGENT_MODE;
  delete process.env.PI_AGENT_MODE_SOURCE;
  delete process.env.PI_SESSION_MODE;
  delete process.env[SWITCH_GUARD_ENV];
  delete process.env[SWITCH_GUARD_BUDGET_ENV];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('守卫开关与预算（纯逻辑）', () => {
  it('默认启用；只有显式 off 才关闭（拼错的值不会悄悄换行为）', () => {
    expect(isSwitchGuardEnabled({})).toBe(true);
    expect(isSwitchGuardEnabled({ [SWITCH_GUARD_ENV]: '' })).toBe(true);
    expect(isSwitchGuardEnabled({ [SWITCH_GUARD_ENV]: 'on' })).toBe(true);
    expect(isSwitchGuardEnabled({ [SWITCH_GUARD_ENV]: 'OFF' })).toBe(false);
    expect(isSwitchGuardEnabled({ [SWITCH_GUARD_ENV]: ' off ' })).toBe(false);
    expect(isSwitchGuardEnabled({ [SWITCH_GUARD_ENV]: 'Off' })).toBe(false);
  });

  it('预算：0 / 非法 / 负数一律当"不设上限"（默认）', () => {
    expect(switchWaitBudgetMs({})).toBe(0);
    expect(switchWaitBudgetMs({ [SWITCH_GUARD_BUDGET_ENV]: '' })).toBe(0);
    expect(switchWaitBudgetMs({ [SWITCH_GUARD_BUDGET_ENV]: 'abc' })).toBe(0);
    expect(switchWaitBudgetMs({ [SWITCH_GUARD_BUDGET_ENV]: '0' })).toBe(0);
    expect(switchWaitBudgetMs({ [SWITCH_GUARD_BUDGET_ENV]: '-1000' })).toBe(0);
    expect(switchWaitBudgetMs({ [SWITCH_GUARD_BUDGET_ENV]: '1500' })).toBe(1500);
  });

  it('isBudgetExceeded：0 = 永不超时', () => {
    expect(isBudgetExceeded(999_999, 0)).toBe(false);
    expect(isBudgetExceeded(999, 1000)).toBe(false);
    expect(isBudgetExceeded(1000, 1000)).toBe(true);
  });
});

describe('waitForIdleStep（注入时钟，逻辑本身）', () => {
  const clock = (idleAt: number, calls = { n: 0 }, step = 250) => {
    let nowMs = 0;
    return {
      opts: {
        isIdle: () => calls.n >= idleAt,
        budgetMs: 0,
        pollMs: step,
        now: () => nowMs,
        sleep: async (ms: number) => {
          calls.n++;
          nowMs += ms;
        },
      },
      calls,
      elapsed: () => nowMs,
    };
  };

  it('已空闲 ⇒ 立刻返回 idle，且一次都不 sleep', async () => {
    const c = clock(0);
    const kind = await waitForIdleStep({ ...c.opts, isIdle: () => true });
    expect(kind).toBe('idle');
    expect(c.calls.n).toBe(0);
  });

  it('忙碌后转空闲 ⇒ 返回 idle（预算 0 = 不设上限，不会提前超时）', async () => {
    const c = clock(3);
    const kind = await waitForIdleStep(c.opts);
    expect(kind).toBe('idle');
    expect(c.calls.n).toBeGreaterThanOrEqual(3);
  });

  it('超预算 ⇒ 返回 timeout（不会无限等），且耗时不超过预算 + 一个轮询', async () => {
    const c = clock(Number.POSITIVE_INFINITY);
    const kind = await waitForIdleStep({ ...c.opts, budgetMs: 1000 });
    expect(kind).toBe('timeout');
    expect(c.elapsed()).toBeLessThanOrEqual(1000 + 250);
  });
});

describe('通知文案', () => {
  it('目标标签：new = 新建会话；resume 显示文件名；缺路径时如实说明', () => {
    expect(switchTargetLabel('new', undefined)).toBe('新建会话');
    expect(switchTargetLabel('resume', '/a/b/2026-10-14T17-27-31-186Z_abc.jsonl')).toBe(
      '切换会话 2026-10-14T17-27-31-186Z_abc.jsonl',
    );
    expect(switchTargetLabel('resume', undefined)).toContain('目标路径未提供');
    expect(sessionLabel(undefined)).toBe('');
    expect(sessionLabel('C:\\x\\s.jsonl')).toBe('s.jsonl');
  });

  it('formatDuration：秒 / 分钟，非法值不产生 NaN', () => {
    expect(formatDuration(250)).toBe('1 秒');
    expect(formatDuration(60_000)).toBe('1 分钟');
    expect(formatDuration(Number.NaN)).toBe('1 秒');
  });

  it('延后通知：说明"不会被中断"与 Esc 逃生口；设了预算才提预算', () => {
    const noBudget = formatSwitchWaitNotice({ reason: 'new', budgetMs: 0 });
    expect(noBudget).toContain('新建会话');
    expect(noBudget).toContain('不会被中断');
    expect(noBudget).toContain('Esc');
    expect(noBudget).not.toContain('最多等');
    const withBudget = formatSwitchWaitNotice({ reason: 'new', budgetMs: 300_000 });
    expect(withBudget).toContain('最多等 5 分钟');
  });

  it('超时通知：明确说"已取消切换、没有中断你的回合"，不谎称做了别的事', () => {
    const text = formatSwitchTimeoutNotice({ reason: 'resume', targetSessionFile: '/a/s.jsonl', waitedMs: 60_000 });
    expect(text).toContain('s.jsonl');
    expect(text).toContain('已取消');
    expect(text).toContain('没有');
    expect(text).toContain('中断你的回合');
  });

  it('重复请求通知：告诉用户上一条还在等', () => {
    expect(formatSwitchBusyNotice()).toContain('已在等');
  });
});

describe('接线：真实 mode feature 的 session_before_switch', () => {
  it('空闲时零延迟放行、零通知（不引入任何副作用）', async () => {
    const pi = await setupMode();
    const handler = switchHandler(pi);
    const { ctx, notices } = makeCtx({ isIdle: () => true });
    const startedAt = Date.now();
    const result = await handler({ type: 'session_before_switch', reason: 'new' }, ctx);
    expect(result).toBeUndefined();
    expect(notices).toHaveLength(0);
    expect(Date.now() - startedAt).toBeLessThan(50);
  });

  it('忙碌时**在回合结束前绝不放行**（改前必红：旧行为是立刻 abort 并切换）', async () => {
    const pi = await setupMode();
    const handler = switchHandler(pi);
    let idle = false;
    const { ctx, notices } = makeCtx({ isIdle: () => idle });
    let settled = false;
    const pending = Promise.resolve(handler({ type: 'session_before_switch', reason: 'new' }, ctx)).then((r) => {
      settled = true;
      return r;
    });
    // 两个轮询周期（250ms × 2）后仍未放行 —— 这就是"这一轮没被中断"的直接判据
    await new Promise((r) => setTimeout(r, 600));
    expect(settled).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain('新建会话');
    idle = true; // 回合结束
    await expect(pending).resolves.toBeUndefined(); // 放行：由 pi 自己完成切换
    expect(settled).toBe(true);
  });

  it('无 UI（RPC / -p 无头）：即使忙碌也立即放行', async () => {
    const pi = await setupMode();
    const handler = switchHandler(pi);
    const { ctx, notices } = makeCtx({ hasUI: false, isIdle: () => false });
    const result = await handler({ type: 'session_before_switch', reason: 'resume', targetSessionFile: '/a/s.jsonl' }, ctx);
    expect(result).toBeUndefined();
    expect(notices).toHaveLength(0);
  });

  it('守卫显式关闭：即使忙碌也立即放行（恢复上游行为）', async () => {
    process.env[SWITCH_GUARD_ENV] = 'off';
    const pi = await setupMode();
    const handler = switchHandler(pi);
    const { ctx, notices } = makeCtx({ isIdle: () => false });
    const result = await handler({ type: 'session_before_switch', reason: 'new' }, ctx);
    expect(result).toBeUndefined();
    expect(notices).toHaveLength(0);
  });

  it('重复请求：后一条立即取消并说明，前一条仍在等（回合结束后只切一次）', async () => {
    const pi = await setupMode();
    const handler = switchHandler(pi);
    let idle = false;
    const first = makeCtx({ isIdle: () => idle });
    const second = makeCtx({ isIdle: () => idle });
    const pending = Promise.resolve(handler({ type: 'session_before_switch', reason: 'new' }, first.ctx));
    await new Promise((r) => setTimeout(r, 300));
    const secondResult = await handler(
      { type: 'session_before_switch', reason: 'resume', targetSessionFile: '/a/s.jsonl' },
      second.ctx,
    );
    expect(secondResult).toEqual({ cancel: true });
    expect(second.notices).toHaveLength(1);
    expect(second.notices[0].message).toContain('已在等');
    idle = true;
    await expect(pending).resolves.toBeUndefined();
  });

  it('超预算：取消切换，但**不**替用户中断回合（文案与返回值一致）', async () => {
    process.env[SWITCH_GUARD_BUDGET_ENV] = '300';
    const pi = await setupMode();
    const handler = switchHandler(pi);
    const { ctx, notices } = makeCtx({ isIdle: () => false });
    const startedAt = Date.now();
    const result = await handler({ type: 'session_before_switch', reason: 'new' }, ctx);
    expect(result).toEqual({ cancel: true });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
    expect(notices).toHaveLength(2);
    expect(notices[0].message).toContain('最多等');
    expect(notices[1].level).toBe('warning');
    expect(notices[1].message).toContain('取消');
    expect(notices[1].message).toContain('没有');
  });

  it('isIdle 抛异常（会话正在关闭）⇒ 当作空闲放行，绝不因此死等', async () => {
    const pi = await setupMode();
    const handler = switchHandler(pi);
    const { ctx, notices } = makeCtx({
      isIdle: () => {
        throw new Error('session is closing');
      },
    });
    const startedAt = Date.now();
    const result = await handler({ type: 'session_before_switch', reason: 'new' }, ctx);
    expect(result).toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(50);
    expect(notices).toHaveLength(0);
  });

  it('ctx.ui 缺失也不炸（通知失败不影响判定：仍要等到回合结束）', async () => {
    const pi = await setupMode();
    const handler = switchHandler(pi);
    let idle = false;
    const { ctx } = makeCtx({ isIdle: () => idle, withUi: false });
    const pending = Promise.resolve(handler({ type: 'session_before_switch', reason: 'new' }, ctx));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(settled).toBe(false);
    idle = true;
    await expect(pending).resolves.toBeUndefined();
  });

  it('mode 注册时确实挂了 session_before_switch（事件名与 pi 契约一致由 check-features 另守）', async () => {
    const pi = await setupMode();
    expect(pi.hooks.get('session_before_switch')?.length).toBe(1);
  });
});
