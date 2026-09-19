/**
 * services/tool-system/index.ts - 工具系统服务统一导出
 *
 * 导出所有工具系统服务
 */

// 截断工具
export { truncateHead, truncateTail, truncateLine } from './truncate'

// 路径解析工具
export { expandTilde, resolveRelative, matchMacOSVariant } from './path-utils'

// 渲染工具
export { shortenPath, replaceTabs, getTextOutput } from './render-utils'

// Diff 工具
export { fuzzyFindText, applyEdits, generateDiff } from './edit-diff'

// 输出累积器
export { OutputAccumulator } from './output-accumulator'

// 文件变更队列
export { withFileMutationQueue } from './file-mutation-queue'

// 工具分层管理
export {
  CORE_TOOLS,
  SLEEPING_GROUPS,
  SLEEPING_TOOL_SET,
  validateGroups,
  buildSleepingSummary,
  computeActiveTools,
} from './tool-layering'

// 导出类型
export type { ToolGroup } from './tool-layering'
