import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 交互 缝隙接口
// ============================================================================

export interface InteractionService {
  /** 请求用户批准 */
  approve(request: ApprovalRequest): Promise<ApprovalResult>
  /** 向用户提问 */
  ask(question: AskQuestion): Promise<AskResult>
  /** 显示通知 */
  notify(notification: Notification): Promise<void>
}

export interface ApprovalRequest {
  /** 操作类型 */
  type: 'tool_call' | 'file_write' | 'command_execute' | 'credential_access'
  /** 操作描述 */
  description: string
  /** 操作详情 */
  details?: Record<string, unknown>
  /** 风险等级 */
  risk: 'low' | 'medium' | 'high'
}

export interface ApprovalResult {
  approved: boolean
  reason?: string
}

export interface AskQuestion {
  question: string
  options?: AskOption[]
  /** 是否支持自定义输入 */
  allowCustom?: boolean
}

export interface AskOption {
  label: string
  value: string
  description?: string
}

export interface AskResult {
  answer: string
  label?: string
}

export interface Notification {
  title: string
  message: string
  level: 'info' | 'warning' | 'error' | 'success'
}

export const INTERACTION_SEAM_DEFINITION: ServiceDefinition<InteractionService> = {
  name: 'interaction',
  description: '人类交互能力（approval, ask, notify）',
  defaultProvider: 'terminal',
}

export type InteractionProvider = ServiceProvider<InteractionService>
