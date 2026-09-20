/**
 * Plan Mode Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { createPlanState, startPlan, nextStep, completePlan } from './logic';

export function register(pi: ExtensionAPI): void {
  const state = createPlanState();

  // 注册钩子：计划模式启动
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event: unknown, ctx: any) => {
      if (ctx.hasUI) {
        ctx.ui.notify('计划模式已就绪', 'info');
      }
    },
  });

  console.log('✅ Plan Mode feature registered');
}