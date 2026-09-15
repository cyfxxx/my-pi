/**
 * services/session/context-usage.ts - 上下文用量服务
 *
 * 从 agent-session.ts 提取的纯计算逻辑
 */

/**
 * 上下文用量
 */
export interface ContextUsage {
  tokens: number
  contextWindow: number
  percent: number
}

/**
 * 会话条目
 */
export interface SessionEntry {
  type: string
  content?: string
  firstKeptEntryId?: string
}

/**
 * Agent 消息
 */
export interface AgentMessage {
  role: string
  content: string
}

/**
 * 模型信息
 */
export interface ModelInfo {
  contextWindow: number
}

/**
 * 估算 token 数量
 */
function estimateTokens(text: string): number {
  // 简单估算：1 个 token ≈ 4 个字符
  return Math.ceil(text.length / 4)
}

/**
 * 计算上下文用量
 */
export function computeContextUsage(
  messages: AgentMessage[],
  model: ModelInfo | undefined,
  branchEntries: SessionEntry[],
): ContextUsage | undefined {
  if (!model) {
    return undefined
  }

  // 计算消息的 token 数量
  let tokens = 0
  for (const message of messages) {
    tokens += estimateTokens(message.content)
  }

  // 计算 compaction boundary
  const compactionEntry = branchEntries.find(
    (entry) => entry.type === 'compaction' && entry.firstKeptEntryId
  )
  if (compactionEntry) {
    // 如果有 compaction，只计算保留的消息
    tokens = Math.min(tokens, model.contextWindow * 0.8)
  }

  const percent = Math.round((tokens / model.contextWindow) * 100)

  return {
    tokens,
    contextWindow: model.contextWindow,
    percent,
  }
}
