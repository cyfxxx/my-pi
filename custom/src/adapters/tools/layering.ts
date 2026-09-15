/**
 * adapters/tools/layering.ts - 工具分层适配器
 *
 * 桥接工具分层，提供稳定的分层接口
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ToolLayeringManager } from '../types'

/**
 * 核心工具列表
 * 这些工具始终可用
 */
export const CORE_TOOLS = [
  'bash',
  'read',
  'write',
  'edit',
  'grep',
  'find',
  'ls',
  'task',
  'todowrite',
  'webfetch',
  'websearch',
  'skill',
]

/**
 * 休眠组配置
 * 这些工具按需启用
 */
export const SLEEPING_GROUPS: Record<string, string[]> = {
  'browser-core': ['browser-navigate', 'browser-click', 'browser-type'],
  'browser-advanced': ['browser-screenshot', 'browser-evaluate'],
  'browser-full': ['browser-navigate', 'browser-click', 'browser-type', 'browser-screenshot', 'browser-evaluate'],
  'admin': ['admin-restart', 'admin-update'],
  'autopilot': ['autopilot-start', 'autopilot-stop', 'autopilot-status'],
  'memory': ['memory-store', 'memory-retrieve', 'memory-search'],
  'voice': ['voice-record', 'voice-transcribe'],
  'web-search': ['web-search', 'web-fetch'],
  'todo': ['todo-create', 'todo-update', 'todo-delete'],
  'session': ['session-list', 'session-switch', 'session-fork'],
}

/**
 * 创建工具分层管理器
 */
export function createToolLayeringManager(pi: ExtensionAPI): ToolLayeringManager {
  return {
    /**
     * 获取核心工具列表
     */
    getCoreTools(): string[] {
      return CORE_TOOLS
    },
    
    /**
     * 获取休眠组配置
     */
    getSleepingGroups(): Record<string, string[]> {
      return SLEEPING_GROUPS
    },
    
    /**
     * 计算活跃工具集
     */
    computeActiveTools(enabledGroups: string[]): string[] {
      const activeTools = [...CORE_TOOLS]
      
      for (const group of enabledGroups) {
        const groupTools = SLEEPING_GROUPS[group]
        if (groupTools) {
          activeTools.push(...groupTools)
        }
      }
      
      return activeTools
    },
  }
}

/**
 * 工具分层管理器类
 * 提供更高级的分层管理功能
 */
export class ToolLayeringManagerImpl implements ToolLayeringManager {
  private enabledGroups: Set<string> = new Set()
  private pi: ExtensionAPI
  
  constructor(pi: ExtensionAPI) {
    this.pi = pi
  }
  
  /**
   * 获取核心工具列表
   */
  getCoreTools(): string[] {
    return CORE_TOOLS
  }
  
  /**
   * 获取休眠组配置
   */
  getSleepingGroups(): Record<string, string[]> {
    return SLEEPING_GROUPS
  }
  
  /**
   * 启用工具组
   */
  enableGroup(groupName: string): void {
    this.enabledGroups.add(groupName)
  }
  
  /**
   * 禁用工具组
   */
  disableGroup(groupName: string): void {
    this.enabledGroups.delete(groupName)
  }
  
  /**
   * 检查工具组是否启用
   */
  isGroupEnabled(groupName: string): boolean {
    return this.enabledGroups.has(groupName)
  }
  
  /**
   * 计算活跃工具集
   */
  computeActiveTools(enabledGroups?: string[]): string[] {
    const groups = enabledGroups ?? Array.from(this.enabledGroups)
    const activeTools = [...CORE_TOOLS]
    
    for (const group of groups) {
      const groupTools = SLEEPING_GROUPS[group]
      if (groupTools) {
        activeTools.push(...groupTools)
      }
    }
    
    return activeTools
  }
}
