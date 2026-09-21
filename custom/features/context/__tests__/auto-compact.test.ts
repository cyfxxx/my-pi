/**
 * auto-compact 纯逻辑回归测试（迁移自 pi-tools pi-context/tests/auto-compact.test.ts）
 */
import { describe, it, expect } from 'vitest';
import {
  computeCompactThreshold,
  makeCompactDecider,
  makeAutoContinueGate,
  LARGE_WINDOW_SIZE,
  LARGE_WINDOW_RATIO,
  SMALL_WINDOW_RATIO,
  DEFAULT_COOLDOWN_MS,
} from '../budget/auto-compact';

describe('auto-compact: 阈值计算', () => {
  it('1M 大窗口 → 80% 触发', () => {
    expect(computeCompactThreshold(1_000_000)).toBe(Math.floor(1_000_000 * LARGE_WINDOW_RATIO));
    expect(computeCompactThreshold(1_000_000)).toBe(800_000);
  });

  it('小窗口（131K）→ 85% 触发', () => {
    expect(computeCompactThreshold(131_072)).toBe(Math.floor(131_072 * SMALL_WINDOW_RATIO));
  });

  it('窗口边界 256K：等于归小窗口档，大于归大窗口档', () => {
    expect(computeCompactThreshold(LARGE_WINDOW_SIZE)).toBe(Math.floor(LARGE_WINDOW_SIZE * SMALL_WINDOW_RATIO));
    expect(computeCompactThreshold(LARGE_WINDOW_SIZE + 1)).toBe(Math.floor((LARGE_WINDOW_SIZE + 1) * LARGE_WINDOW_RATIO));
  });

  it('无效窗口 → null', () => {
    expect(computeCompactThreshold(0)).toBeNull();
    expect(computeCompactThreshold(-1)).toBeNull();
    expect(computeCompactThreshold(Number.NaN)).toBeNull();
  });

  it('opts 覆盖 + absoluteTokens 语义', () => {
    expect(computeCompactThreshold(1_000_000, { largeRatio: 0.6 })).toBe(600_000);
    expect(computeCompactThreshold(100_000, { smallRatio: 0.9 })).toBe(90_000);
    expect(computeCompactThreshold(1_000_000, { absoluteTokens: 200_000 })).toBe(200_000);
    expect(computeCompactThreshold(1_000_000, { absoluteTokens: 0 })).toBe(800_000);
    // 窗口≤绝对值退回比例路径
    expect(computeCompactThreshold(131_072, { absoluteTokens: 200_000 })).toBe(
      Math.floor(131_072 * SMALL_WINDOW_RATIO),
    );
    expect(computeCompactThreshold(200_000, { absoluteTokens: 200_000 })).toBe(Math.floor(200_000 * SMALL_WINDOW_RATIO));
  });
});

describe('auto-compact: 判定与防抖', () => {
  const now = 1_000_000;

  it('未超阈值 → 不压缩；超阈值 → 触发', () => {
    const d = makeCompactDecider();
    expect(d.decide(100_000, 1_000_000, now).reason).toBe('under-threshold');
    expect(d.decide(850_000, 1_000_000, now).shouldCompact).toBe(true);
  });

  it('压缩后 cooldown 内不再触发；过后可再次触发', () => {
    const d = makeCompactDecider();
    d.markCompact(now);
    expect(d.decide(900_000, 1_000_000, now + DEFAULT_COOLDOWN_MS - 1).reason).toBe('cooldown');
    expect(d.decide(900_000, 1_000_000, now + DEFAULT_COOLDOWN_MS).shouldCompact).toBe(true);
  });

  it('decide 不改变状态，markCompact 记录时间戳', () => {
    const d = makeCompactDecider();
    d.decide(850_000, 1_000_000, now);
    expect(d.lastCompactAt).toBe(0);
    d.markCompact(now);
    expect(d.lastCompactAt).toBe(now);
  });

  it('无窗口 → no-window 不触发', () => {
    const d = makeCompactDecider();
    expect(d.decide(500_000, 0, now).reason).toBe('no-window');
  });
});

describe('auto-continue gate', () => {
  it('arm 后 shouldContinue 一次性返回 true', () => {
    const g = makeAutoContinueGate();
    expect(g.armed).toBe(false);
    g.arm();
    expect(g.shouldContinue()).toBe(true);
    expect(g.shouldContinue()).toBe(false);
  });

  it('未 arm / disarm / enabled=false 均不继续', () => {
    expect(makeAutoContinueGate().shouldContinue()).toBe(false);
    const g = makeAutoContinueGate();
    g.arm();
    g.disarm();
    expect(g.shouldContinue()).toBe(false);
    const off = makeAutoContinueGate(false);
    off.arm();
    expect(off.armed).toBe(false);
    expect(off.shouldContinue()).toBe(false);
  });
});
