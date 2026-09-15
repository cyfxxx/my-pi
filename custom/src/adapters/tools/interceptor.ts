/**
 * adapters/tools/interceptor.ts - 工具拦截适配器
 *
 * 桥接工具拦截，提供稳定的拦截接口
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ToolInterceptor } from '../types'

/**
 * 创建工具拦截器
 */
export function createToolInterceptor(pi: ExtensionAPI): ToolInterceptor {
  return {
    /**
     * 工具调用前拦截
     */
    async beforeCall(toolName: string, params: unknown): Promise<unknown | null> {
      // 默认不拦截，返回 null 表示继续执行
      return null
    },
    
    /**
     * 工具调用后拦截
     */
    async afterCall(toolName: string, result: unknown): Promise<unknown> {
      // 默认不修改，直接返回结果
      return result
    },
  }
}

/**
 * 工具拦截管理器
 * 管理多个拦截器
 */
export class ToolInterceptorManager {
  private interceptors: ToolInterceptor[] = []
  
  /**
   * 添加拦截器
   */
  addInterceptor(interceptor: ToolInterceptor): void {
    this.interceptors.push(interceptor)
  }
  
  /**
   * 移除拦截器
   */
  removeInterceptor(interceptor: ToolInterceptor): void {
    const index = this.interceptors.indexOf(interceptor)
    if (index !== -1) {
      this.interceptors.splice(index, 1)
    }
  }
  
  /**
   * 执行前置拦截
   */
  async runBeforeInterceptors(toolName: string, params: unknown): Promise<{ params: unknown; block: boolean }> {
    let currentParams = params
    let block = false
    
    for (const interceptor of this.interceptors) {
      if (interceptor.beforeCall) {
        const result = await interceptor.beforeCall(toolName, currentParams)
        if (result === null) {
          // 返回 null 表示阻止执行
          block = true
          break
        }
        currentParams = result
      }
    }
    
    return { params: currentParams, block }
  }
  
  /**
   * 执行后置拦截
   */
  async runAfterInterceptors(toolName: string, result: unknown): Promise<unknown> {
    let currentResult = result
    
    for (const interceptor of this.interceptors) {
      if (interceptor.afterCall) {
        currentResult = await interceptor.afterCall(toolName, currentResult)
      }
    }
    
    return currentResult
  }
}
