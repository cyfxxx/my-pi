/**
 * Context Feature
 *
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 *
 * 迁移自 pi-tools pi-context：使用真实 contextWindow/用量校准上下文预算。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import {
  createToolLifecycleState,
  EFFICIENCY_ADVICE,
  LOW_PRESSURE_DELEGATION,
  FULL_DELEGATION_ADVICE,
} from './logic';
import {
  resetAllBudgets,
  setContextWindow,
  setUsedTokens,
  recordToolUsage,
  estimateTokens,
  getBudgetReport,
} from './budget';

export { EFFICIENCY_ADVICE, LOW_PRESSURE_DELEGATION, FULL_DELEGATION_ADVICE };

export function register(pi: ExtensionAPI): void {
  const toolState = createToolLifecycleState();

  // 会话开始：重置预算
  registerHook(pi, {
    event: 'session_start',
    handler: async () => {
      resetAllBudgets();
    },
  });

  // 回合开始：用真实 contextWindow 与用量校准预算
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async (_event, ctx) => {
      const usage = ctx.getContextUsage?.();
      if (!usage) return;
      setContextWindow(usage.contextWindow);
      if (usage.tokens != null) setUsedTokens(usage.tokens);
    },
  });

  // 工具调用开始：记录时间
  registerHook(pi, {
    event: 'before_tool_call',
    handler: async (event) => {
      const toolEvent = event as { toolName?: string };
      if (toolEvent.toolName) {
        toolState.toolCallStarts.set(toolEvent.toolName, Date.now());
      }
    },
  });

  // 工具调用结束：记录用量并用真实用量校准
  registerHook(pi, {
    event: 'after_tool_call',
    handler: async (event, ctx) => {
      const toolEvent = event as { toolName?: string; isError?: boolean; result?: unknown };
      if (toolEvent.toolName) {
        toolState.toolCallStarts.delete(toolEvent.toolName);
        toolState.runToolCount++;
        toolState.lastToolRecomputeTs = Date.now();
        const size = typeof toolEvent.result === 'string' ? toolEvent.result.length : 0;
        if (size > 0) recordToolUsage(toolEvent.toolName, estimateTokens(String(toolEvent.result)));
      }
      const usage = ctx.getContextUsage?.();
      if (usage?.tokens != null) setUsedTokens(usage.tokens);
    },
  });

  console.log('✅ Context feature registered');
}

export { getBudgetReport };
