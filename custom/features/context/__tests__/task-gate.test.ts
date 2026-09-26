/**
 * task-gate / context-resolver 纯逻辑测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvRatio, resolveContext, hasBackgroundTask } from '../budget/task-gate';
import { passesIdleGate, passesIdleGateAtTurnEnd } from '../logic';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'task-gate-'));
  process.env.PI_TMUX_REGISTRY = join(dir, 'tmux-registry.json');
});

afterEach(() => {
  delete process.env.PI_TMUX_REGISTRY;
  delete process.env.PI_SESSION_ID;
  delete process.env.PI_CONTEXT_RATIO_TEST;
  rmSync(dir, { recursive: true, force: true });
});

describe('readEnvRatio', () => {
  it('合法 0-1 返回数值，其余 undefined', () => {
    process.env.PI_CONTEXT_RATIO_TEST = '0.8';
    expect(readEnvRatio('PI_CONTEXT_RATIO_TEST')).toBe(0.8);
    process.env.PI_CONTEXT_RATIO_TEST = '1.2';
    expect(readEnvRatio('PI_CONTEXT_RATIO_TEST')).toBeUndefined();
    process.env.PI_CONTEXT_RATIO_TEST = 'abc';
    expect(readEnvRatio('PI_CONTEXT_RATIO_TEST')).toBeUndefined();
    delete process.env.PI_CONTEXT_RATIO_TEST;
    expect(readEnvRatio('PI_CONTEXT_RATIO_TEST')).toBeUndefined();
  });
});

describe('resolveContext', () => {
  it('优先真实 getContextUsage', () => {
    const r = resolveContext({ getContextUsage: () => ({ tokens: 123, contextWindow: 1000 }) }, 500, 2000);
    expect(r).toEqual({ tokens: 123, window: 1000 });
  });

  it('usage 不可用时回退到 provider token + 窗口', () => {
    expect(resolveContext({}, 500, 2000)).toEqual({ tokens: 500, window: 2000 });
    expect(resolveContext({ getContextUsage: () => ({ tokens: 0 }) }, 500, 2000)).toEqual({ tokens: 500, window: 2000 });
  });

  it('都不可用返回 null', () => {
    expect(resolveContext({}, 0, 2000)).toBeNull();
    expect(resolveContext({}, 500, 0)).toBeNull();
  });
});

describe('hasBackgroundTask', () => {
  it('无 PI_SESSION_ID 时为 false（门惰性安全）', () => {
    expect(hasBackgroundTask()).toBe(false);
  });

  it('注册表不存在时为 false', () => {
    process.env.PI_SESSION_ID = 'sess-1';
    expect(hasBackgroundTask()).toBe(false);
  });

  it('注册表中无本会话条目时为 false', () => {
    process.env.PI_SESSION_ID = 'sess-1';
    writeFileSync(process.env.PI_TMUX_REGISTRY!, JSON.stringify({ sessions: { a: { owner: 'other', name: 'x' } } }));
    expect(hasBackgroundTask()).toBe(false);
  });
});

describe('passesIdleGate（压缩门3：空闲判定）', () => {
  const now = 1_000_000_000;

  it('idleMs<=0 时关闭该门', () => {
    expect(passesIdleGate({ idleMs: 0, lastUserActivityTs: now - 1, taskDoneAt: 0, now })).toBe(true);
  });

  it('无活动记录时放行（不阻塞首次压缩）', () => {
    expect(passesIdleGate({ idleMs: 600_000, lastUserActivityTs: 0, taskDoneAt: 0, now })).toBe(true);
  });

  it('用户刚输入过 → 不压缩', () => {
    expect(passesIdleGate({ idleMs: 600_000, lastUserActivityTs: now - 60_000, taskDoneAt: 0, now })).toBe(false);
  });

  it('任务刚结束 → 不压缩（取用户/任务两者较晚者）', () => {
    expect(
      passesIdleGate({ idleMs: 600_000, lastUserActivityTs: now - 900_000, taskDoneAt: now - 1_000, now }),
    ).toBe(false);
  });

  it('静默满 IDLE_MS → 放行', () => {
    expect(
      passesIdleGate({ idleMs: 600_000, lastUserActivityTs: now - 600_000, taskDoneAt: now - 900_000, now }),
    ).toBe(true);
  });
});

describe('passesIdleGateAtTurnEnd（门3 在 turn_end 的正确判定）', () => {
  const now = 1_000_000_000;
  const IDLE = 600_000;

  it('idleMs<=0 时关闭该门', () => {
    expect(
      passesIdleGateAtTurnEnd({ idleMs: 0, preTurnIdleAnchor: now - 1, lastUserActivityTs: now, now }),
    ).toBe(true);
  });

  it('回归：用户本回合刚输入（锚点为 0，回合耗时很短）→ 不压缩', () => {
    // 修复前该场景恒为 false；修复后仍应 false（本回合用户活跃，且回合前无记录）
    expect(
      passesIdleGateAtTurnEnd({ idleMs: IDLE, preTurnIdleAnchor: 0, lastUserActivityTs: now - 5_000, now }),
    ).toBe(false);
  });

  it('核心修复：用户空闲 7.8 小时后回来发消息 → turn_end 放行（此前恒 false）', () => {
    expect(
      passesIdleGateAtTurnEnd({
        idleMs: IDLE,
        preTurnIdleAnchor: now - 28_000_000,
        lastUserActivityTs: now - 3_000,
        now,
      }),
    ).toBe(true);
  });

  it('连续对话（回合前仅隔 30s）→ 不压缩', () => {
    expect(
      passesIdleGateAtTurnEnd({
        idleMs: IDLE,
        preTurnIdleAnchor: now - 30_000,
        lastUserActivityTs: now - 3_000,
        now,
      }),
    ).toBe(false);
  });

  it('长工具循环：本回合已持续 ≥ IDLE_MS 且无用户输入 → 放行', () => {
    expect(
      passesIdleGateAtTurnEnd({
        idleMs: IDLE,
        preTurnIdleAnchor: now - 1_000,
        lastUserActivityTs: now - IDLE,
        now,
      }),
    ).toBe(true);
  });

  it('首次回合（两者均无记录）→ 不因空闲放行', () => {
    expect(
      passesIdleGateAtTurnEnd({ idleMs: IDLE, preTurnIdleAnchor: 0, lastUserActivityTs: now - 1_000, now }),
    ).toBe(false);
  });
});

describe('PER_TURN_ERASE（每轮历史擦除开关）', () => {
  afterEach(() => {
    delete process.env.PI_CONTEXT_ERASE;
    vi.resetModules();
  });

  it('默认关闭：缓存计费下每轮擦除净亏（单会话实测占 67% 成本）', async () => {
    delete process.env.PI_CONTEXT_ERASE;
    vi.resetModules();
    const mod = await import('../budget/task-gate');
    expect(mod.PER_TURN_ERASE).toBe(false);
  });

  it('PI_CONTEXT_ERASE=on 才启用（无前缀缓存的 provider）', async () => {
    process.env.PI_CONTEXT_ERASE = 'on';
    vi.resetModules();
    const mod = await import('../budget/task-gate');
    expect(mod.PER_TURN_ERASE).toBe(true);
  });

  it('其它取值（1/true/yes）不启用，避免误开', async () => {
    for (const v of ['1', 'true', 'yes', 'ON']) {
      process.env.PI_CONTEXT_ERASE = v;
      vi.resetModules();
      const mod = await import('../budget/task-gate');
      expect(mod.PER_TURN_ERASE, `PI_CONTEXT_ERASE=${v} 不应启用`).toBe(false);
    }
  });
});

describe('TOOL_LAYERING（工具按需加载开关）', () => {
  afterEach(() => {
    delete process.env.PI_CONTEXT_TOOL_LAYERING;
    vi.resetModules();
  });

  it('默认关闭：全部工具常驻（中途 enable 会整段断缓存，得不偿失）', async () => {
    delete process.env.PI_CONTEXT_TOOL_LAYERING;
    vi.resetModules();
    const mod = await import('../budget/task-gate');
    expect(mod.TOOL_LAYERING).toBe(false);
  });

  it('PI_CONTEXT_TOOL_LAYERING=on 才恢复休眠分层', async () => {
    process.env.PI_CONTEXT_TOOL_LAYERING = 'on';
    vi.resetModules();
    const mod = await import('../budget/task-gate');
    expect(mod.TOOL_LAYERING).toBe(true);
  });

  it('其它取值不启用，避免误开', async () => {
    for (const v of ['1', 'true', 'yes']) {
      process.env.PI_CONTEXT_TOOL_LAYERING = v;
      vi.resetModules();
      const mod = await import('../budget/task-gate');
      expect(mod.TOOL_LAYERING, `PI_CONTEXT_TOOL_LAYERING=${v} 不应启用`).toBe(false);
    }
  });
});
