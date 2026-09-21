/**
 * Hook Adapter
 * 
 * 职责：封装 Pi 的生命周期钩子 API
 * 约束：
 *   - 这是唯一允许 import vendor/pi 的钩子相关模块的地方
 *   - 对外暴露稳定的 HookHandler 接口
 */

import type { ExtensionAPI, ExtensionContext, ExtensionEvent } from '@earendil-works/pi-coding-agent';

/**
 * 对上层暴露的稳定钩子上下文类型（Pi API 变更只需改此处）
 */
export type HookContext = ExtensionContext;

/**
 * 支持的钩子事件名：直接从 Pi 的 `ExtensionEvent` 派生。
 * 手动维护的清单会漂移（例如历史上曾写入 Pi 并不派发的 `before_tool_call`），
 * 此处以类型系统保证事件名有效，无效名会在 `tsc` 阶段报错。
 * 工具执行前后对应 Pi 的 `tool_call`（可 block）与 `tool_result`（可改）。
 */
export type HookEvent = ExtensionEvent['type'];

export interface HookHandler {
  event: HookEvent;
  handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;
}

/**
 * 注册一个钩子
 */
export function registerHook(pi: ExtensionAPI, hook: HookHandler): void {
  // Pi 的 on() 是逐事件重载；这里收窄为受约束的 HookEvent，
  // 事件名的有效性由 ExtensionEvent['type'] 在编译期保证。
  const on = pi.on as (event: HookEvent, handler: (event: unknown, ctx: ExtensionContext) => unknown) => void;
  on(hook.event, hook.handler);
}

/**
 * 批量注册钩子
 */
export function registerHooks(pi: ExtensionAPI, hooks: HookHandler[]): void {
  for (const hook of hooks) {
    registerHook(pi, hook);
  }
}
