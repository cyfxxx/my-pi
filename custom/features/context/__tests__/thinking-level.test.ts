/**
 * thinking 档位自适应切档测试（迁移自 pi-tools pi-context/tests/thinking-level.test.ts，
 * 审计读取改为本模块 loadLevelChanges + PI_LEVEL_CHANGE_FILE）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createState,
  tickThinkingLevel,
  proposeThinkingLevel,
  clampToLadder,
  lower,
  upper,
  pressureOf,
  inferTaskType,
  loadLevelChanges,
  clampForCacheSafety,
  cacheSafeMaxLevel,
  MIN_INTERVAL_MS,
  type AutoThinkLevel,
} from '../budget/thinking-level';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinking-level-'));
  process.env.PI_LEVEL_CHANGE_FILE = join(dir, 'level-changes.jsonl');
});

afterEach(() => {
  delete process.env.PI_LEVEL_CHANGE_FILE;
  rmSync(dir, { recursive: true, force: true });
});

function makeNow(base = 1_000_000) {
  let t = base;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function recordEvents() {
  const calls: AutoThinkLevel[] = [];
  const setLevel = (l: AutoThinkLevel) => calls.push(l);
  return { calls, setLevel };
}

describe('clampToLadder', () => {
  it('max→high、乱档归位', () => {
    expect(clampToLadder('max')).toBe('high');
    expect(clampToLadder('minimal')).toBe('low');
    expect(clampToLadder('off')).toBe('low');
    expect(clampToLadder('high')).toBe('high');
    expect(clampToLadder('medium')).toBe('medium');
  });
});

describe('inferTaskType', () => {
  it('探索/代码/审阅/其他', () => {
    expect(inferTaskType('explore the repo and find usages')).toBe('explore');
    expect(inferTaskType('review this patch')).toBe('review');
    expect(inferTaskType('implement the fix')).toBe('code');
    expect(inferTaskType('你好')).toBe('other');
  });
});

describe('pressureOf', () => {
  it('阈值边界', () => {
    expect(pressureOf(0.97)).toBe('critical');
    expect(pressureOf(0.8)).toBe('mid');
    expect(pressureOf(0.5)).toBe('low');
  });
});

describe('lower/upper', () => {
  it('阶梯方向正确且边界为 null', () => {
    expect(lower('high')).toBe('medium');
    expect(lower('low')).toBeNull();
    expect(upper('high')).toBeNull();
    expect(upper('low')).toBe('medium');
  });
});

describe('tickThinkingLevel', () => {
  it('critical 连续 2 次降挡并记账', () => {
    const s = createState('high');
    const { calls, setLevel } = recordEvents();
    const clk = makeNow();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBe('medium');
    expect(calls).toEqual(['medium']);
    expect(s.current).toBe('medium');
    const ev = loadLevelChanges().find((l) => l.type === 'level-change');
    expect(ev).toBeTruthy();
    expect(ev?.from).toBe('high');
    expect(ev?.to).toBe('medium');
    expect(ev?.source).toBe('auto');
  });

  it('单次 critical 不降（防偶发）', () => {
    const s = createState('high');
    const { calls, setLevel } = recordEvents();
    const clk = makeNow();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    expect(tickThinkingLevel(s, 0.5, setLevel, clk.now())).toBeNull();
    expect(s.current).toBe('high');
    expect(calls).toEqual([]);
  });

  it('已到下限不越（low 再 critical 不再降）', () => {
    const s = createState('medium');
    const { calls, setLevel } = recordEvents();
    const clk = makeNow();
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBe('low');
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    expect(s.current).toBe('low');
    expect(calls).toEqual(['low']);
  });

  it('回落 low 连续 3 次升回，不越基准', () => {
    const s = createState('high');
    const { calls, setLevel } = recordEvents();
    const clk = makeNow();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBe('medium');
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBe('low');
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.3, setLevel, clk.now())).toBeNull();
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.3, setLevel, clk.now())).toBeNull();
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.3, setLevel, clk.now())).toBe('medium');
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.3, setLevel, clk.now())).toBeNull();
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.3, setLevel, clk.now())).toBeNull();
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.3, setLevel, clk.now())).toBe('high');
    clk.advance(MIN_INTERVAL_MS + 1);
    expect(tickThinkingLevel(s, 0.3, setLevel, clk.now())).toBeNull();
    expect(s.current).toBe('high');
    expect(calls.filter((x) => x !== 'high')).toEqual(['medium', 'low', 'medium']);
  });

  it('防抖死区：切换后时间窗内不再次切换', () => {
    const s = createState('high');
    const { setLevel } = recordEvents();
    const clk = makeNow();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBe('medium');
    clk.advance(MIN_INTERVAL_MS - 10);
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    clk.advance(20);
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBeNull();
    expect(tickThinkingLevel(s, 0.97, setLevel, clk.now())).toBe('low');
  });

  it('中段压力清零连续计数且不切', () => {
    const s = createState('high');
    const { calls, setLevel } = recordEvents();
    const clk = makeNow();
    expect(tickThinkingLevel(s, 0.8, setLevel, clk.now())).toBeNull();
    expect(tickThinkingLevel(s, 0.85, setLevel, clk.now())).toBeNull();
    expect(s.criticalStreak).toBe(0);
    expect(s.lowStreak).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('proposeThinkingLevel（模型提议·规则审批）', () => {
  it('放行：合法档位审批后切换并记账 source=model', () => {
    const s = createState('high');
    const { calls, setLevel } = recordEvents();
    const clk = makeNow();
    const r = proposeThinkingLevel(s, 'medium', '长代码审查降思考省 token', setLevel, clk.now());
    expect(r.ok).toBe(true);
    expect(r.level).toBe('medium');
    expect(calls).toEqual(['medium']);
    const ev = loadLevelChanges().find((l) => l.type === 'level-change');
    expect(ev?.source).toBe('model');
    expect(ev?.reason).toContain('model-proposal');
  });

  it('拒绝：死区内模型提议不生效', () => {
    const s = createState('high');
    const { setLevel } = recordEvents();
    const clk = makeNow();
    expect(proposeThinkingLevel(s, 'medium', 'x', setLevel, clk.now()).ok).toBe(true);
    const r = proposeThinkingLevel(s, 'low', '再降', setLevel, clk.now() + 1000);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('死区');
    expect(s.current).toBe('medium');
  });

  it('拒绝：目标 clamp（low/medium/high，off/max 归位）', () => {
    const s = createState('medium');
    const { setLevel } = recordEvents();
    const clk = makeNow();
    const rHigh = proposeThinkingLevel(s, 'max', 'up', setLevel, clk.now());
    expect(rHigh.ok).toBe(true);
    expect(rHigh.level).toBe('high');
    clk.advance(MIN_INTERVAL_MS + 1);
    const rLow = proposeThinkingLevel(s, 'off', 'down', setLevel, clk.now());
    expect(rLow.ok).toBe(true);
    expect(rLow.level).toBe('low');
    expect(s.current).toBe('low');
  });

  it('同档协调：目标与当前一致时 ok 不切换', () => {
    const s = createState('high');
    const { calls, setLevel } = recordEvents();
    const clk = makeNow();
    const r = proposeThinkingLevel(s, 'high', 'noop', setLevel, clk.now());
    expect(r.ok).toBe(true);
    expect(r.message).toContain('无需切换');
    expect(calls).toEqual([]);
  });
});

/**
 * 回归（2026-09-29）：切档使整段前缀缓存失效，且切换到 deepseek-flash 会被自动解析成
 * max（实测 4/4 次）。这里锁定"超上限一律夹回、低档位不动、合规档位不制造切档事件"。
 */
