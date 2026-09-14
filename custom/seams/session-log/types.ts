import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 会话日志 缝隙接口
// ============================================================================

export interface SessionLogService {
  /** 追加事件到日志 */
  append(event: SessionLogEvent): Promise<void>
  /** 读取日志事件 */
  read(options?: SessionLogReadOptions): Promise<SessionLogEvent[]>
  /** 从日志推导模型历史 */
  deriveMessages(options?: DeriveMessagesOptions): Promise<SessionLogMessage[]>
  /** 注册投影器 */
  registerProjection(name: string, projection: SessionProjection): void
  /** 获取投影状态 */
  getProjection(name: string): unknown
  /** 日志格式版本 */
  getVersion(): number
}

export interface SessionLogEvent {
  id: string
  type: string
  timestamp: number
  data: Record<string, unknown>
  /** 是否模型可见 */
  modelVisible: boolean
}

export interface SessionLogReadOptions {
  from?: number
  to?: number
  types?: string[]
  limit?: number
}

export interface DeriveMessagesOptions {
  /** 最大消息数 */
  maxMessages?: number
  /** 最大 token 数 */
  maxTokens?: number
  /** 是否包含系统消息 */
  includeSystem?: boolean
}

export interface SessionLogMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
}

export interface SessionProjection {
  /** 初始化 */
  init(): void
  /** 处理事件 */
  onEvent(event: SessionLogEvent): void
  /** 获取当前状态 */
  getState(): unknown
}

export const SESSION_LOG_SEAM_DEFINITION: ServiceDefinition<SessionLogService> = {
  name: 'session-log',
  description: '会话耐久日志能力',
  defaultProvider: 'jsonl',
}

export type SessionLogProvider = ServiceProvider<SessionLogService>
