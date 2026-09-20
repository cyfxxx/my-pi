/**
 * Hook Adapter
 * 
 * 职责：封装 Pi 的生命周期钩子 API
 * 约束：
 *   - 这是唯一允许 import vendor/pi 的钩子相关模块的地方
 *   - 对外暴露稳定的 HookHandler 接口
 */

import type { ExtensionAPI } from '../../vendor/pi/packages/coding-agent/src/extension-api';

/**
 * 我们支持的钩子事件类型
 * 注意：只列出我们实际使用的，不要照搬 Pi 的全部事件
 */
export type HookEvent =
  | 'agent_start'
  | 'agent_end'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'message';

export interface HookHandler {
  event: HookEvent;
  handler: (...args: unknown[]) => Promise<void> | void;
}

/**
 * 注册一个钩子
 */
export function registerHook(pi: ExtensionAPI, hook: HookHandler): void {
  pi.on(hook.event, hook.handler);
}

/**
 * 批量注册钩子
 */
export function registerHooks(pi: ExtensionAPI, hooks: HookHandler[]): void {
  for (const hook of hooks) {
    registerHook(pi, hook);
  }
}
