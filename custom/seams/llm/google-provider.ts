import type { LLMProvider, LLMService, LLMChatRequest, LLMChatResponse, LLMStreamChunk, LLMModel } from './types.ts'

/** Google LLM Provider（桥接 packages/ai） */
export const googleLLMProvider: LLMProvider = {
  name: 'google',
  seam: 'llm',
  description: 'Google Gemini API（桥接 packages/ai）',
  impl: {
    async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
      // 使用环境变量中的 API key
      const apiKey = process.env.GOOGLE_API_KEY
      if (!apiKey) {
        throw new Error('GOOGLE_API_KEY 未设置')
      }

      // 简单的 HTTP 调用实现
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent?key=${apiKey}`

      const messages = request.messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: messages,
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
          },
        }),
      })

      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

      return {
        message: {
          role: 'assistant',
          content: text,
        },
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
        },
        finishReason: 'stop',
      }
    },

    async *chatStream(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
      // 简化的流式实现（非真正流式）
      const response = await this.chat(request)
      yield { type: 'text', content: response.message.content }
      yield { type: 'done' }
    },

    async listModels(): Promise<LLMModel[]> {
      return [
        {
          id: 'gemini-2.0-flash',
          name: 'Gemini 2.0 Flash',
          provider: 'google',
          maxTokens: 8192,
          supportsTools: true,
          supportsThinking: true,
        },
        {
          id: 'gemini-2.0-pro',
          name: 'Gemini 2.0 Pro',
          provider: 'google',
          maxTokens: 32768,
          supportsTools: true,
          supportsThinking: true,
        },
      ]
    },

    async available(): Promise<boolean> {
      return !!process.env.GOOGLE_API_KEY
    },
  },
}
