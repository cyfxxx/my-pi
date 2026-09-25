/**
 * Context Feature — 纯逻辑出口（零 Pi 依赖）
 *
 * 负责任务门、工具生命周期状态与效率建议；token 预算/压缩/分层等实现见 `budget/` 子包。
 */

// ── 任务记录：提取最后一条用户请求摘要 ──

export function extractUserRequest(messages: readonly unknown[], maxLen = 200): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (!m || m.role !== 'user') continue;
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = (m.content as { type?: string; text?: string }[])
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join(' ');
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, maxLen);
  }
  return '';
}

// ── 压缩任务门（门1）：有进行中的计划任务时不自动压缩 ──

/**
 * 压缩空闲门（门3）：距用户上次输入或任务完成不足 IDLE_MS 时不允许自动压缩。
 * 原实现见 pi-tools `pi-context/auto-compact-controller.ts`（其 IDLE_MS 默认 10 分钟；
 * my-pi 因实测净亏已默认关闭，见 budget/task-gate.ts）。
 * `idleMs <= 0` 关闭该门；两个活动时刻均无记录（0）时视为通过，不阻塞。
 */
export function passesIdleGate(params: {
  idleMs: number;
  lastUserActivityTs: number;
  taskDoneAt: number;
  now: number;
}): boolean {
  if (params.idleMs <= 0) return true;
  const lastActivity = Math.max(params.lastUserActivityTs, params.taskDoneAt);
  if (lastActivity <= 0) return true;
  return params.now - lastActivity >= params.idleMs;
}

/**
 * 压缩空闲门（门3）在 `turn_end` 处的判定。
 *
 * 修复：判定点只有 `turn_end`，而它**总是紧跟在一次用户输入之后**（`input` 钩子先把
 * `lastUserActivityTs` 置为当前时刻）。因此 `passesIdleGate` 里的差值恒等于本回合耗时
 * （秒级）< IDLE_MS，门在结构上不可能通过——实测 10 小时 / 341K 上下文的长会话零压缩。
 *
 * 语义修正为「用户此刻或本回合开始前处于非活跃」：满足其一即放行
 *   A. 本回合开始**之前**用户已离开 ≥ idleMs（`preTurnIdleAnchor` 在 input 钩子中
 *      于覆盖 `lastUserActivityTs` 前捕获）；
 *   B. 本回合自身已持续 ≥ idleMs 且期间无用户输入（长工具循环，用户确实不在交互）。
 * `PI_CONTEXT_IDLE_MS=0` 仍可整体关闭该门。
 */
export function passesIdleGateAtTurnEnd(params: {
  idleMs: number;
  preTurnIdleAnchor: number;
  lastUserActivityTs: number;
  now: number;
}): boolean {
  const { idleMs, now } = params;
  if (idleMs <= 0) return true;
  if (params.preTurnIdleAnchor > 0 && now - params.preTurnIdleAnchor >= idleMs) return true;
  if (params.lastUserActivityTs > 0 && now - params.lastUserActivityTs >= idleMs) return true;
  return false;
}

export function hasInProgressTask(tasks: readonly { status: string }[]): boolean {
  return tasks.some((t) => t.status === 'in_progress');
}

// ── 工具生命周期状态 ──

export interface ToolLifecycleState {
  toolCallStarts: Map<string, number>;
  runToolCount: number;
}

export function createToolLifecycleState(): ToolLifecycleState {
  return {
    toolCallStarts: new Map(),
    runToolCount: 0,
  };
}

// ── 效率建议 ──

export const EFFICIENCY_ADVICE = '效率建议：使用更具体的工具调用可以提高响应速度。';
export const LOW_PRESSURE_DELEGATION = '低压力委派：将简单任务委派给子代理可以提高效率。';
export const FULL_DELEGATION_ADVICE = '完全委派建议：对于重复性任务，考虑使用自动化脚本。';

// ── 迁移自 pi-tools 的 token 预算模块（纯逻辑） ──
export * from './budget/budget';
export * from './budget/output-archive';
export * from './budget/tool-groups';
export * from './budget/compression';