describe('缓存安全档位钳制', () => {
  const saved = process.env.PI_THINKING_MAX_LEVEL;
  afterEach(() => {
    if (saved === undefined) delete process.env.PI_THINKING_MAX_LEVEL;
    else process.env.PI_THINKING_MAX_LEVEL = saved;
  });

  it('默认上限为 high', () => {
    delete process.env.PI_THINKING_MAX_LEVEL;
    expect(cacheSafeMaxLevel()).toBe('high');
  });

  it('max/xhigh → 夹到上限（这是本功能的主要原因）', () => {
    delete process.env.PI_THINKING_MAX_LEVEL;
    expect(clampForCacheSafety('max')).toBe('high');
    expect(clampForCacheSafety('xhigh')).toBe('high');
  });

  it('合规档位与廉价档位不产生切档', () => {
    delete process.env.PI_THINKING_MAX_LEVEL;
    expect(clampForCacheSafety('high')).toBeNull();
    expect(clampForCacheSafety('medium')).toBeNull();
    expect(clampForCacheSafety('low')).toBeNull();
    expect(clampForCacheSafety('minimal')).toBeNull();
    expect(clampForCacheSafety('off')).toBeNull();
    expect(clampForCacheSafety('')).toBeNull();
    expect(clampForCacheSafety('unknown-level')).toBeNull();
  });

  it('上限可调低，此时 medium/high 也被夹回', () => {
    process.env.PI_THINKING_MAX_LEVEL = 'low';
    expect(cacheSafeMaxLevel()).toBe('low');
    expect(clampForCacheSafety('high')).toBe('low');
    expect(clampForCacheSafety('medium')).toBe('low');
    expect(clampForCacheSafety('low')).toBeNull();
  });

  it('非法上限值回落 high', () => {
    process.env.PI_THINKING_MAX_LEVEL = 'bogus';
    expect(cacheSafeMaxLevel()).toBe('high');
  });

  it('显式设 max = 自愿承担代价，永不夹档', () => {
    process.env.PI_THINKING_MAX_LEVEL = 'max';
    expect(cacheSafeMaxLevel()).toBe('max');
    expect(clampForCacheSafety('max')).toBeNull();
    expect(clampForCacheSafety('high')).toBeNull();
  });
});
