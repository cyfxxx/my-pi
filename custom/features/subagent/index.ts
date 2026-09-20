/**
 * Subagent Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '../../../vendor/pi/packages/coding-agent/src/extension-api';
import { registerHook } from '../../adapters/hook-adapter';
import { createSubagentState, registerAgent, spawnAgent, completeAgent, listAgents } from './logic';

export function register(pi: ExtensionAPI): void {
  const state = createSubagentState();

  // 注册钩子：子代理启动
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async (_event: unknown, ctx: any) => {
      if (state.active && ctx.hasUI) {
        ctx.ui.notify(`子代理 ${state.currentAgent} 运行中`, 'info');
      }
    },
  });

  console.log('✅ Subagent feature registered');
}