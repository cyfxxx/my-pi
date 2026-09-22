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
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'json';
  description: string;
  /** 缺省为必填；显式置 true 表示可选 */
  optional?: boolean;
  /** type='string' 时的枚举取值 */
  enum?: readonly string[];
}

/**
 * 暴露给工具实现的运行时上下文（Pi ExtensionContext 的稳定子集）。
 * features 的 index.ts 可用它做 UI 确认 / 主动关机 / 读取环境，不直接接触 Pi 类型。
 */
export interface ToolExecuteContext {
  /** 是否处于交互 UI（headless 时为 false/undefined） */
  hasUI?: boolean;
  confirm?: (title: string, message: string) => Promise<boolean>;
  notify?: (message: string, level?: string) => void;
  /** 请求重启/退出（由 supervisor 消费 admin state 后决定是否重拉） */
  shutdown?: () => void;
}

/**
 * 我们对工具的定义，与 Pi 的 API 解耦
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>, ctx?: ToolExecuteContext) => Promise<string>;
  /** 可选：TUI 渲染回调（透传给 Pi；theme/context 不透明） */
  renderCall?: (args: Record<string, unknown>, theme: unknown, context: unknown) => unknown;
  renderResult?: (
    result: { content: { type: string; text?: string }[]; details?: unknown },
    options: { expanded?: boolean },
    theme: unknown,
    context: unknown,
  ) => unknown;
}

/** 把简化参数声明编译为 TypeBox object schema */
function buildParameterSchema(parameters: Record<string, ToolParameter>): TSchema {
  const properties: Record<string, TSchema> = {};
  for (const [name, spec] of Object.entries(parameters)) {
    let base: TSchema;
    if (spec.type === 'number') {
      base = Type.Number({ description: spec.description });
    } else if (spec.type === 'boolean') {
      base = Type.Boolean({ description: spec.description });
    } else if (spec.type === 'string[]') {
      base = Type.Array(Type.String(), { description: spec.description });
    } else if (spec.type === 'json') {
      base = Type.Unknown({ description: spec.description });
    } else if (spec.enum && spec.enum.length > 0) {
      base = Type.Union(
        spec.enum.map((v) => Type.Literal(v)),
        { description: spec.description },
      );
    } else {
      base = Type.String({ description: spec.description });
    }
    properties[name] = spec.optional ? Type.Optional(base) : base;
  }
  return Type.Object(properties, { additionalProperties: false });
}

/** 由 Pi 的 ExtensionContext 提取稳定子集（缺项安全降级） */
function buildExecuteContext(piCtx: unknown): ToolExecuteContext | undefined {
  if (!piCtx || typeof piCtx !== 'object') return undefined;
  const c = piCtx as {
    hasUI?: boolean;
    shutdown?: () => void;
    ui?: {
      confirm?: (title: string, message: string) => Promise<boolean>;
      notify?: (message: string, level?: string) => void;
    };
  };
  return {
    hasUI: c.hasUI,
    confirm: typeof c.ui?.confirm === 'function' ? (t, m) => c.ui!.confirm!(t, m) : undefined,
    notify: typeof c.ui?.notify === 'function' ? (m, l) => c.ui!.notify!(m, l) : undefined,
    shutdown: typeof c.shutdown === 'function' ? () => c.shutdown!() : undefined,
  };
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
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal?: unknown,
      _onUpdate?: unknown,
      piCtx?: unknown,
    ) => {
      const result = await def.execute(params, buildExecuteContext(piCtx));
      return {
        content: [{ type: 'text', text: result }],
      };
    },
    ...(def.renderCall ? { renderCall: def.renderCall } : {}),
    ...(def.renderResult ? { renderResult: def.renderResult } : {}),
  } as unknown as PiToolDefinition;
  pi.registerTool(tool);
}
