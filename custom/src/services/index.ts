/**
 * services/index.ts - 服务层统一导出
 *
 * 导出所有下沉的服务
 */

// 工具系统服务
export {
  truncateHead,
  truncateTail,
  truncateLine,
  expandTilde,
  resolveRelative,
  matchMacOSVariant,
  shortenPath,
  replaceTabs,
  getTextOutput,
  fuzzyFindText,
  applyEdits,
  generateDiff,
  OutputAccumulator,
  CORE_TOOLS,
  SLEEPING_GROUPS,
  SLEEPING_TOOL_SET,
  validateGroups,
  buildSleepingSummary,
  computeActiveTools,
} from './tool-system'

// Token 预算服务
export {
  archiveOutput,
  archivedStub,
  sweepPruneRefs,
  setContextWindow,
  setUsedTokens,
  getBudgetReport,
} from './token-budget'
