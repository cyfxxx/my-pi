/**
 * services/session/session-stats.ts - 会话统计服务
 *
 * 从 agent-session.ts 提取的纯计算逻辑
 */

/**
 * 会话统计
 */
export interface SessionStats {
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalTokens: number
}

/**
 * 会话条目
 */
export interface SessionEntry {
  type: string
  role?: string
  content?: string
  toolName?: string
  usage?: {
    totalTokens?: number
  }
}

/**
 * 计算会话统计
 */
export function computeSessionStats(entries: SessionEntry[]): SessionStats {
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  let toolResults = 0
  let totalTokens = 0

  for (const entry of entries) {
    switch (entry.type) {
      case 'message':
        if (entry.role === 'user') {
          userMessages++
        } else if (entry.role === 'assistant') {
          assistantMessages++
        }
        break
      case 'toolCall':
        toolCalls++
        break
      case 'toolResult':
        toolResults++
        break
    }

    if (entry.usage?.totalTokens) {
      totalTokens += entry.usage.totalTokens
    }
  }

  return {
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalTokens,
  }
}
