/**
 * 事件模式迁移适配器
 *
 * 将旧的 ExtensionAPI.on() 事件处理器适配到新的 5 模式事件系统
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { EventBus, EventHandler, FrameworkEventMap } from '../events/types.ts'

// ============================================================================
// 事件名称映射
// ============================================================================

/** 旧事件名 → 新事件名 + 调度模式 */
const EVENT_MAPPING: Record<string, { newName: string; mode: string }> = {
  // Session 事件
  session_start: { newName: 'session_start', mode: 'parallel' },
  session_shutdown: { newName: 'session_shutdown', mode: 'serial' },
  session_before_compact: { newName: 'session_before_compact', mode: 'waterfall' },
  session_compact: { newName: 'session_compact', mode: 'emit' },
  session_compact_failed: { newName: 'session_compact_failed', mode: 'emit' },

  // Agent 生命周期事件
  before_agent_start: { newName: 'before_agent_start', mode: 'serial' },
  agent_start: { newName: 'agent_start', mode: 'emit' },
  agent_end: { newName: 'agent_end', mode: 'emit' },
  agent_settled: { newName: 'agent_settled', mode: 'emit' },

  // Turn 事件
  turn_start: { newName: 'turn_start', mode: 'emit' },
  turn_end: { newName: 'turn_end', mode: 'emit' },

  // 消息事件
  message_start: { newName: 'message_start', mode: 'emit' },
  message_update: { newName: 'message_update', mode: 'emit' },
  message_end: { newName: 'message_end', mode: 'serial' },

  // 工具事件
  tool_call: { newName: 'tool_call', mode: 'waterfall' },
  tool_result: { newName: 'tool_result', mode: 'waterfall' },
  tool_execution_start: { newName: 'tool_execution_start', mode: 'emit' },
  tool_execution_end: { newName: 'tool_execution_end', mode: 'emit' },

  // 上下文事件
  context: { newName: 'context', mode: 'waterfall' },

  // 输入事件
  input: { newName: 'input', mode: 'bail' },
}

// ============================================================================
// 适配器函数
// ============================================================================

/**
 * 将旧的 pi.on() 事件处理器适配到新的 EventBus
 *
 * 使用方式：
 * ```typescript
 * const adapter = createEventAdapter(pi, eventBus)
 * adapter.migrateHandler('tool_call', oldHandler)
 * ```
 */
export function createEventAdapter(pi: ExtensionAPI, eventBus: EventBus) {
  return {
    /**
     * 迁移单个事件处理器
     */
    migrateHandler(
      oldEventName: string,
      handler: (...args: unknown[]) => unknown,
      options?: { priority?: number; extension?: string }
    ): () => void {
      const mapping = EVENT_MAPPING[oldEventName]
      if (!mapping) {
        console.warn(`[EventAdapter] 未知事件: ${oldEventName}`)
        return () => {}
      }

      // 包装处理器以适配新接口
      const wrappedHandler: EventHandler = (...args: unknown[]) => {
        // 保持与旧系统相同的调用约定
        return handler(...args)
      }

      return eventBus.on(mapping.newName as keyof FrameworkEventMap, wrappedHandler, {
        priority: options?.priority ?? 0,
        extension: options?.extension,
      })
    },

    /**
     * 批量迁移事件处理器
     */
    migrateHandlers(
      handlers: Array<{
        event: string
        handler: (...args: unknown[]) => unknown
        priority?: number
      }>,
      extension?: string
    ): () => void {
      const disposers = handlers.map(h =>
        this.migrateHandler(h.event, h.handler, {
          priority: h.priority,
          extension,
        })
      )

      return () => {
        for (const dispose of disposers) {
          dispose()
        }
      }
    },

    /**
     * 获取事件的调度模式
     */
    getDispatchMode(oldEventName: string): string | undefined {
      return EVENT_MAPPING[oldEventName]?.mode
    },

    /**
     * 获取所有支持的事件
     */
    getSupportedEvents(): string[] {
      return Object.keys(EVENT_MAPPING)
    },
  }
}

// ============================================================================
// 扩展 API 增强
// ============================================================================

/**
 * 增强 ExtensionAPI，添加 EventBus 支持
 */
export function enhanceExtensionAPI(
  pi: ExtensionAPI,
  eventBus: EventBus
): EnhancedExtensionAPI {
  const adapter = createEventAdapter(pi, eventBus)

  return {
    ...pi,
    /**
     * 使用新的事件系统注册处理器
     */
    onEvent(
      eventName: string,
      handler: EventHandler,
      options?: { priority?: number }
    ): () => void {
      return eventBus.on(eventName as keyof FrameworkEventMap, handler, options)
    },

    /**
     * 发射事件到新的事件系统
     */
    emitEvent(eventName: string, payload: unknown): Promise<unknown> {
      return eventBus.emit(eventName as keyof FrameworkEventMap, payload)
    },

    /**
     * 迁移旧事件处理器
     */
    migrateHandler(
      oldEventName: string,
      handler: (...args: unknown[]) => unknown,
      options?: { priority?: number }
    ): () => void {
      return adapter.migrateHandler(oldEventName, handler, options)
    },
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface EnhancedExtensionAPI extends ExtensionAPI {
  onEvent(
    eventName: string,
    handler: EventHandler,
    options?: { priority?: number }
  ): () => void

  emitEvent(eventName: string, payload: unknown): Promise<unknown>

  migrateHandler(
    oldEventName: string,
    handler: (...args: unknown[]) => unknown,
    options?: { priority?: number }
  ): () => void
}
