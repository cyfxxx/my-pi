/**
 * Hook Adapter
 * 
 * 职责：封装 Pi 的生命周期钩子 API
 * 约束：
 *   - 这是唯一允许 import vendor/pi 的钩子相关模块的地方
 *   - 对外暴露稳定的 HookHandler 接口
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * 我们支持的钩子事件类型
 * 注意：只列出我们实际使用的，不要照搬 Pi 的全部事件
 */
export type HookEvent =
  | 'agent_start'
  | 'agent_end'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'message'
  | 'session_start'
  | 'session_shutdown'
  | 'session_before_compact'
  | 'session_compact'
  | 'before_agent_start'
  | 'context'
  | 'turn_start'
  | 'turn_end'
  | 'input'
  | 'tool_call'
  | 'tool_result'
  | 'tool_execution_start'
  | 'tool_execution_update'
  | 'tool_execution_end'
  | 'message_start'
  | 'message_update'
  | 'message_end'
  | 'model_select'
  | 'thinking_level_select'
  | 'user_bash'
  | 'project_trust'
  | 'resources_discover'
  | 'session_info_changed'
  | 'session_before_switch'
  | 'session_before_fork'
  | 'session_before_tree'
  | 'session_tree'
  | 'before_provider_request'
  | 'before_provider_headers'
  | 'after_provider_response'
  | 'ui_prompt_start'
  | 'ui_prompt_end'
  | 'agent_settled';

export interface HookHandler {
  event: HookEvent;
  handler: (...args: unknown[]) => Promise<unknown> | unknown;
}

/**
 * 注册一个钩子
 */
export function registerHook(pi: ExtensionAPI, hook: HookHandler): void {
  (pi as any).on(hook.event, hook.handler);
}

/**
 * 批量注册钩子
 */
export function registerHooks(pi: ExtensionAPI, hooks: HookHandler[]): void {
  for (const hook of hooks) {
    registerHook(pi, hook);
  }
}
