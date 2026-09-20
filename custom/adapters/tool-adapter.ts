/**
 * Tool Adapter
 * 
 * 职责：封装 Pi 的工具注册 API
 * 约束：
 *   - 这是唯一允许 import vendor/pi 的工具相关模块的地方
 *   - 对外暴露稳定的 ToolDefinition 接口
 *   - features 目录下的 logic.ts 不得 import 此文件
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * 我们对工具的定义，与 Pi 的 API 解耦
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * 将我们的工具定义注册到 Pi
 */
export function registerTool(pi: ExtensionAPI, def: ToolDefinition): void {
  (pi as any).registerTool({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: def.parameters,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const result = await def.execute(params);
      return {
        content: [{ type: 'text', text: result }],
      };
    },
  });
}