/**
 * Subagent Feature
 *
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 *
 * 迁移自 pi-tools subagent：内置 reviewer/scout/worker 角色定义。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { createSubagentState, registerBuiltinAgents, listAgents } from './logic';

export function register(pi: ExtensionAPI): void {
  const state = createSubagentState();
  registerBuiltinAgents(state);

  // 会话开始：提示可用子代理角色
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      const agents = listAgents(state);
      if (agents.length > 0 && ctx.hasUI) {
        ctx.ui.notify(`子代理角色: ${agents.join(', ')}`, 'info');
      }
    },
  });

  console.log('✅ Subagent feature registered');
}
