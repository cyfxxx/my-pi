/**
 * 事件系统
 */

// 类型定义
export type {
  DispatchMode,
  EventDefinition,
  EventHandler,
  EventHandlerOptions,
  EventBus,
  FrameworkEventMap,
  EmitHandler,
  WaterfallHandler,
  ParallelHandler,
  SerialHandler,
  BailHandler,
  SessionStartEvent,
  SessionShutdownEvent,
  SessionBeforeCompactEvent,
  CompactResult,
  SessionCompactEvent,
  SessionCompactFailedEvent,
  SessionBeforeSwitchEvent,
  SwitchResult,
  SessionBeforeForkEvent,
  ForkResult,
  BeforeAgentStartEvent,
  BeforeAgentStartResult,
  AgentStartEvent,
  AgentEndEvent,
  AgentSettledEvent,
  TurnStartEvent,
  TurnEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  MessageEndEvent,
  MessageEndResult,
  ToolCallEvent,
  ToolCallResult,
  ToolResultEvent,
  ToolResultResult,
  ToolExecutionStartEvent,
  ToolExecutionEndEvent,
  ContextEvent,
  ContextResult,
  InputEvent,
  InputResult,
} from './types.ts'

// 实现
export { DefaultEventBus, getEventBus, resetEventBus } from './bus.ts'

// 适配器
export { createEventAdapter, enhanceExtensionAPI } from './adapter.ts'
export type { EnhancedExtensionAPI } from './adapter.ts'
