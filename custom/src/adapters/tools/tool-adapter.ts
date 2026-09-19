/**
 * adapters/tools/tool-adapter.ts - 工具注册适配器
 *
 * 桥接工具注册，提供稳定的工具注册接口
 */

import type { ExtensionAPI, AgentToolResult } from '@earendil-works/pi-coding-agent'
import type { ToolAdapter, ToolDefinition } from '../types'

/**
 * 创建工具适配器
 */
export function createToolAdapter(pi: ExtensionAPI): ToolAdapter {
  return {
    /**
     * 注册单个工具
     */
    registerTool(definition: ToolDefinition): void {
      pi.registerTool({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as any,
        execute: async (toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) => {
          const result = await definition.execute(params, signal!)
          return result as AgentToolResult<any>
        },
      } as any)
    },
    
    /**
     * 批量注册工具
     */
    registerTools(definitions: ToolDefinition[]): void {
      for (const def of definitions) {
        this.registerTool(def)
      }
    },
  }
}

/**
 * 工具注册器
 * 提供更高级的工具注册功能
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()
  private adapter: ToolAdapter
  
  constructor(pi: ExtensionAPI) {
    this.adapter = createToolAdapter(pi)
  }
  
  /**
   * 注册工具
   */
  register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition)
    this.adapter.registerTool(definition)
  }
  
  /**
   * 批量注册工具
   */
  registerAll(definitions: ToolDefinition[]): void {
    for (const def of definitions) {
      this.register(def)
    }
  }
  
  /**
   * 获取已注册的工具
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }
  
  /**
   * 获取所有已注册的工具
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }
}
