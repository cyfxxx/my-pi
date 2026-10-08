/**
 * 完全相同重复调用的判定测试（编排优化第 3 项）
 *
 * 重点锁两件事：
 *   ① 判据是"**名字 + 参数都相同**"——只按名字会在 my-pi 的使用形态下变成噪音
 *      （实测 `bash` 曾被连续调用 1190 次）；
 *   ② 只在**恰好** 3/5/8 档提醒，且参数键序不同不算不同调用（否则模型换个键序就绕过提醒）。
 */
import { describe, it, expect } from 'vitest';
import { REPEAT_REMIND_AT, createRepeatState, observeRepeat, repeatReminderText, stableKey } from '../budget/repeat-reminder';

describe('stableKey', () => {
  it('键序不同视为同一次调用（模型每次生成参数的键序可能不同）', () => {
    expect(stableKey({ a: 1, b: 2 })).toBe(stableKey({ b: 2, a: 1 }));
    expect(stableKey({ x: { p: 1, q: 2 } })).toBe(stableKey({ x: { q: 2, p: 1 } }));
  });

  it('参数真的不同则键不同；数组顺序不同也算不同', () => {
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
    expect(stableKey([1, 2])).not.toBe(stableKey([2, 1]));
  });

  it('循环引用不抛错（判定退化总好过打断工具调用）', () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    expect(() => stableKey(cyc)).not.toThrow();
  });
});

describe('observeRepeat', () => {
  it('完全相同 → 连续计数递增；参数一变 → 归 1', () => {
    const s = createRepeatState();
    expect(observeRepeat(s, 'bash', { command: 'ls' }).count).toBe(1);
    expect(observeRepeat(s, 'bash', { command: 'ls' }).count).toBe(2);
    expect(observeRepeat(s, 'bash', { command: 'ls -l' }).count).toBe(1);
    // 键序变化不该重置
    expect(observeRepeat(s, 'bash', { command: 'ls -l' }).count).toBe(2);
  });

  it('不同工具的相同参数不算连续重复', () => {
    const s = createRepeatState();
    observeRepeat(s, 'read', { path: '/a' });
    expect(observeRepeat(s, 'write', { path: '/a' }).count).toBe(1);
  });

  it('只在恰好 3/5/8 档提醒（第 4/6/7/9 次都不提醒）', () => {
    const s = createRepeatState();
    const remindAt: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const hit = observeRepeat(s, 'bash', { command: 'boom' });
      expect(hit.count).toBe(i);
      if (hit.remind) remindAt.push(i);
    }
    expect(remindAt).toEqual([3, 5, 8]);
    expect([...REPEAT_REMIND_AT].sort((a, b) => a - b)).toEqual([3, 5, 8]);
  });

  it('提醒过一次后继续重复，计数继续涨（下一档还会提醒）', () => {
    const s = createRepeatState();
    for (let i = 1; i <= 2; i++) observeRepeat(s, 'edit', { file: 'x' });
    expect(observeRepeat(s, 'edit', { file: 'x' }).remind).toBe(true); // 3
    expect(observeRepeat(s, 'edit', { file: 'x' }).remind).toBe(false); // 4
    expect(observeRepeat(s, 'edit', { file: 'x' }).remind).toBe(true); // 5
  });
});

describe('repeatReminderText', () => {
  it('文案给出工具名、次数与"先读报错原文"的指引', () => {
    const t = repeatReminderText('bash', 5);
    expect(t).toContain('bash');
    expect(t).toContain('5 次');
    expect(t).toContain('报错原文');
  });
});
