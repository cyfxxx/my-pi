/**
 * 事件系统类型定义
 *
 * 5 种调度模式：
 * - emit: 通知型，无返回值，监听器按注册顺序执行
 * - waterfall: 中间件链，监听器可修改传递值，可短路
 * - parallel: 并发执行所有监听器
 * - serial: 顺序执行，有返回值
 * - bail: 顺序执行直到第一个返回值
 */

// ============================================================================
// 调度模式
// ============================================================================

export type DispatchMode = 'emit' | 'waterfall' | 'parallel' | 'serial' | 'bail'

// ============================================================================
// 事件定义
// ============================================================================

/**
 * 事件定义 — 声明事件的类型和调度模式
 */
export interface EventDefinition<TPayload = unknown, TResult = void> {
  /** 事件名称 */
  name: string
  /** 调度模式 */
  mode: DispatchMode
  /** 事件描述 */
  description: string
  /** 是否持久化（写入 session log） */
  durable?: boolean
  /** 是否模型可见 */
  modelVisible?: boolean
}

// ============================================================================
// 事件处理器
// ============================================================================

/**
 * emit 模式的处理器
 */
export type EmitHandler<TPayload> = (payload: TPayload) => void | Promise<void>

/**
 * waterfall 模式的处理器
 */
export type WaterfallHandler<TPayload, TResult> = (
  payload: TPayload,
  next: (result: TResult) => TResult
) => TResult | Promise<TResult>

/**
 * parallel 模式的处理器
 */
export type ParallelHandler<TPayload> = (payload: TPayload) => void | Promise<void>

/**
 * serial 模式的处理器
 */
export type SerialHandler<TPayload, TResult> = (
  payload: TPayload
) => TResult | Promise<TResult>

/**
 * bail 模式的处理器
 */
export type BailHandler<TPayload, TResult> = (
  payload: TPayload
) => TResult | undefined | Promise<TResult | undefined>

/**
 * 统一的事件处理器（内部使用）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventHandler<TPayload = any, TResult = any> =
  | EmitHandler<TPayload>
  | WaterfallHandler<TPayload, TResult>
  | ParallelHandler<TPayload>
  | SerialHandler<TPayload, TResult>
  | BailHandler<TPayload, TResult>

// ============================================================================
// 事件声明（扩展 EventMap）
// ============================================================================

/**
 * 框架事件声明
 *
 * 扩展通过声明合并扩展此接口
 */
export interface FrameworkEventMap {
  // Session 事件
  session_start: EventDefinition<SessionStartEvent>
  session_shutdown: EventDefinition<SessionShutdownEvent>
  session_before_compact: EventDefinition<SessionBeforeCompactEvent, CompactResult>
  session_compact: EventDefinition<SessionCompactEvent>
  session_compact_failed: EventDefinition<SessionCompactFailedEvent>
  session_before_switch: EventDefinition<SessionBeforeSwitchEvent, SwitchResult>
  session_before_fork: EventDefinition<SessionBeforeForkEvent, ForkResult>

  // Agent 生命周期事件
  before_agent_start: EventDefinition<BeforeAgentStartEvent, BeforeAgentStartResult>
  agent_start: EventDefinition<AgentStartEvent>
  agent_end: EventDefinition<AgentEndEvent>
  agent_settled: EventDefinition<AgentSettledEvent>

  // Turn 事件
  turn_start: EventDefinition<TurnStartEvent>
  turn_end: EventDefinition<TurnEndEvent>

  // 消息事件
  message_start: EventDefinition<MessageStartEvent>
  message_update: EventDefinition<MessageUpdateEvent>
  message_end: EventDefinition<MessageEndEvent, MessageEndResult>

  // 工具事件
  tool_call: EventDefinition<ToolCallEvent, ToolCallResult>
  tool_result: EventDefinition<ToolResultEvent, ToolResultResult>
  tool_execution_start: EventDefinition<ToolExecutionStartEvent>
  tool_execution_end: EventDefinition<ToolExecutionEndEvent>

  // 上下文事件
  context: EventDefinition<ContextEvent, ContextResult>

