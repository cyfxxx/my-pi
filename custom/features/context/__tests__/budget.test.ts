import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  estimateTokens,
  truncateByTokens,
  setContextWindow,
  setCompactThreshold,
  setUsedTokens,
  markCompacted,
  recordToolUsage,
  getBudgetReport,
  recordOutput,
  getOutputReport,
  resetOutputBudget,
  resetAllBudgets,
} from '../budget/budget';

describe('context-budget: 跨实例共享（jiti 隔离修复）', () => {
  beforeEach(() => resetAllBudgets());

  it('独立模块实例读写同一份状态', async () => {
    const modA = await import('../budget/budget');
    vi.resetModules();
    const modB = await import('../budget/budget');

    modA.setContextWindow(64_000);
    modA.recordToolUsage('bash', 1000);
    modB.recordToolUsage('read', 500);

    expect(modB.getBudgetReport().total).toBe(64_000);
    expect(modB.getBudgetReport().used).toBe(1500);
  });

  it('输出预算跨实例累计与重置', async () => {
    const modA = await import('../budget/budget');
    vi.resetModules();
    const modB = await import('../budget/budget');

    modA.recordOutput('bash', 1000);
    modB.recordOutput('read', 500);
    expect(modA.getOutputReport()).toContain('bash');
    expect(modA.getOutputReport()).toContain('read');

    modB.resetOutputBudget();
    expect(modA.getOutputReport()).toBe('');
  });

  it('resetAllBudgets 复位窗口与全部用量', () => {
    setContextWindow(64_000);
    recordToolUsage('bash', 100);
    resetAllBudgets();
    const r = getBudgetReport();
    expect(r.total).toBe(128_000);
    expect(r.used).toBe(0);
    expect(getOutputReport()).toBe('');
  });
});

describe('context-budget: used 累计语义', () => {
  beforeEach(() => resetAllBudgets());

  it('超过 MAX_LOG(50) 后 used 仍为会话累计总量', () => {
    setContextWindow(128_000);
    for (let i = 0; i < 60; i++) recordToolUsage('bash', 100);
    const r = getBudgetReport();
    expect(r.used).toBe(6000);
    expect(r.remaining).toBe(128_000 - 6000);
    expect(r.ratio).toBeCloseTo(6000 / 128_000);
  });
});

describe('context-budget: emoji 按 1 token 保守校准', () => {
  beforeEach(() => resetAllBudgets());

  it('非 BMP 字符不按 other/4 低估', () => {
    expect(estimateTokens('🟡')).toBe(1);
    expect(estimateTokens('🔴🟠')).toBe(2);
    expect(estimateTokens('中文🟡')).toBe(2);
  });

  it('纯文本估算保持既有行为', () => {
    expect(estimateTokens('中文内容')).toBe(2);
    expect(estimateTokens('hello world')).toBe(3);
    expect(estimateTokens('1234567890')).toBe(3);
  });
});

describe('context-budget: truncateByTokens 边界感知与标记预算', () => {
  it('截断在句子边界而非硬切残句', () => {
    const text = '这是一段有明确句子的长内容。第二句也很重要。第三句会超过预算因此应当被截掉。后缀'.repeat(4);
    const out = truncateByTokens(text, 40);
    expect(out).toContain('[截断]');
    const content = out.split('\n\n[截断]')[0];
    expect(content.endsWith('。')).toBe(true);
    expect(content.endsWith('。后缀')).toBe(false);
  });

  it('无标点长串回退下限', () => {
    const text = '无标点长串'.repeat(80);
    const out = truncateByTokens(text, 30);
    const content = out.split('\n\n[截断]')[0];
    expect(content.length).toBeGreaterThan(20);
  });

  it('内容+标记总 token ≤ cap', () => {
    const text = '中文内容'.repeat(100);
    const cap = 60;
    const out = truncateByTokens(text, cap);
    expect(estimateTokens(out)).toBeLessThanOrEqual(cap + 2);
    expect(out).toContain('[截断]');
  });
});

describe('context-budget: 压力分母为真实窗口', () => {
  beforeEach(() => resetAllBudgets());

  it('ratio 以真实 contextWindow 为分母', () => {
    setContextWindow(1_000_000);
    setCompactThreshold(200_000);
    setUsedTokens(180_000);
    const report = getBudgetReport();
    expect(report.ratio).toBeCloseTo(0.18);
    expect(report.pressure).toBe('low');
  });

  it('高占用按窗口比例升档', () => {
    setContextWindow(1_000_000);
    setUsedTokens(950_000);
    expect(getBudgetReport().pressure).toBe('critical');
  });

  it('markCompacted 后 setUsedTokens 回落为新基线', () => {
    setContextWindow(200_000);
    setUsedTokens(180_000);
    expect(getBudgetReport().pressure).toBe('high');
    markCompacted();
    setUsedTokens(60_000);
    expect(getBudgetReport().ratio).toBeCloseTo(0.3);
    expect(getBudgetReport().pressure).toBe('low');
  });
});

describe('context-budget: 真实校准与输出累计', () => {
  beforeEach(() => resetAllBudgets());

  it('setUsedTokens 覆盖累计估算，不再单调虚高', () => {
    setContextWindow(10_000);
    recordToolUsage('bash', 8_000);
    expect(getBudgetReport().used).toBe(8_000);
    setUsedTokens(2_000);
    expect(getBudgetReport().used).toBe(2_000);
    // 新一轮估算在真实基线之上累加，再被下一次真实测量覆盖
    recordToolUsage('bash', 300);
    expect(getBudgetReport().used).toBe(2_300);
    setUsedTokens(500);
    expect(getBudgetReport().used).toBe(500);
  });

  it('pruneToolOutput 将放行输出计入累计预算', async () => {
    const { pruneToolOutput } = await import('../budget/budget');
    expect(getOutputReport()).toBe('');
    pruneToolOutput('hello world', 'bash');
    const report = getOutputReport();
    expect(report).toContain('bash');
    expect(report).toMatch(/工具输出预算: \d+/);
  });
});
