import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 会话标题 缝隙接口
// ============================================================================

export interface SessionTitleService {
  /** 生成会话标题 */
  generate(messages: SessionTitleMessage[]): Promise<string>
  /** 检查是否可用 */
  available(): Promise<boolean>
}

export interface SessionTitleMessage {
  role: 'user' | 'assistant'
  content: string
}

export const SESSION_TITLE_SEAM_DEFINITION: ServiceDefinition<SessionTitleService> = {
  name: 'session-title',
  description: '会话标题自动生成能力',
  defaultProvider: 'llm',
}

export type SessionTitleProvider = ServiceProvider<SessionTitleService>
