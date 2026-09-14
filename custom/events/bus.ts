/**
 * 事件总线实现
 *
 * 支持 5 种调度模式：emit, waterfall, parallel, serial, bail
 */

import type {
  DispatchMode,
  EventDefinition,
  EventHandler,
  EventHandlerOptions,
  EventBus,
  FrameworkEventMap,
  WaterfallHandler,
  BailHandler,
  SerialHandler,
} from './types.ts'

// ============================================================================
// 事件注册项
// ============================================================================

interface EventRegistration {
  handler: EventHandler
  options: EventHandlerOptions
  once: boolean
}

// ============================================================================
// EventBus 实现
// ============================================================================

export class DefaultEventBus implements EventBus {
  private handlers = new Map<string, EventRegistration[]>()
  private definitions = new Map<string, EventDefinition>()

  /** 注册事件定义 */
  define<TPayload, TResult>(definition: EventDefinition<TPayload, TResult>): void {
    this.definitions.set(definition.name, definition)
  }

  /** 注册事件处理器 */
  on<K extends string & keyof FrameworkEventMap>(
    eventName: K,
    handler: EventHandler,
    options: EventHandlerOptions = {}
  ): () => void {
    const registration: EventRegistration = {
      handler,
      options: { priority: 0, ...options },
      once: options.once ?? false,
    }

    const list = this.handlers.get(eventName) ?? []
    list.push(registration)
    // 按优先级排序
    list.sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))
    this.handlers.set(eventName, list)

    // 返回注销函数
    return () => this.off(eventName, handler)
  }

  /** 注册一次性事件处理器 */
  once<K extends string & keyof FrameworkEventMap>(
    eventName: K,
    handler: EventHandler
  ): () => void {
    return this.on(eventName, handler, { once: true })
  }

  /** 注销事件处理器 */
  off<K extends string & keyof FrameworkEventMap>(
    eventName: K,
    handler: EventHandler
  ): void {
    const list = this.handlers.get(eventName)
    if (!list) return

    const index = list.findIndex(r => r.handler === handler)
    if (index >= 0) {
      list.splice(index, 1)
    }
  }

  /** 分发事件 */
  async emit<K extends string & keyof FrameworkEventMap>(
    eventName: K,
    payload: unknown
  ): Promise<unknown> {
    const definition = this.definitions.get(eventName)
    if (!definition) {
      console.warn(`[EventBus] 未定义的事件: ${eventName}`)
      return undefined
    }

    const list = this.handlers.get(eventName) ?? []
    if (list.length === 0) return undefined

    const result = await this.dispatch(definition.mode, list, payload)

    // 清理一次性处理器
    for (const reg of list) {
      if (reg.once) {
        this.off(eventName, reg.handler)
      }
    }

    return result
  }

  /** 获取事件定义 */
  getDefinition<K extends string & keyof FrameworkEventMap>(
    eventName: K
  ): FrameworkEventMap[K] | undefined {
    return this.definitions.get(eventName) as FrameworkEventMap[K] | undefined
  }

  // ============================================================================
  // 调度实现
  // ============================================================================

  private async dispatch(
    mode: DispatchMode,
    registrations: EventRegistration[],
    payload: unknown
  ): Promise<unknown> {
    switch (mode) {
      case 'emit':
        return this.dispatchEmit(registrations, payload)
      case 'waterfall':
        return this.dispatchWaterfall(registrations, payload)
      case 'parallel':
        return this.dispatchParallel(registrations, payload)
      case 'serial':
        return this.dispatchSerial(registrations, payload)
      case 'bail':
        return this.dispatchBail(registrations, payload)
      default:
        console.warn(`[EventBus] 未知的调度模式: ${mode}`)
        return undefined
    }
  }

  /** emit: 通知型，无返回值 */
  private async dispatchEmit(
    registrations: EventRegistration[],
    payload: unknown
  ): Promise<void> {
    for (const reg of registrations) {
      try {
        await (reg.handler as (p: unknown) => void | Promise<void>)(payload)
      } catch (error) {
        console.error(`[EventBus] emit handler error:`, error)
      }
    }
  }

  /** waterfall: 中间件链 */
  private async dispatchWaterfall(
    registrations: EventRegistration[],
    payload: unknown
  ): Promise<unknown> {
    let result: unknown = payload

    const next = (value: unknown): unknown => {
      result = value
      return value
    }

    for (const reg of registrations) {
      try {
        const handler = reg.handler as WaterfallHandler<unknown, unknown>
        result = await handler(result, next)
      } catch (error) {
        console.error(`[EventBus] waterfall handler error:`, error)
      }
    }

    return result
  }

  /** parallel: 并发执行 */
  private async dispatchParallel(
    registrations: EventRegistration[],
    payload: unknown
  ): Promise<void> {
    await Promise.all(
      registrations.map(async (reg) => {
        try {
          await (reg.handler as (p: unknown) => void | Promise<void>)(payload)
        } catch (error) {
          console.error(`[EventBus] parallel handler error:`, error)
        }
      })
    )
  }

  /** serial: 顺序执行，有返回值 */
  private async dispatchSerial(
    registrations: EventRegistration[],
    payload: unknown
  ): Promise<unknown> {
    let result: unknown = undefined

    for (const reg of registrations) {
      try {
        const handler = reg.handler as SerialHandler<unknown, unknown>
        result = await handler(payload)
      } catch (error) {
        console.error(`[EventBus] serial handler error:`, error)
      }
    }

    return result
  }

  /** bail: 顺序执行直到第一个返回值 */
  private async dispatchBail(
    registrations: EventRegistration[],
    payload: unknown
  ): Promise<unknown> {
    for (const reg of registrations) {
      try {
        const handler = reg.handler as BailHandler<unknown, unknown>
        const result = await handler(payload)
        if (result !== undefined) {
          return result
        }
      } catch (error) {
        console.error(`[EventBus] bail handler error:`, error)
      }
    }

    return undefined
  }
}

// ============================================================================
// 全局单例
// ============================================================================

let globalEventBus: EventBus | null = null

/** 获取全局事件总线 */
export function getEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = new DefaultEventBus()
  }
  return globalEventBus
}

/** 重置全局事件总线（测试用） */
export function resetEventBus(): void {
  globalEventBus = null
}
