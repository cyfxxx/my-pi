/**
 * 压缩"回本"估算测试（P2）
 *
 * 锁三件事：
 *   ① 成本模型的具体数值（含缓存溢价）——这是以后能不能接管阈值的依据，必须钉住；
 *   ② **没有剩余轮次估计时不做猜测**（verdict = unknown），这是本项的边界：只算不决策；
 *   ③ 已达强制线时无条件 `forced`（窗口压力优先于回本，否则会溢出）。
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MISS_PREMIUM,
  DEFAULT_SUMMARY_RATIO,
  estimateCompactPayback,
  formatPayback,
} from '../budget/compact-payback';

const WINDOW = 256_000;

describe('成本模型（数值钉住）', () => {
  it('默认参数下：省 84%、成本 50 倍上下文 ⇒ 回本约 60 轮', () => {
    const r = estimateCompactPayback({ contextTokens: 100_000, contextWindow: WINDOW, forcedRatio: 0.8 });
    // savedPerTurn = 100000 * (1 - 0.16) = 84000
    expect(r.savedPerTurn).toBe(84_000);
    // rewriteCostTokens = 100000 * (1 + 49) = 5_000_000
    expect(r.rewriteCostTokens).toBe(5_000_000);
    // 5_000_000 / 84_000 = 59.52… → 向上取整 60
    expect(r.paybackTurns).toBe(60);
    expect(DEFAULT_MISS_PREMIUM).toBe(49);
    expect(DEFAULT_SUMMARY_RATIO).toBe(0.16);
  });

  it('没有缓存溢价（missPremium=0）时回本快得多——说明"重写很贵"几乎全来自缓存失效', () => {
    const r = estimateCompactPayback({
      contextTokens: 100_000,
      contextWindow: WINDOW,
      forcedRatio: 0.8,
      missPremium: 0,
    });
    expect(r.rewriteCostTokens).toBe(100_000);
    expect(r.paybackTurns).toBe(2); // ceil(1 / 0.84)
  });

  it('摘要占比越大，省得越少、回本越慢（单调性）', () => {
    const a = estimateCompactPayback({ contextTokens: 100_000, contextWindow: WINDOW, forcedRatio: 0.8, summaryRatio: 0.1 });
    const b = estimateCompactPayback({ contextTokens: 100_000, contextWindow: WINDOW, forcedRatio: 0.8, summaryRatio: 0.5 });
    expect(b.savedPerTurn).toBeLessThan(a.savedPerTurn);
    expect(b.paybackTurns!).toBeGreaterThan(a.paybackTurns!);
  });
});

describe('不猜测：没有剩余轮次就说 unknown', () => {
  it('未提供 remainingTurns → verdict=unknown（本模块只算不决策）', () => {
    const r = estimateCompactPayback({ contextTokens: 100_000, contextWindow: WINDOW, forcedRatio: 0.8 });
    expect(r.verdict).toBe('unknown');
    expect(r.reason).toContain('不做猜测');
  });

  it('提供了且够回本 → payback-ok；不够 → premature', () => {
    const base = { contextTokens: 100_000, contextWindow: WINDOW, forcedRatio: 0.8 };
    expect(estimateCompactPayback({ ...base, remainingTurns: 60 }).verdict).toBe('payback-ok');
    expect(estimateCompactPayback({ ...base, remainingTurns: 59 }).verdict).toBe('premature');
  });
});

describe('窗口压力优先于回本', () => {
  it('已达强制线 → forced（否则会溢出）', () => {
    const r = estimateCompactPayback({ contextTokens: 210_000, contextWindow: WINDOW, forcedRatio: 0.8 });
    expect(r.trigger).toBe('forced');
    expect(r.verdict).toBe('forced');
    expect(r.reason).toContain('强制线');
  });

  it('恰好等于强制线也算 forced（边界）', () => {
    const r = estimateCompactPayback({ contextTokens: 204_800, contextWindow: WINDOW, forcedRatio: 0.8 });
    expect(r.trigger).toBe('forced');
  });

  it('未到强制线 → trigger=none', () => {
    expect(estimateCompactPayback({ contextTokens: 204_799, contextWindow: WINDOW, forcedRatio: 0.8 }).trigger).toBe('none');
  });
});

describe('退化输入不得抛错', () => {
  it('空上下文 → 省不下、永不回本（not-worth），而不是 NaN/除零', () => {
    const r = estimateCompactPayback({ contextTokens: 0, contextWindow: WINDOW, forcedRatio: 0.8 });
    expect(r.savedPerTurn).toBe(0);
    expect(r.paybackTurns).toBeNull();
    expect(r.verdict).toBe('not-worth');
  });

  it('非法数字按保守默认处理', () => {
    const r = estimateCompactPayback({
      contextTokens: 50_000,
      contextWindow: Number.NaN,
      forcedRatio: Number.NaN,
      summaryRatio: -1,
      missPremium: Number.NaN,
    });
    expect(Number.isFinite(r.paybackTurns!)).toBe(true);
    expect(r.savedPerTurn).toBeGreaterThan(0);
  });
});

describe('formatPayback：一行摘要', () => {
  it('含 verdict / 回本轮数 / 省下量 / 成本；永不回本显示 ∞', () => {
    const r = estimateCompactPayback({ contextTokens: 100_000, contextWindow: WINDOW, forcedRatio: 0.8 });
    const s = formatPayback(r);
    expect(s).toContain('unknown');
    expect(s).toContain('回本60轮');
    const never = estimateCompactPayback({ contextTokens: 0, contextWindow: WINDOW, forcedRatio: 0.8 });
    expect(formatPayback(never)).toContain('∞');
  });
});
