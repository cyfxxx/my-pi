/**
 * adapters/session/session-adapter.ts - 会话管理适配器
 *
 * 桥接会话管理，提供稳定的会话接口
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { SessionAdapter, SessionStats, ContextUsage } from '../types'

/**
 * 创建会话适配器
 */
export function createSessionAdapter(pi: ExtensionAPI): SessionAdapter {
  return {
    /**
     * 获取会话统计
     */
    getStats(): SessionStats {
      // 默认实现
      return {
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalTokens: 0,
      }
    },
    
    /**
     * 获取上下文用量
     */
    getContextUsage(): ContextUsage | undefined {
      // 默认实现
      return undefined
    },
    
    /**
     * 导出会话
     */
    async export(format: 'html' | 'jsonl'): Promise<string> {
      // 默认实现
      return ''
    },
  }
}

/**
 * 会话管理器类
 * 提供更高级的会话管理功能
 */
export class SessionManager {
  private pi: ExtensionAPI
  private adapter: SessionAdapter
  
  constructor(pi: ExtensionAPI) {
    this.pi = pi
    this.adapter = createSessionAdapter(pi)
  }
  
  /**
   * 获取会话统计
   */
  getStats(): SessionStats {
    return this.adapter.getStats()
  }
  
  /**
   * 获取上下文用量
   */
  getContextUsage(): ContextUsage | undefined {
    return this.adapter.getContextUsage()
  }
  
  /**
   * 导出会话
   */
  async export(format: 'html' | 'jsonl'): Promise<string> {
    return this.adapter.export(format)
  }
}
