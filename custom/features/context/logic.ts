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
