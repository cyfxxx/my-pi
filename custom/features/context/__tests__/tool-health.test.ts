/**
 * tool-health 纯逻辑测试（迁移自 pi-tools pi-context/tests/tool-truncation.test.ts 的
 * 熔断/脱水部分）。
 */
import { describe, it, expect } from 'vitest';
import {
  updateFailStreak,
  dehydrateErrorOutput,
  rebuildTextContent,
  FAIL_STREAK_LIMIT,
} from '../budget/tool-health';

describe('updateFailStreak: 连续失败熔断计数', () => {
  it('同一工具连续失败 3 次触发熔断提示，4 次不重复触发', () => {
    const streak = new Map<string, number>();
    expect(updateFailStreak(streak, 'bash', true).hint).toBeUndefined();
    expect(updateFailStreak(streak, 'bash', true).hint).toBeUndefined();
    expect(updateFailStreak(streak, 'bash', true).hint).toBeDefined();
    expect(updateFailStreak(streak, 'bash', true).hint).toBeUndefined();
  });

  it('中途成功清零连击', () => {
    const streak = new Map<string, number>();
    updateFailStreak(streak, 'bash', true);
    updateFailStreak(streak, 'bash', true);
    updateFailStreak(streak, 'bash', false);
    expect(updateFailStreak(streak, 'bash', true).hint).toBeUndefined();
  });

  it('不同工具独立计数', () => {
    const streak = new Map<string, number>();
    updateFailStreak(streak, 'bash', true);
    updateFailStreak(streak, 'bash', true);
    expect(updateFailStreak(streak, 'read', true).hint).toBeUndefined();
    expect(updateFailStreak(streak, 'read', true).hint).toBeUndefined();
    expect(updateFailStreak(streak, 'read', true).hint).toBeDefined();
  });

  it('熔断后计数保持（连续失败仍累计）', () => {
    const streak = new Map<string, number>();
    for (let i = 0; i < FAIL_STREAK_LIMIT + 1; i++) updateFailStreak(streak, 'bash', true);
    expect(streak.get('bash')).toBe(FAIL_STREAK_LIMIT + 1);
  });
});

describe('dehydrateErrorOutput: 错误确定性脱水', () => {
  it('无错误标记 → undefined', () => {
    const big = 'normal line\n'.repeat(3000);
    expect(dehydrateErrorOutput(big)).toBeUndefined();
  });

  it('错误标记 + 连续重复行 → 折叠并保留头尾', () => {
    const err = 'Error: connection refused\n' + 'same error line\n'.repeat(600) + 'tail kept here';
    const out = dehydrateErrorOutput(err);
    expect(out).toBeDefined();
    expect(out).toContain('行重复已折叠');
    expect(out).toContain('Error: connection refused');
    expect(out).toContain('tail kept here');
  });

  it('错误标记 + 超长行 → 行截断', () => {
    const err = 'Error: boom\n' + 'stack-frame-xyz '.repeat(200);
    const out = dehydrateErrorOutput(err);
    expect(out).toContain('[行截断]');
  });

  it('有标记但无变化 → undefined', () => {
    expect(dehydrateErrorOutput('Error: single line')).toBeUndefined();
  });
});

describe('rebuildTextContent: 保留非文本块', () => {
  it('文本合并到首个 text 块位置，图片块保留、后续文本块丢弃', () => {
    const content = [
      { type: 'text', text: 'old' },
      { type: 'image', data: 'x' },
      { type: 'text', text: 'tail' },
    ];
    const out = rebuildTextContent(content, 'new');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: 'text', text: 'new' });
    expect(out[1]).toEqual({ type: 'image', data: 'x' });
  });

  it('无 text 块时追加一个', () => {
    const out = rebuildTextContent([{ type: 'image' }], 'x');
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ type: 'text', text: 'x' });
  });
});
