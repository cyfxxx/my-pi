/**
 * services/session/index.ts - 会话管理服务统一导出
 *
 * 导出所有会话管理服务
 */

// 会话统计
export { computeSessionStats } from './session-stats'
export type { SessionStats, SessionEntry as SessionStatsEntry } from './session-stats'

// 上下文用量
export { computeContextUsage } from './context-usage'
export type { ContextUsage, AgentMessage, ModelInfo } from './context-usage'

// 会话导出
export { exportSessionToHtml, exportSessionToJsonl } from './session-export'
export type { ExportOptions, SessionManagerInterface } from './session-export'

// 会话发现
export { discoverSessions, extractTimestampFromFilename } from './session-discovery'
export type { SessionInfo, SessionListProgress } from './session-discovery'

// 日志桥接
export { sessionEntryToLogEvent, attachSessionLog } from './session-log-bridge'
export type { SessionLog, SessionManagerInterface as SessionManagerForLog } from './session-log-bridge'
