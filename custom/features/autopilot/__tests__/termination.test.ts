/**
 * 终止设计（Humanize 借鉴）——**只记录，不接管** 的守门
 *
 * 两类断言：
 * 1. **纯逻辑**：分类判据（可复核字符串特征）、评审界阈值、边界（没有错误时**不得乱分类**）。
 * 2. **"默认行为未变"的结构证明**：新增的记录步骤必须**排在** `decideContinuation` **之前**且
 *    **不修改**它的入参判定字段；`tsc` 看不见"可选路径没接上"，所以这里用源码级接线断言钉住。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, readFileSync as readFS } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  ENVIRONMENT_ERROR_MARKERS,
  REVIEW_BUDGET_ROUNDS,
  classifyErrorKind,
  createGoal,
  goalStatusText,
  noteReviewAttempt,
  recordRoundOutcome,
} from '../store/goal';
import { appendTerminationRecord, buildTerminationRecord, terminationLogFile } from '../run/termination-log';

const SRC = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

describe('终止设计·分类判据：只按可复核的字符串特征', () => {
  it('一条错误都没有 ⇒ unknown（**不乱分类**，也不写字段）', () => {
    expect(classifyErrorKind([])).toBe('unknown');
    expect(classifyErrorKind(['', '   '])).toBe('unknown');
    // 不写字段：对象引用都不变（纯粹的无操作）
    const g = createGoal('x', 5);
    expect(recordRoundOutcome(g, { errors: [] })).toBe(g);
  });

  it('环境性特征（errno 风格 / 常见文案）⇒ environment', () => {
    for (const s of ['bash failed: EACCES: permission denied', 'spawn git ENOENT / command not found', 'curl: (6) Could not resolve host: example.com', 'ETIMEDOUT']) {
      expect(classifyErrorKind([s]), s).toBe('environment');
    }
  });

  it('有错误但都不命中环境标记 ⇒ failure', () => {
    expect(classifyErrorKind(['expected 3 to be 4'])).toBe('failure');
    expect(classifyErrorKind(['AssertionError: 断言失败'])).toBe('failure');
  });

  it('混合时以"存在环境特征"为准（宁可归环境，因为处置方式不同）', () => {
    expect(classifyErrorKind(['expected 1 to be 2', 'ENOSPC: no space left on device'])).toBe('environment');
  });

  it('判据表是**字符串**且非空（不许塞正则或空串）', () => {
    expect(ENVIRONMENT_ERROR_MARKERS.length).toBeGreaterThan(8);
    for (const m of ENVIRONMENT_ERROR_MARKERS) {
      expect(typeof m).toBe('string');
      expect(m.trim().length).toBeGreaterThan(0);
    }
  });

  it('recordRoundOutcome 只加 blockedKind，**不动**任何判定字段', () => {
    const g = { ...createGoal('x', 5), roundsUsed: 2, noProgressRounds: 1 };
    const after = recordRoundOutcome(g, { errors: ['EACCES'] });
    expect(after.blockedKind).toBe('environment');
    expect(after.status).toBe(g.status);
    expect(after.roundsUsed).toBe(g.roundsUsed);
    expect(after.noProgressRounds).toBe(g.noProgressRounds);
    expect(after.maxRounds).toBe(g.maxRounds);
  });
});

describe('终止设计·评审界：到界只写 stopReason，不改是否继续', () => {
  it('通过 ⇒ 计数清零', () => {
    const g = { ...createGoal('x', 5), reviewRoundsWithoutPass: 3 };
    expect(noteReviewAttempt(g, true).reviewRoundsWithoutPass).toBe(0);
  });

  it('连续未通过 ⇒ 累加；未到界时**不写** stopReason', () => {
    let g = createGoal('x', 5);
    for (let i = 1; i < REVIEW_BUDGET_ROUNDS; i++) {
      g = noteReviewAttempt(g, false);
      expect(g.reviewRoundsWithoutPass).toBe(i);
      expect(g.stopReason).toBeUndefined();
    }
  });

  it('到界 ⇒ 写 stopReason=review-budget-exhausted，且**状态判定字段一个都没变**', () => {
    let g = { ...createGoal('x', 99), roundsUsed: 7, noProgressRounds: 0 };
    for (let i = 0; i < REVIEW_BUDGET_ROUNDS; i++) g = noteReviewAttempt(g, false);
    expect(g.reviewRoundsWithoutPass).toBe(REVIEW_BUDGET_ROUNDS);
    expect(g.stopReason).toBe('review-budget-exhausted');
    expect(g.status).toBe('active'); // ← 关键：**没有**因为它变成 blocked
    expect(g.roundsUsed).toBe(7);
    expect(g.noProgressRounds).toBe(0);
    expect(g.completionMode).toBeNull();
  });

  it('阈值给得宽（宁可晚停）：至少 5 轮', () => {
    expect(REVIEW_BUDGET_ROUNDS).toBeGreaterThanOrEqual(5);
  });
});

describe('终止设计·状态文案：新字段只在存在时多输出（既有文案不变）', () => {
  it('没有新字段时，文案与扩展前逐字一致', () => {
    const txt = goalStatusText(createGoal('目标 A', 16));
    expect(txt).toContain('目标：目标 A');
    expect(txt).toContain('状态：进行中');
    expect(txt).not.toContain('停止理由');
    expect(txt).not.toContain('受阻性质');
    expect(txt).not.toContain('评审未通过');
  });

  it('有字段时按语义渲染', () => {
    const txt = goalStatusText({
      ...createGoal('x', 16),
      stopReason: 'review-budget-exhausted',
      blockedKind: 'environment',
      reviewRoundsWithoutPass: 2,
    });
    expect(txt).toContain('停止理由（记录）：review-budget-exhausted');
    expect(txt).toContain('环境（权限/网络/磁盘等外部条件）');
    expect(txt).toContain('评审未通过（连续）：2/');
  });
});

describe('终止设计·落盘：确定性字段 + fail-open', () => {
  it('buildTerminationRecord 不写 undefined 字段（输出稳定）', () => {
    expect(Object.keys(buildTerminationRecord({ ts: 'T', roundsUsed: 3 }))).toEqual(['ts', 'roundsUsed']);
    expect(Object.keys(buildTerminationRecord({ ts: 'T', roundsUsed: 3, stopReason: 's', blockedKind: 'failure' })))
      .toEqual(['ts', 'roundsUsed', 'stopReason', 'blockedKind']);
  });

  it('可写入时返回 true 且真的落了一行（JSON 可读回）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'term-log-'));
    const saved = process.env.PI_GOAL_TERMINATION_LOG;
    process.env.PI_GOAL_TERMINATION_LOG = join(dir, 'nested', 'goal-terminations.jsonl');
    try {
      expect(terminationLogFile()).toContain('goal-terminations.jsonl');
      expect(appendTerminationRecord({ ts: 'T1', roundsUsed: 1, blockedKind: 'failure' })).toBe(true);
      const line = readFS(process.env.PI_GOAL_TERMINATION_LOG as string, 'utf8').trim();
      expect(JSON.parse(line)).toEqual({ ts: 'T1', roundsUsed: 1, blockedKind: 'failure' });
    } finally {
      if (saved === undefined) delete process.env.PI_GOAL_TERMINATION_LOG;
      else process.env.PI_GOAL_TERMINATION_LOG = saved;
    }
  });

  it('写不进去 ⇒ 返回 false 且**不抛**（fail-open：记录失败绝不影响判定）', () => {
    const saved = process.env.PI_GOAL_TERMINATION_LOG;
    process.env.PI_GOAL_TERMINATION_LOG = join(process.cwd(), 'package.json', 'goal-terminations.jsonl'); // 父路径是普通文件 ⇒ 立刻 ENOTDIR
    try {
      expect(() => appendTerminationRecord({ ts: 'T', roundsUsed: 1 })).not.toThrow();
      expect(appendTerminationRecord({ ts: 'T', roundsUsed: 1 })).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.PI_GOAL_TERMINATION_LOG;
      else process.env.PI_GOAL_TERMINATION_LOG = saved;
    }
  });
});

describe('终止设计·接线（源码级）：记录步骤必须在判定**之前**且不碰判定字段', () => {
  it('采集、分类、评审记录都在', () => {
    expect(SRC).toContain("event: 'tool_result'");
    expect(SRC).toContain('roundErrors.push(text.slice(0, 500))');
    expect(SRC).toContain('goal = recordRoundOutcome(goal, { errors: roundErrors })');
    expect(SRC).toContain('noteReviewAttempt(goal, lastReviewOutcome === \'passed\')');
    expect(SRC).toContain('appendTerminationRecord({');
    // 评审结果的两处来源都被记下（命令校验 / 独立评审）
    expect(SRC).toContain("lastReviewOutcome = r.ok ? 'passed' : 'failed'");
    expect(SRC).toContain("lastReviewOutcome = judged.done === true ? 'passed' : 'failed'");
  });

  it('记录步骤**排在** decideContinuation 之前（否则就成了"先判后记"，性质不同）', () => {
    const iRecord = SRC.indexOf('goal = recordRoundOutcome(goal, { errors: roundErrors })');
    const iDecide = SRC.indexOf('const d = decideContinuation(goal, toolCallsThisRound);');
    expect(iRecord).toBeGreaterThan(0);
    expect(iDecide).toBeGreaterThan(iRecord);
  });

  it('decideContinuation 的调用形态未被改动（仍是两个入参）', () => {
    expect(SRC).toContain('decideContinuation(goal, toolCallsThisRound)');
    // 不允许把记录字段当入参传进去（那才会真的接管判定）
    expect(SRC).not.toContain('decideContinuation(goal, toolCallsThisRound, ');
  });
});
