import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// Webhook 缝隙接口
// ============================================================================

export interface WebhookService {
  /** 注册 webhook 规则 */
  registerRule(rule: WebhookRule): Promise<void>
  /** 删除 webhook 规则 */
  deleteRule(id: string): Promise<void>
  /** 处理入站事件 */
  handleEvent(event: WebhookEvent): Promise<WebhookResult>
  /** 列出规则 */
  listRules(): Promise<WebhookRule[]>
}

export interface WebhookRule {
  id: string
  /** 匹配条件 */
  match: WebhookMatch
  /** 动作 */
  action: WebhookAction
  /** 是否启用 */
  enabled: boolean
}

export interface WebhookMatch {
  /** 事件类型 */
  eventType?: string
  /** 来源 */
  source?: string
  /** 路径模式 */
  pathPattern?: string
  /** 自定义匹配 */
  custom?: (event: WebhookEvent) => boolean
}

export type WebhookAction =
  | { type: 'create_session'; task: string }
  | { type: 'inject_message'; content: string }
  | { type: 'run_command'; command: string }

export interface WebhookEvent {
  id: string
  type: string
  source: string
  payload: Record<string, unknown>
  timestamp: Date
}

export interface WebhookResult {
  success: boolean
  action?: string
  error?: string
}

export const WEBHOOK_SEAM_DEFINITION: ServiceDefinition<WebhookService> = {
  name: 'webhook',
  description: '外部事件 Webhook 能力',
  defaultProvider: 'http',
}

export type WebhookProvider = ServiceProvider<WebhookService>
