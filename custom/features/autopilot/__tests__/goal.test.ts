/**
 * 目标级自动续跑的决策测试（编排优化第 4 项）
 *
 * 重点锁**停止条件**——这是本功能的要害：没有可靠的停止条件，自动续跑就是"盲目烧满 N 轮"。
 *   ① 按模式解析轮次上限（full 256、其余 16、模式可覆盖、<=0 视为禁用）；
 *   ② 有工具调用 → 续跑；连续 3 轮没有工具调用 → 判定受阻并停止（对齐 DSH 的
 *      blockedAfterConsecutiveRounds）；
 *   ③ 达到上限 → 停止并记明原因；显式 complete/blocked/pause 之后不再续跑。
 */
import { describe, it, expect } from 'vitest';
import {
  BLOCKED_AFTER_NO_PROGRESS_ROUNDS,
  DEFAULT_GOAL_MAX_ROUNDS,
  FULL_MODE_GOAL_MAX_ROUNDS,
  continuePrompt,
  createGoal,
  decideContinuation,
  goalStatusText,
  resolveGoalCap,
} from '../store/goal';

describe('resolveGoalCap（上限按模式配置）', () => {
  it('未配置时：full 用 256（对齐 DSH），其余模式用保守的 16', () => {
    expect(resolveGoalCap('full', null)).toBe(FULL_MODE_GOAL_MAX_ROUNDS);
    expect(resolveGoalCap('full', null)).toBe(256);
    expect(resolveGoalCap('roleplay', null)).toBe(DEFAULT_GOAL_MAX_ROUNDS);
    expect(resolveGoalCap('lean', undefined)).toBe(DEFAULT_GOAL_MAX_ROUNDS);
  });

  it('模式显式配置优先（roleplay 配 12 就用 12）', () => {
    expect(resolveGoalCap('roleplay', 12)).toBe(12);
    expect(resolveGoalCap('full', 5)).toBe(5);
  });

  it('<=0 视为禁用（返回 0，调用方据此拒绝开启）；非法值退回默认', () => {
    expect(resolveGoalCap('full', 0)).toBe(0);
    expect(resolveGoalCap('full', -3)).toBe(0);
    expect(resolveGoalCap('full', Number.POSITIVE_INFINITY)).toBe(FULL_MODE_GOAL_MAX_ROUNDS);
    expect(resolveGoalCap('full', 12.7)).toBe(12);
  });
});

describe('decideContinuation：有推进就续跑', () => {
  it('本轮有工具调用 → continue，轮次 +1、无进展计数归零', () => {
    const g = { ...createGoal('做 A', 10), roundsUsed: 3, noProgressRounds: 2 };
    const d = decideContinuation(g, 4);
    expect(d.action).toBe('continue');
    expect(d.next.roundsUsed).toBe(4);
    expect(d.next.noProgressRounds).toBe(0);
    // 纯函数：不改原对象
    expect(g.roundsUsed).toBe(3);
  });
});

describe('decideContinuation：停止条件（本功能的要害）', () => {
  it('连续 3 轮没有工具调用 → blocked（只在第 3 次停，前两次仍续跑）', () => {
    let g = createGoal('做 A', 10);
    const a1 = decideContinuation(g, 0);
    expect(a1.action).toBe('continue');
    expect(a1.next.noProgressRounds).toBe(1);
    const a2 = decideContinuation(a1.next, 0);
    expect(a2.action).toBe('continue');
    expect(a2.next.noProgressRounds).toBe(2);
    const a3 = decideContinuation(a2.next, 0);
    expect(a3.action).toBe('blocked');
    expect(a3.next.status).toBe('blocked');
    expect(a3.next.note).toContain('没有任何工具调用');
    expect(BLOCKED_AFTER_NO_PROGRESS_ROUNDS).toBe(3);
  });

  it('中途有工具调用会打断"连续无进展"计数（不会累积误判）', () => {
    let g = createGoal('做 A', 10);
    g = decideContinuation(g, 0).next; // 1
    g = decideContinuation(g, 0).next; // 2
    g = decideContinuation(g, 1).next; // 有推进 → 归零
    expect(g.noProgressRounds).toBe(0);
    expect(decideContinuation(g, 0).action).toBe('continue');
  });

  it('达到轮次上限 → capped 且置为 blocked（不会无限续跑）', () => {
    const g = { ...createGoal('做 A', 5), roundsUsed: 5 };
    const d = decideContinuation(g, 3);
    expect(d.action).toBe('capped');
    expect(d.next.status).toBe('blocked');
    expect(d.next.note).toContain('5');
  });

  it('显式结束后不再续跑：complete / blocked / pause 三种状态都直接停', () => {
    for (const status of ['complete', 'blocked', 'paused'] as const) {
      const d = decideContinuation({ ...createGoal('x', 10), status }, 9);
      expect(d.action).toBe(status);
      expect(d.next.status).toBe(status);
      expect(d.next.roundsUsed).toBe(0); // 不再推进轮次
    }
  });
});

describe('文案', () => {
  it('续跑提示带上目标与剩余轮次，并要求完成/受阻时显式声明', () => {
    const t = continuePrompt({ ...createGoal('把审计做完', 16), roundsUsed: 3 });
    expect(t).toContain('把审计做完');
    expect(t).toContain('3/16');
    expect(t).toContain('goal complete');
    expect(t).toContain('goal blocked');
  });

  it('无目标时状态文案给出开启方式；有目标时给出状态/轮次/原因', () => {
    expect(goalStatusText(null)).toContain('goal set');
    const t = goalStatusText({ ...createGoal('x', 12), roundsUsed: 2, note: '卡在缺少凭据' });
    expect(t).toContain('进行中');
    expect(t).toContain('2/12');
    expect(t).toContain('卡在缺少凭据');
  });
});
