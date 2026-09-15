/**
 * adapters/api.ts - ExtensionAPI 适配器
 *
 * 桥接 pi 的 ExtensionAPI，隔离 API 变化
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { AdaptedExtensionAPI } from './types'

/**
 * 创建适配后的 ExtensionAPI
 * 封装 pi API，隔离变化
 */
export function createAdaptedAPI(pi: ExtensionAPI): AdaptedExtensionAPI {
  return {
    // 事件系统 - 绑定原始方法
    on: pi.on.bind(pi),
    
    // 工具系统 - 绑定原始方法
    tool: pi.tool.bind(pi),
    
    // 命令系统 - 绑定原始方法
    command: pi.command.bind(pi),
    
    // 会话管理 - 绑定原始方法
    session: pi.session.bind(pi),
    
    // 保留原始 pi 引用（用于需要直接访问的场景）
    _original: pi,
  }
}

/**
 * 适配器工厂
 * 创建带有额外功能的适配 API
 */
export function createEnhancedAPI(pi: ExtensionAPI): AdaptedExtensionAPI {
  const adapted = createAdaptedAPI(pi)
  
  // 可以在这里添加额外的功能
  // 例如：日志、错误处理、重试等
  
  return adapted
}
