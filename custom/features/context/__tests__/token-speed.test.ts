import { describe, it, expect } from 'vitest';
import { createSpeedTracker, estimateTokensFromChars, formatSpeed, formatSpeedCompact } from '../budget/token-speed';

describe('token-speed', () => {
  it('estimateTokensFromChars 按 4 字符/token 估算', () => {
    expect(estimateTokensFromChars(400)).toBe(100);
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(-1)).toBe(0);
    expect(estimateTokensFromChars(100, 0)).toBe(0);
  });

  it('未开始计时时不产出速度', () => {
    const t = createSpeedTracker();
    expect(t.liveSpeed(1000)).toBeNull();
    expect(t.finishTurn(100, 1000)).toBeNull();
  });

  it('耗时过短时不产出实时速度', () => {
    const t = createSpeedTracker();
    t.startTurn(0);
    t.addOutputChars(400);
    expect(t.liveSpeed(100)).toBeNull();
    expect(t.liveSpeed(500)).toBeCloseTo(200, 5);
  });

  it('结算优先使用真实 output token', () => {
    const t = createSpeedTracker();
    t.startTurn(0);
    t.addOutputChars(400);
    expect(t.finishTurn(50, 1000)).toBeCloseTo(50, 5);
  });

  it('真实 token 缺失时结算回退到字符估算', () => {
    const t = createSpeedTracker();
    t.startTurn(0);
    t.addOutputChars(400);
    expect(t.finishTurn(0, 1000)).toBeCloseTo(100, 5);
  });

  it('formatSpeed 低于 10 保留一位小数', () => {
    expect(formatSpeed(8.25)).toBe('8.3 tok/s');
    expect(formatSpeed(42.4)).toBe('42 tok/s');
    expect(formatSpeed(0)).toBe('0 tok/s');
  });

  it('formatSpeedCompact 省略单位后缀，保留一位/整数精度', () => {
    expect(formatSpeedCompact(8.25)).toBe('⇅8.3');
    expect(formatSpeedCompact(42.4)).toBe('⇅42');
    expect(formatSpeedCompact(0)).toBe('⇅0');
    expect(formatSpeedCompact(Number.NaN)).toBe('⇅0');
  });
});
