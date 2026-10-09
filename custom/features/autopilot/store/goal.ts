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

/**
 * **完成语义三态**（借鉴 SoL-Pi："Separate verified, declared, and advisory completion modes"）。
 *
 * - `declared`  —— 模型**声称**完成。这是模型唯一能自己给出的级别（自封 `verified` 会让区分变成摆设）。
 * - `verified`  —— 有**独立于模型叙述**的证据：模型给出可判定的检查命令，**由 my-pi 实际跑通**（exit 0）。
 * - `advisory`  —— 受阻/暂停这类**判断性**结论（不是证明）。
 */
export type GoalCompletionMode = 'declared' | 'verified' | 'advisory';

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
  /** 完成语义（未结束前为 null）；见 GoalCompletionMode */
  completionMode: GoalCompletionMode | null;
  /** 独立校验的凭据（仅 `verified` 会有）：检查命令 + 输出尾部 + 时间 */
  /**
   * 独立校验的凭据（仅 `verified` 会有）。**两种来源**：
   * - `source: 'command'` —— P1 的确定性检查命令（由 my-pi 实际跑通）；
   * - `source: 'judge'`   —— 2026-10-08 新增的**第二来源**：独立上下文的评审（见 `run/goal-verdict.ts`）。
   * 优先级：命令 > 评审（两者都有时以命令为准）。
   */
  verification?: {
    source: 'command' | 'judge';
    /** source='command' 时有 */
    command?: string;
    outputTail?: string;
    /** source='judge' 时有 */
    reason?: string;
    at: string;
  };
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
  return {
    objective,
    status: 'active',
    roundsUsed: 0,
    maxRounds,
    noProgressRounds: 0,
    note: '',
    completionMode: null,
  };
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
    // harness 自己判定的停止属于"判断性结论"，不是模型声称、也没有独立校验 → advisory
    return { next: { ...goal, status: 'blocked', completionMode: 'advisory', note }, action: 'capped', reason: note };
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
      next: {
        ...goal,
        roundsUsed: goal.roundsUsed + 1,
        noProgressRounds: noProgress,
        status: 'blocked',
        completionMode: 'advisory',
        note,
      },
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
    `剩余约 ${left} 轮。完成时调用 \`goal complete\`；**想让它算"已校验"就带 \`check\`（一条能区分完成与否的只读命令）**，` +
      `否则只会被记为"声称完成（未经校验）"。确实推不动时调用 \`goal blocked\`（说明卡在哪）。`,
    '本轮若无需动作就直接给出结论——连续 3 轮没有工具调用会被自动判定为受阻并停止。',
  ].join('\n');
}

/**
 * 完成态构造器。**分成三个入口而不是一个 `mode` 参数**，是为了让"模型不能自封 verified"成为
 * **结构约束**而不是约定：只有 `verifiedCompletion` 收得到「已跑通的检查结果」。
 */
export function declaredCompletion(goal: GoalState, evidence?: string): GoalState {
  return {
    ...goal,
    status: 'complete',
    completionMode: 'declared',
    note: evidence ? `声称完成（未经校验）：${evidence}` : '声称完成（未提供证据，未经校验）',
  };
}

export function advisoryCompletion(goal: GoalState, status: 'blocked' | 'paused', note: string): GoalState {
  return { ...goal, status, completionMode: 'advisory', note: note || goal.note };
}

export function verifiedCompletion(
  goal: GoalState,
  check: { command: string; outputTail: string; at: string },
): GoalState {
  return {
    ...goal,
    status: 'complete',
    completionMode: 'verified',
    note: `已通过独立校验（命令）：\`${check.command}\``,
    verification: { source: 'command', ...check },
  };
}

/**
 * 第二来源的完成态：**独立上下文评审**判定达成（见 `run/goal-verdict.ts`）。
 * 与 `verifiedCompletion` 并列的**独立入口**——同样没有"带 mode 参数的通用完成函数"，
 * 所以"模型自封 verified"依然是结构上不可能的。
 */
export function judgeVerifiedCompletion(goal: GoalState, judge: { reason: string; at: string }): GoalState {
  return {
    ...goal,
    status: 'complete',
    completionMode: 'verified',
    note: `已通过独立校验（评审）：${judge.reason}`,
    verification: { source: 'judge', reason: judge.reason, at: judge.at },
  };
}

/** 状态文案（工具返回 / 通知用） */
export function goalStatusText(goal: GoalState | null): string {
  if (!goal) return '当前没有目标（用 `goal set` 声明一个目标后才会自动续跑）。';
  const label: Record<GoalStatus, string> = { active: '进行中', paused: '已暂停', complete: '已完成', blocked: '受阻' };
  const modeLabel: Record<GoalCompletionMode, string> = {
    declared: 'declared（声称完成，未经校验）',
    verified: 'verified（已独立校验）',
    advisory: 'advisory（判断性结论，不是证明）',
  };
  return [
    `目标：${goal.objective}`,
    `状态：${label[goal.status]}　轮次：${goal.roundsUsed}/${goal.maxRounds}　连续无进展：${goal.noProgressRounds}`,
    goal.completionMode ? `完成语义：${modeLabel[goal.completionMode]}` : '',
    goal.verification
      ? goal.verification.source === 'judge'
        ? `独立评审：DONE（理由：${goal.verification.reason ?? ''}）`
        : `校验命令：\`${goal.verification.command}\`（输出尾部：${(goal.verification.outputTail ?? '').slice(-160)}）`
      : '',
    goal.note ? `说明：${goal.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
