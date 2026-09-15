/**
 * adapters/types.ts - 适配器类型定义
 *
 * 定义所有适配器的接口类型
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/**
 * 适配后的 ExtensionAPI 接口
 * 隔离 pi API 变化，提供稳定的接口
 */
export interface AdaptedExtensionAPI {
  // 事件系统
  on: ExtensionAPI['on']
  
  // 工具系统
  tool: ExtensionAPI['tool']
  
  // 命令系统
  command: ExtensionAPI['command']
  
  // 会话管理
  session: ExtensionAPI['session']
  
  // 其他可能需要的方法
  [key: string]: unknown
}

/**
 * 工具适配器接口
 */
export interface ToolAdapter {
  /**
   * 注册工具
   */
  registerTool(definition: ToolDefinition): void
  
  /**
   * 批量注册工具
   */
  registerTools(definitions: ToolDefinition[]): void
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: unknown
  execute: (params: unknown, signal: AbortSignal) => Promise<unknown>
}

/**
 * 工具拦截器接口
 */
export interface ToolInterceptor {
  /**
   * 工具调用前拦截
   */
  beforeCall?(toolName: string, params: unknown): Promise<unknown | null>
  
  /**
   * 工具调用后拦截
   */
  afterCall?(toolName: string, result: unknown): Promise<unknown>
}

/**
 * 工具分层管理器接口
 */
export interface ToolLayeringManager {
  /**
   * 获取核心工具列表
   */
  getCoreTools(): string[]
  
  /**
   * 获取休眠组配置
   */
  getSleepingGroups(): Record<string, string[]>
  
  /**
   * 计算活跃工具集
   */
  computeActiveTools(enabledGroups: string[]): string[]
}

/**
 * 会话适配器接口
 */
export interface SessionAdapter {
  /**
   * 获取会话统计
   */
  getStats(): SessionStats
  
  /**
   * 获取上下文用量
   */
  getContextUsage(): ContextUsage | undefined
  
  /**
   * 导出会话
   */
  export(format: 'html' | 'jsonl'): Promise<string>
}

/**
 * 会话统计
 */
export interface SessionStats {
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalTokens: number
}

/**
 * 上下文用量
 */
export interface ContextUsage {
  tokens: number
  contextWindow: number
  percent: number
}
