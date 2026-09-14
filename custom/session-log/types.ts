/**
 * Session Log 类型定义
 *
 * 核心原则：Model-visible = logged
 * 每个模型可见的输入必须有一个 SessionEvent
 */

// ============================================================================
// Session Event 类型
// ============================================================================

/** Session Event 基础类型 */
export interface SessionEventBase {
  /** 事件 ID（UUID v7） */
  id: string
  /** 事件类型 */
  type: SessionEventType
  /** 时间戳（ms） */
  timestamp: number
  /** 父事件 ID（形成树结构） */
  parentId?: string
  /** 是否模型可见 */
  modelVisible: boolean
}

/** Session Event 类型 */
export type SessionEventType =
  | 'user_message'       // 用户消息
  | 'assistant_message'  // 助手消息
  | 'tool_call'          // 工具调用
  | 'tool_result'        // 工具结果
  | 'system_prompt'      // 系统提示词
  | 'memory_inject'      // 记忆注入
  | 'plan_context'       // 计划上下文
  | 'compaction'         // 上下文压缩
  | 'model_change'       // 模型切换
  | 'thinking_change'    // 思考级别切换
  | 'branch_summary'     // 分支摘要
  | 'session_info'       // 会话信息
  | 'custom'             // 自定义事件

// ============================================================================
// 具体事件类型
// ============================================================================

/** 用户消息 */
export interface UserMessageEvent extends SessionEventBase {
  type: 'user_message'
  content: string
}

/** 助手消息 */
export interface AssistantMessageEvent extends SessionEventBase {
  type: 'assistant_message'
  content: string
  toolCalls?: ToolCallInfo[]
  usage?: TokenUsage
}

/** 工具调用 */
export interface ToolCallEvent extends SessionEventBase {
  type: 'tool_call'
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
}

/** 工具结果 */
export interface ToolResultEvent extends SessionEventBase {
  type: 'tool_result'
  toolName: string
  toolCallId: string
  content: unknown[]
  isError: boolean
  duration: number
}

/** 系统提示词变更 */
export interface SystemPromptEvent extends SessionEventBase {
  type: 'system_prompt'
  prompt: string
  reason: 'initial' | 'update' | 'override'
}

/** 记忆注入 */
export interface MemoryInjectEvent extends SessionEventBase {
  type: 'memory_inject'
  content: string
  entryCount: number
}

/** 计划上下文注入 */
export interface PlanContextEvent extends SessionEventBase {
  type: 'plan_context'
  content: string
  mode: 'plan' | 'execution'
}

/** 上下文压缩 */
export interface CompactionEvent extends SessionEventBase {
  type: 'compaction'
  summary: string
  originalTokenCount: number
  compactedTokenCount: number
}

/** 模型切换 */
export interface ModelChangeEvent extends SessionEventBase {
  type: 'model_change'
  model: string
  source: 'user' | 'system'
}

/** 思考级别切换 */
export interface ThinkingChangeEvent extends SessionEventBase {
  type: 'thinking_change'
  level: string
}

/** 分支摘要 */
export interface BranchSummaryEvent extends SessionEventBase {
  type: 'branch_summary'
  summary: string
  branchFrom: string
}

/** 会话信息 */
export interface SessionInfoEvent extends SessionEventBase {
  type: 'session_info'
  name?: string
  cwd?: string
}

/** 自定义事件 */
export interface CustomEvent extends SessionEventBase {
  type: 'custom'
  customType: string
  data: Record<string, unknown>
}

// ============================================================================
// 联合类型
// ============================================================================

export type SessionEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | SystemPromptEvent
  | MemoryInjectEvent
  | PlanContextEvent
  | CompactionEvent
  | ModelChangeEvent
  | ThinkingChangeEvent
  | BranchSummaryEvent
  | SessionInfoEvent
  | CustomEvent

// ============================================================================
// 辅助类型
// ============================================================================

export interface ToolCallInfo {
  id: string
  name: string
  arguments: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ============================================================================
// 日志读写接口
// ============================================================================

/** Session Log 写入器 */
export interface SessionLogWriter {
  /** 追加事件 */
  append(event: SessionEvent): Promise<void>
  /** 刷新到磁盘 */
  flush(): Promise<void>
  /** 关闭日志 */
  close(): Promise<void>
}

/** Session Log 读取器 */
export interface SessionLogReader {
  /** 读取事件 */
  read(options?: SessionLogReadOptions): Promise<SessionEvent[]>
  /** 读取单个事件 */
  get(id: string): Promise<SessionEvent | undefined>
  /** 获取最新事件 */
  getLatest(type?: SessionEventType): Promise<SessionEvent | undefined>
}

export interface SessionLogReadOptions {
  from?: number
  to?: number
  types?: SessionEventType[]
  limit?: number
  modelVisibleOnly?: boolean
}

/** Session Log 完整接口 */
export interface SessionLog extends SessionLogWriter, SessionLogReader {
  /** 获取日志版本 */
  getVersion(): number
  /** 获取事件总数 */
  count(): number
  /** 注册投影器 */
  registerProjection(name: string, projection: SessionProjection): void
  /** 获取投影状态 */
  getProjection<T>(name: string): T | undefined
}

// ============================================================================
// 投影器接口
// ============================================================================

/** Session Projection — 增量投影 */
export interface SessionProjection<T = unknown> {
  /** 初始化 */
  init(events: SessionEvent[]): void
  /** 处理新事件 */
  onEvent(event: SessionEvent): void
  /** 获取当前状态 */
  getState(): T
  /** 重置 */
  reset(): void
}

// ============================================================================
// 推导消息接口
// ============================================================================

/** 从日志推导的模型消息 */
export interface DerivedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
}

/** 推导选项 */
export interface DeriveMessagesOptions {
  /** 最大消息数 */
  maxMessages?: number
  /** 最大 token 数 */
  maxTokens?: number
  /** 是否包含系统消息 */
  includeSystem?: boolean
  /** 从哪个事件开始 */
  fromEventId?: string
}
