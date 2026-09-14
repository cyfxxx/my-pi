import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// LLM 缝隙接口
// ============================================================================

export interface LLMService {
  /** 创建聊天完成 */
  chat(request: LLMChatRequest): Promise<LLMChatResponse>
  /** 流式聊天完成 */
  chatStream(request: LLMChatRequest): AsyncIterable<LLMStreamChunk>
  /** 列出可用模型 */
  listModels(): Promise<LLMModel[]>
  /** 检查 provider 是否可用 */
  available(): Promise<boolean>
}

export interface LLMChatRequest {
  model: string
  messages: LLMMessage[]
  tools?: LLMTool[]
  temperature?: number
  maxTokens?: number
  system?: string
}

export interface LLMChatResponse {
  message: LLMMessage
  usage: LLMUsage
  finishReason: string
}

export interface LLMStreamChunk {
  type: 'text' | 'tool_call' | 'thinking' | 'done'
  content?: string
  toolCall?: LLMToolCall
  usage?: LLMUsage
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: LLMToolCall[]
}

export interface LLMTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LLMToolCall {
  id: string
  name: string
  arguments: string
}

export interface LLMUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface LLMModel {
  id: string
  name: string
  provider: string
  maxTokens: number
  supportsTools: boolean
  supportsThinking: boolean
}

export const LLM_SEAM_DEFINITION: ServiceDefinition<LLMService> = {
  name: 'llm',
  description: 'LLM API 调用能力',
  defaultProvider: 'google',
}

export type LLMProvider = ServiceProvider<LLMService>
