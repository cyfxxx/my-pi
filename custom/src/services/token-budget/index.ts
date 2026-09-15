/**
 * services/token-budget/index.ts - Token 预算服务统一导出
 *
 * 导出所有 Token 预算服务
 */

// 输出擦除
export { archiveOutput, archivedStub, sweepPruneRefs } from './prune'

// 上下文预算
export {
  setContextWindow,
  setUsedTokens,
  getBudgetReport,
  isUnderPressure,
  getPressureLabel,
} from './context-budget'

// 自动压缩
export {
  shouldAutoCompact,
  getAutoCompactThreshold,
  getCooldownMs,
} from './auto-compact'
