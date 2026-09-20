/**
 * Tool Adapter
 *
 * 职责：封装 Pi 的工具注册 API
 * 约束：
 *   - 这是唯一允许 import vendor/pi 的工具相关模块的地方
 *   - 对外暴露稳定的 ToolDefinition 接口
 *   - features 目录下的 logic.ts 不得 import 此文件
 *
 * pi 的 `ToolDefinition.parameters` 要求 TypeBox schema（不是普通对象），
 * 这里把简化的参数声明编译成合法的 TypeBox object schema。
 */

import type { ExtensionAPI, ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type TSchema } from 'typebox';

/** 简化的参数声明：features 只描述类型与说明，由适配器编译成 TypeBox schema */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  /** 缺省为必填；显式置 true 表示可选 */
  optional?: boolean;
}

/**
 * 我们对工具的定义，与 Pi 的 API 解耦
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** 把简化参数声明编译为 TypeBox object schema */
function buildParameterSchema(parameters: Record<string, ToolParameter>): TSchema {
  const properties: Record<string, TSchema> = {};
  for (const [name, spec] of Object.entries(parameters)) {
    const base =
      spec.type === 'number'
        ? Type.Number({ description: spec.description })
        : spec.type === 'boolean'
          ? Type.Boolean({ description: spec.description })
          : Type.String({ description: spec.description });
    properties[name] = spec.optional ? Type.Optional(base) : base;
  }
  return Type.Object(properties, { additionalProperties: false });
}

/**
 * 将我们的工具定义注册到 Pi
 */
export function registerTool(pi: ExtensionAPI, def: ToolDefinition): void {
  const tool = {
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: buildParameterSchema(def.parameters),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const result = await def.execute(params);
      return {
        content: [{ type: 'text', text: result }],
      };
    },
  } as unknown as PiToolDefinition;
  pi.registerTool(tool);
}
