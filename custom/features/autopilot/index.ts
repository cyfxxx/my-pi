/**
 * Autopilot Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '../../../vendor/pi/packages/coding-agent/src/extension-api';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import {
  createAutopilotConfig,
  createAutopilotState,
  canContinue,
  nextStep,
  completeAutopilot,
  addResult,
  getResults,
  clearResults,
} from './logic';

export function register(pi: ExtensionAPI): void {
  const config = createAutopilotConfig();
  const state = createAutopilotState();

  // 注册工具：启动自动驾驶
  registerTool(pi, {
    name: 'autopilot_start',
    description: '启动自动驾驶模式',
    parameters: {
      task: { type: 'string', description: '要执行的任务' },
    },
    execute: async (args: { task?: string }) => {
      if (!args?.task) return '错误：缺少任务参数';
      
      state.active = true;
      state.step = 0;
      clearResults(state);
      
      return `自动驾驶已启动: ${args.task}`;
    },
  });

  // 注册工具：停止自动驾驶
  registerTool(pi, {
    name: 'autopilot_stop',
    description: '停止自动驾驶模式',
    parameters: {},
    execute: async () => {
      state.active = false;
      const results = getResults(state);
      return `自动驾驶已停止，执行了 ${results.length} 个步骤`;
    },
  });

  // 注册工具：获取自动驾驶状态
  registerTool(pi, {
    name: 'autopilot_status',
    description: '获取自动驾驶状态',
    parameters: {},
    execute: async () => {
      return `自动驾驶状态: ${state.active ? '运行中' : '已停止'}, 步骤: ${state.step}/${state.maxSteps}, 预算: ${state.budgetUsed}/${state.budgetLimit}`;
    },
  });

  // 注册钩子：每轮检查自动驾驶状态
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async (_event: unknown, ctx: any) => {
      if (state.active && canContinue(state)) {
        nextStep(state);
      } else if (state.active) {
        completeAutopilot(state, '自动驾驶完成');
      }
    },
  });

  console.log('✅ Autopilot feature registered');
}