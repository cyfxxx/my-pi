/**
 * Context Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import {
  createToolLifecycleState,
  createMessageFilterState,
  createAutoCompactState,
  createWarmPrefixState,
  EFFICIENCY_ADVICE,
  LOW_PRESSURE_DELEGATION,
  FULL_DELEGATION_ADVICE,
} from './logic';

export { EFFICIENCY_ADVICE, LOW_PRESSURE_DELEGATION, FULL_DELEGATION_ADVICE };

export function register(pi: ExtensionAPI): void {
  // 创建共享状态
  const warmState = createWarmPrefixState();
  const toolState = createToolLifecycleState();
  const msgState = createMessageFilterState();
  const acState = createAutoCompactState();

  // 注册钩子
  registerHook(pi, {
    event: 'before_tool_call',
    handler: async (event: unknown) => {
      const toolEvent = event as { toolName?: string };
      if (toolEvent.toolName) {
        toolState.toolCallStarts.set(toolEvent.toolName, Date.now());
      }
    },
  });

  registerHook(pi, {
    event: 'after_tool_call',
    handler: async (event: unknown) => {
      const toolEvent = event as { toolName?: string; isError?: boolean };
      if (toolEvent.toolName) {
        toolState.toolCallStarts.delete(toolEvent.toolName);
        toolState.runToolCount++;
        toolState.lastToolRecomputeTs = Date.now();
      }
    },
  });

  registerHook(pi, {
    event: 'message',
    handler: async () => {
      // 消息过滤逻辑
      msgState.lastCompactionTs = Date.now();
    },
  });

  console.log('✅ Context feature registered');
}
