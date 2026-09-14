import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 子代理 缝隙接口
// ============================================================================

export interface SubagentService {
  /** 启动子代理 */
  spawn(options: SubagentSpawnOptions): Promise<SubagentHandle>
  /** 委托任务给子代理 */
  delegate(options: SubagentDelegateOptions): Promise<SubagentResult>
  /** 列出活跃子代理 */
  list(): Promise<SubagentInfo[]>
  /** 终止子代理 */
  terminate(id: string): Promise<void>
}

export interface SubagentSpawnOptions {
  /** 任务描述 */
  task: string
  /** 使用的模型 */
  model?: string
  /** 超时时间（ms） */
  timeout?: number
  /** 是否隔离上下文 */
  isolated?: boolean
}

export interface SubagentDelegateOptions {
  /** 任务描述 */
  task: string
  /** 上下文消息 */
  context?: string[]
  /** 超时时间（ms） */
  timeout?: number
}

export interface SubagentHandle {
  id: string
  status: 'running' | 'completed' | 'failed' | 'terminated'
  result?: SubagentResult
  /** 等待完成 */
  wait(): Promise<SubagentResult>
}

export interface SubagentResult {
  success: boolean
  output: string
  error?: string
  duration: number
}

export interface SubagentInfo {
  id: string
  task: string
  status: string
  startedAt: Date
}

export const SUBAGENT_SEAM_DEFINITION: ServiceDefinition<SubagentService> = {
  name: 'subagent',
  description: '子代理调度能力',
  defaultProvider: 'local',
}

export type SubagentProvider = ServiceProvider<SubagentService>
