import type { SessionTitleProvider, SessionTitleService, SessionTitleMessage } from './types.ts'

/** LLM 会话标题 Provider */
export const llmSessionTitleProvider: SessionTitleProvider = {
  name: 'llm',
  seam: 'session-title',
  description: 'LLM 生成会话标题',
  impl: {
    async generate(messages: SessionTitleMessage[]): Promise<string> {
      // 取前几条消息生成标题
      const preview = messages
        .slice(0, 5)
        .map(m => `${m.role}: ${m.content.slice(0, 100)}`)
        .join('\n')

      // 简单的标题生成逻辑（不依赖 LLM）
      // 实际实现可以调用 LLM API
      const firstUserMsg = messages.find(m => m.role === 'user')
      if (firstUserMsg) {
        const content = firstUserMsg.content.slice(0, 50)
        return content.length < firstUserMsg.content.length ? `${content}...` : content
      }

      return `Session ${new Date().toISOString().slice(0, 10)}`
    },

    async available(): Promise<boolean> {
      return true // 总是可用（使用本地逻辑）
    },
  },
}