  // 输入事件
  input: EventDefinition<InputEvent, InputResult>
}

// ============================================================================
// 事件载荷类型
// ============================================================================

// Session 事件
export interface SessionStartEvent {
  reason: 'startup' | 'reload' | 'new' | 'resume' | 'fork'
  cwd: string
}

export interface SessionShutdownEvent {
  reason: 'quit' | 'reload' | 'new' | 'resume' | 'fork'
}

export interface SessionBeforeCompactEvent {
  messages: unknown[]
  tokenCount: number
}

export interface CompactResult {
  compacted?: boolean
}

export interface SessionCompactEvent {
  summary: string
}

export interface SessionCompactFailedEvent {
  error: string
}

export interface SessionBeforeSwitchEvent {
  targetPath: string
}

export interface SwitchResult {
  cancel?: boolean
}

export interface SessionBeforeForkEvent {
  targetPath: string
}

export interface ForkResult {
  cancel?: boolean
}

// Agent 生命周期事件
export interface BeforeAgentStartEvent {
  messages: unknown[]
  systemPrompt: string
  cwd: string
}

export interface BeforeAgentStartResult {
  messages?: unknown[]
  systemPrompt?: string
}

export interface AgentStartEvent {
  cwd: string
}

export interface AgentEndEvent {
  messages: unknown[]
}

export interface AgentSettledEvent {
  messages: unknown[]
}

// Turn 事件
export interface TurnStartEvent {
  turnIndex: number
  timestamp: number
}

export interface TurnEndEvent {
  turnIndex: number
  message?: unknown
  toolResults?: unknown[]
}

// 消息事件
export interface MessageStartEvent {
  role: 'user' | 'assistant' | 'tool'
  content?: string
}

export interface MessageUpdateEvent {
  role: 'assistant'
  chunk: string
}

export interface MessageEndEvent {
  role: 'user' | 'assistant' | 'tool'
  content: string
}

export interface MessageEndResult {
  message?: unknown
}

// 工具事件
export interface ToolCallEvent {
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
}

export interface ToolCallResult {
  block?: boolean
  reason?: string
  terminate?: boolean
  input?: Record<string, unknown>
}

export interface ToolResultEvent {
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
  content: unknown[]
  details?: string
  isError: boolean
  usage?: unknown
}

export interface ToolResultResult {
  content?: unknown[]
  details?: string
  isError?: boolean
  usage?: unknown
}

export interface ToolExecutionStartEvent {
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
}

export interface ToolExecutionEndEvent {
  toolName: string
  toolCallId: string
  result: unknown
  duration: number
}

// 上下文事件
export interface ContextEvent {
  messages: unknown[]
}

export interface ContextResult {
  messages?: unknown[]
}

// 输入事件
export interface InputEvent {
  input: string
  isCommand: boolean
}

export interface InputResult {
  transform?: string
  handle?: boolean
  continue?: boolean
}

// ============================================================================
// 事件总线接口
// ============================================================================

/**
 * 事件总线 — 管理事件的注册和分发
 */
export interface EventBus {
  /** 注册事件处理器 */
  on<K extends string & keyof FrameworkEventMap>(
    eventName: K,
    handler: EventHandler,
    options?: EventHandlerOptions
  ): () => void

  /** 注册一次性事件处理器 */
  once<K extends string & keyof FrameworkEventMap>(
    eventName: K,
    handler: EventHandler
  ): () => void

  /** 注销事件处理器 */
  off<K extends string & keyof FrameworkEventMap>(
    eventName: K,
    handler: EventHandler
  ): void

  /** 分发事件 */
  emit<K extends string & keyof FrameworkEventMap>(
    eventName: K,
    payload: unknown
  ): Promise<unknown>

  /** 获取事件定义 */
  getDefinition<K extends string & keyof FrameworkEventMap>(
    eventName: K
  ): FrameworkEventMap[K] | undefined
}

/**
 * 事件处理器选项
 */
export interface EventHandlerOptions {
  /** 处理器优先级（数字越小越先执行） */
  priority?: number
  /** 处理器所属扩展 */
  extension?: string
  /** 是否只执行一次 */
  once?: boolean
}
