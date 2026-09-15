/**
 * custom/src/index.ts - 自定义层统一入口
 *
 * 导出所有自定义层功能
 */

// 适配器层
export * from './adapters'

// 服务层
export * from './services'

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
} from './adapters/types'
