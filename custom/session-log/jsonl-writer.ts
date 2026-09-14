import { appendFile, readFile, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type {
  SessionEvent,
  SessionEventType,
  SessionLogWriter,
  SessionLogReader,
  SessionLog,
  SessionLogReadOptions,
  SessionProjection,
  DeriveMessagesOptions,
  DerivedMessage,
} from './types.ts'

// ============================================================================
// JSONL Session Log 实现
// ============================================================================

export class JSONLSessionLog implements SessionLog {
  private filePath: string
  private events: SessionEvent[] = []
  private projections = new Map<string, SessionProjection>()
  private version = 1
  private dirty = false

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /** 初始化：加载现有日志 */
  async init(): Promise<void> {
    try {
      await access(this.filePath)
      const content = await readFile(this.filePath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as SessionEvent
          this.events.push(event)
          this.notifyProjections(event)
        } catch {
          // 跳过无效行
        }
      }
    } catch {
      // 文件不存在，从空日志开始
    }
  }

  // ============================================================================
  // SessionLogWriter
  // ============================================================================

  async append(event: SessionEvent): Promise<void> {
    this.events.push(event)
    this.dirty = true

    // 追加到文件
    const dir = dirname(this.filePath)
    await mkdir(dir, { recursive: true })

    const line = JSON.stringify(event) + '\n'
    await appendFile(this.filePath, line, 'utf-8')

    // 通知投影器
    this.notifyProjections(event)
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    // JSONL 是 append-only，已经在 append 时写入
    this.dirty = false
  }

  async close(): Promise<void> {
    await this.flush()
    this.events = []
  }

  // ============================================================================
  // SessionLogReader
  // ============================================================================

  async read(options?: SessionLogReadOptions): Promise<SessionEvent[]> {
    let result = [...this.events]

    // 过滤类型
    if (options?.types && options.types.length > 0) {
      const types = new Set(options.types)
      result = result.filter(e => types.has(e.type))
    }

    // 过滤模型可见
    if (options?.modelVisibleOnly) {
      result = result.filter(e => e.modelVisible)
    }

    // 时间范围
    if (options?.from !== undefined) {
      result = result.filter(e => e.timestamp >= options.from!)
    }
    if (options?.to !== undefined) {
      result = result.filter(e => e.timestamp <= options.to!)
    }

    // 限制数量
    if (options?.limit !== undefined) {
      result = result.slice(-options.limit)
    }

    return result
  }

  async get(id: string): Promise<SessionEvent | undefined> {
    return this.events.find(e => e.id === id)
  }

  async getLatest(type?: SessionEventType): Promise<SessionEvent | undefined> {
    if (type) {
      for (let i = this.events.length - 1; i >= 0; i--) {
        if (this.events[i].type === type) {
          return this.events[i]
        }
      }
      return undefined
    }
    return this.events[this.events.length - 1]
  }

  // ============================================================================
  // SessionLog
  // ============================================================================

  getVersion(): number {
    return this.version
  }

  count(): number {
    return this.events.length
  }

  registerProjection(name: string, projection: SessionProjection): void {
    this.projections.set(name, projection)
    // 用现有事件初始化投影
    projection.init(this.events)
  }

  getProjection<T>(name: string): T | undefined {
    return this.projections.get(name)?.getState() as T | undefined
  }

  // ============================================================================
  // 推导消息
  // ============================================================================

  async deriveMessages(options?: DeriveMessagesOptions): Promise<DerivedMessage[]> {
    const messages: DerivedMessage[] = []
    let tokenCount = 0
    const maxTokens = options?.maxTokens ?? Infinity
    const maxMessages = options?.maxMessages ?? Infinity

    for (const event of this.events) {
      if (messages.length >= maxMessages) break
      if (tokenCount >= maxTokens) break

      const derived = this.eventToMessage(event)
      if (!derived) continue

      // 跳过系统消息（如果不需要）
      if (derived.role === 'system' && options?.includeSystem === false) continue

      messages.push(derived)
      tokenCount += this.estimateTokens(derived.content)
    }

    return messages
  }

  // ============================================================================
  // 内部方法
  // ============================================================================

  private eventToMessage(event: SessionEvent): DerivedMessage | null {
    switch (event.type) {
      case 'user_message':
        return { role: 'user', content: (event as { content: string }).content }
      case 'assistant_message': {
        const e = event as { content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }
        return {
          role: 'assistant',
          content: e.content,
          toolCalls: e.toolCalls,
        }
      }
      case 'tool_call':
        return null // 工具调用通过 tool_result 体现
      case 'tool_result': {
        const e = event as { toolCallId: string; content: unknown[] }
        const text = e.content
          .filter((c): c is { type: string; text: string } => typeof c === 'object' && c !== null && 'text' in c)
          .map(c => c.text)
          .join('\n')
        return {
          role: 'tool',
          content: text,
          toolCallId: e.toolCallId,
        }
      }
      case 'system_prompt':
        return { role: 'system', content: (event as { prompt: string }).prompt }
      case 'memory_inject':
        return { role: 'user', content: `[记忆注入]\n${(event as { content: string }).content}` }
      case 'plan_context':
        return { role: 'user', content: `[计划上下文]\n${(event as { content: string }).content}` }
      case 'compaction':
        return { role: 'system', content: `[上下文压缩]\n${(event as { summary: string }).summary}` }
      default:
        return null
    }
  }

  private estimateTokens(text: string): number {
    // 简单估算：1 token ≈ 4 字符
    return Math.ceil(text.length / 4)
  }

  private notifyProjections(event: SessionEvent): void {
    for (const projection of this.projections.values()) {
      try {
        projection.onEvent(event)
      } catch (error) {
        console.error('[SessionLog] 投影器错误:', error)
      }
    }
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

export async function createSessionLog(filePath: string): Promise<SessionLog> {
  const log = new JSONLSessionLog(filePath)
  await log.init()
  return log
}
