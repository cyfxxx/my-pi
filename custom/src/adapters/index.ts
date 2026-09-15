/**
 * adapters/index.ts - 适配器统一导出
 *
 * 导出所有适配器，提供统一的访问入口
 */

// 类型定义
export type {
  AdaptedExtensionAPI,
  ToolAdapter,
  ToolDefinition,
  ToolInterceptor,
  ToolLayeringManager,
  SessionAdapter,
  SessionStats,
  ContextUsage,
} from './types'

// API 适配器
export { createAdaptedAPI, createEnhancedAPI } from './api'

// 工具适配器
export { createToolAdapter, ToolRegistry } from './tools/tool-adapter'
export { createToolInterceptor, ToolInterceptorManager } from './tools/interceptor'
export {
  createToolLayeringManager,
  ToolLayeringManagerImpl,
  CORE_TOOLS,
  SLEEPING_GROUPS,
} from './tools/layering'

// 会话适配器
export { createSessionAdapter, SessionManager } from './session/session-adapter'
export { createExportAdapter, SessionExporter } from './session/export-adapter'

// 导出类型
export type { ExportOptions } from './session/export-adapter'
