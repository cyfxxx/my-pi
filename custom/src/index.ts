/**
 * custom/src/index.ts - 自定义层统一入口
 *
 * 导出所有自定义层功能
 */

// 适配器层
export {
  createAdaptedAPI,
  createEnhancedAPI,
  createToolAdapter,
  ToolRegistry,
  createSessionAdapter,
  createExportAdapter,
} from './adapters'

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

export type { ExportOptions } from './adapters/session/export-adapter'

// 服务层
export {
  archiveOutput,
  archivedStub,
  sweepPruneRefs,
  setContextWindow,
  setUsedTokens,
  getBudgetReport,
} from './services/token-budget'
