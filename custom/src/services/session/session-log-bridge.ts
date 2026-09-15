/**
 * services/session/session-log-bridge.ts - 会话日志桥接
 *
 * 桥接 SessionManager 和 SessionLog，解决断层问题
 */

/**
 * 会话条目
 */
export interface SessionEntry {
  type: string
  id?: string
  parentId?: string
  role?: string
  content?: string
  toolName?: string
  toolCallId?: string
  timestamp?: number
  usage?: {
    totalTokens?: number
  }
}

/**
 * 会话日志事件
 */
export interface SessionEvent {
  type: string
  timestamp: number
  [key: string]: unknown
}

/**
 * 会话日志接口
 */
export interface SessionLog {
  write(event: SessionEvent): void
}

/**
 * 会话管理器接口
 */
export interface SessionManagerInterface {
  on(event: string, listener: (...args: unknown[]) => void): void
}

/**
 * 将 SessionEntry 映射到 SessionEvent
 */
export function sessionEntryToLogEvent(entry: SessionEntry): SessionEvent | null {
  const timestamp = entry.timestamp ?? Date.now()
  
  switch (entry.type) {
    case 'message':
      if (entry.role === 'user') {
        return {
          type: 'user_message',
          timestamp,
          content: entry.content,
        }
      } else if (entry.role === 'assistant') {
        return {
          type: 'assistant_message',
          timestamp,
          content: entry.content,
        }
      }
      break
    
    case 'toolCall':
      return {
        type: 'tool_call',
        timestamp,
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
        input: entry.content,
      }
    
    case 'toolResult':
      return {
        type: 'tool_result',
        timestamp,
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
        output: entry.content,
      }
    
    case 'compaction':
      return {
        type: 'compaction',
        timestamp,
        content: entry.content,
      }
    
    case 'branch_summary':
      return {
        type: 'branch_summary',
        timestamp,
        content: entry.content,
      }
    
    case 'model_change':
      return {
        type: 'model_change',
        timestamp,
        content: entry.content,
      }
    
    case 'thinking_level_change':
      return {
        type: 'thinking_level_change',
        timestamp,
        content: entry.content,
      }
    
    default:
      return {
        type: entry.type,
        timestamp,
        content: entry.content,
      }
  }
  
  return null
}

/**
 * 桥接 SessionManager 和 SessionLog
 */
export function attachSessionLog(
  sm: SessionManagerInterface,
  log: SessionLog,
): void {
  sm.on('entry', (entry: unknown) => {
    const sessionEntry = entry as SessionEntry
    const event = sessionEntryToLogEvent(sessionEntry)
    if (event) {
      log.write(event)
    }
  })
}
