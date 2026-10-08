/**
 * 目标级自动续跑 —— 纯决策层（2026-10-07，编排优化第 4 项）
 *
 * 与 DSH 的差距：my-pi 的自动唤醒只有"tmux 完成通知"与"定时任务"，**没有"朝一个目标连续推进"**——
 * 长任务只能靠用户不断催。DSH 有 `goal`（`goal-round-driver` → `agent.followup`，默认 256 轮，
 * `blockedAfterConsecutiveRounds: 3`，且 resume/fork 后 **disarm**）。
 *
 * 本模块只放**决策**（零 Pi 依赖、零 IO，可在 vitest 里直接驱动）；状态由调用方持有。
 *
 * **为什么是会话态、不落盘**：DSH 的 goal 在 resume/fork 之后是 disarmed 的，即它本来就是**会话内**
 * 概念。做成会话态同时避免引入"运行时状态入库"的风险（那条约定踩过两次坑，有守门）。
 *
 * **停止条件是本功能的要害**（否则会盲目烧满 N 轮）：
 *   1. 模型显式 `complete` / `blocked` / `pause`；
 *   2. 达到轮次上限（**按模式配置**：full 256、其余模式默认 16，roleplay 单独配 12）；
 *   3. **连续 3 轮没有任何工具调用** = 没有推进 → blocked（对齐 DSH 的 blockedAfterConsecutiveRounds）。
 * 第 3 条是关键：一个"只说话不动手"的模型会被判定为受阻并停下，而不是被推着空转。
 */

export type GoalStatus = 'active' | 'paused' | 'complete' | 'blocked';

export interface GoalState {
  objective: string;
  status: GoalStatus;
  /** 已推进的轮数（含自动续跑的每一轮） */
  roundsUsed: number;
  maxRounds: number;
  /** 连续"没有工具调用"的轮数（达到阈值即 blocked） */
  noProgressRounds: number;
  /** 状态说明（为什么停的） */
  note: string;
}

/** 连续多少轮没有任何工具调用就判定受阻（对齐 DSH 的 blockedAfterConsecutiveRounds） */
export const BLOCKED_AFTER_NO_PROGRESS_ROUNDS = 3;
/** full 模式的默认上限（对齐 DSH 的 256） */
export const FULL_MODE_GOAL_MAX_ROUNDS = 256;
/** 其余模式的默认上限：保守，避免无人看管时烧穿预算 */
export const DEFAULT_GOAL_MAX_ROUNDS = 16;

/**
 * 按模式解析轮次上限：模式显式配了就用它，否则 full 用 256、其余用 16。
 * `<=0` 视为**禁止自动续跑**（返回 0，调用方据此拒绝开启）。
 */
export function resolveGoalCap(modeName: string, configured: number | null | undefined): number {
  if (typeof configured === 'number' && Number.isFinite(configured)) {
    return configured > 0 ? Math.floor(configured) : 0;
  }
  return modeName === 'full' ? FULL_MODE_GOAL_MAX_ROUNDS : DEFAULT_GOAL_MAX_ROUNDS;
}

export function createGoal(objective: string, maxRounds: number): GoalState {
  return { objective, status: 'active', roundsUsed: 0, maxRounds, noProgressRounds: 0, note: '' };
}

export type GoalAction = 'continue' | 'paused' | 'complete' | 'blocked' | 'capped';

export interface GoalDecision {
  /** 决策后的状态（调用方直接赋值；纯函数不改原对象） */
  next: GoalState;
  action: GoalAction;
  reason: string;
}

/**
 * 一轮结束后决定要不要自动续跑。`toolCallsThisRound` = 该轮**除 `goal` 自身以外**的工具调用数
 * （把 `goal status` 这类自省调用排除掉，否则"只反复查状态"会被误判成有推进）。
 */
export function decideContinuation(goal: GoalState, toolCallsThisRound: number): GoalDecision {
  if (goal.status === 'paused') return { next: goal, action: 'paused', reason: '目标已暂停' };
  if (goal.status === 'complete') return { next: goal, action: 'complete', reason: '目标已完成' };
  if (goal.status === 'blocked') return { next: goal, action: 'blocked', reason: goal.note || '目标受阻' };

  if (goal.roundsUsed >= goal.maxRounds) {
    const note = `达到轮次上限 ${goal.maxRounds}`;
    return { next: { ...goal, status: 'blocked', note }, action: 'capped', reason: note };
  }

  if (toolCallsThisRound > 0) {
    return {
      next: { ...goal, roundsUsed: goal.roundsUsed + 1, noProgressRounds: 0 },
      action: 'continue',
      reason: '本轮有工具调用，视为有推进',
    };
  }

  const noProgress = goal.noProgressRounds + 1;
  if (noProgress >= BLOCKED_AFTER_NO_PROGRESS_ROUNDS) {
    const note = `连续 ${noProgress} 轮没有任何工具调用（没有推进）`;
    return {
      next: { ...goal, roundsUsed: goal.roundsUsed + 1, noProgressRounds: noProgress, status: 'blocked', note },
      action: 'blocked',
      reason: note,
    };
  }
  return {
    next: { ...goal, roundsUsed: goal.roundsUsed + 1, noProgressRounds: noProgress },
    action: 'continue',
    reason: `本轮没有工具调用（第 ${noProgress}/${BLOCKED_AFTER_NO_PROGRESS_ROUNDS} 次）`,
  };
}

/** 自动续跑时注入的内容（明确"继续推进而不是重开一轮汇报"） */
export function continuePrompt(goal: GoalState): string {
  const left = Math.max(0, goal.maxRounds - goal.roundsUsed);
  return [
    `[目标续跑 ${goal.roundsUsed}/${goal.maxRounds}] 继续推进这个目标，不要重新汇报或复述计划：`,
    goal.objective,
    '',
    `剩余约 ${left} 轮。完成时调用 \`goal complete\`（带一句结论）；确实推不动时调用 \`goal blocked\`（说明卡在哪）。`,
    '本轮若无需动作就直接给出结论——连续 3 轮没有工具调用会被自动判定为受阻并停止。',
  ].join('\n');
}

/** 状态文案（工具返回 / 通知用） */
export function goalStatusText(goal: GoalState | null): string {
  if (!goal) return '当前没有目标（用 `goal set` 声明一个目标后才会自动续跑）。';
  const label: Record<GoalStatus, string> = { active: '进行中', paused: '已暂停', complete: '已完成', blocked: '受阻' };
  return [
    `目标：${goal.objective}`,
    `状态：${label[goal.status]}　轮次：${goal.roundsUsed}/${goal.maxRounds}　连续无进展：${goal.noProgressRounds}`,
    goal.note ? `说明：${goal.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
