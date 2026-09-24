/**
 * Warm Prefix Replay — 暖前缀重放纯逻辑
 *
 * 迁移自 pi-tools agent/extensions/pi-context/warm-prefix-replay.ts
 *
 * 核心职责：
 * - 状态管理：追踪最后模型、请求 payload、压缩暖前缀允许状态
 * - 模型匹配：识别需要重放前缀的模型（deepseek/qwen/kimi/moonshot/glm/zhipu/doubao/gemini/gpt/o1）
 * - 摘要检测：识别 <conversation> 标签的摘要消息
 * - 前缀提取：从摘要消息中提取 tail 内容
 * - 重放判定：判断是否需要重放前缀，并构建完整请求
 * - 暖前缀提供：为压缩操作提供暖前缀数据
 *
 * 纯逻辑，零 Pi 依赖。
 */

// ── 类型定义 ──

export interface WarmPrefixState {
  lastModelKey: string;
  lastRequestPayload: { messages: unknown[]; tools?: unknown } | null;
  compactWarmAllowed: boolean;
}

// ── 常量 ──

/** 需要重放前缀的模型关键字（大小写不敏感） */
export const AUTO_PREFIX_CACHE_RE = /deepseek|qwen|kimi|moonshot|glm|zhipu|doubao|gemini|gpt-|o[134]-/i;

/** 摘要消息标签 */
export const CONV_TAG_RE = /<conversation>/;

/** 暖前缀重放的最小 tail 长度阈值 */
export const MIN_TAIL_LENGTH = 1;

// ── 状态工厂 ──

/** 创建暖前缀状态 */
export function createWarmPrefixState(): WarmPrefixState {
  return {
    lastModelKey: '',
    lastRequestPayload: null,
    compactWarmAllowed: false,
  };
}

// ── 模型匹配 ──

/** 检查模型是否需要重放前缀 */
export function needsWarmPrefix(modelKey: string): boolean {
  return AUTO_PREFIX_CACHE_RE.test(modelKey);
}

// ── 摘要检测 ──

/** 检查消息是否为摘要消息（包含 <conversation> 标签） */
export function isSummarizationMessage(message: { role?: string; content?: unknown }): boolean {
  if (message.role !== 'user') return false;
  
  const content = message.content;
  if (typeof content !== 'string') return false;
  
  return CONV_TAG_RE.test(content);
}

// ── 内容提取 ──

/** 从消息内容中提取文本 */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type?: string; text?: string } => 
        b != null && typeof b === 'object'
      )
      .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
      .join('\n');
  }
  
  return '';
}

/** 从摘要消息中提取 tail 内容（<conversation>...</conversation> 之后的部分） */
export function extractTailFromSummarization(content: string): string | null {
  const tail = content.replace(/^<conversation>\n[\s\S]*?\n<\/conversation>\n\n/, '');
  
  // 如果替换失败（没有变化）或者 tail 为空，返回 null
  if (tail === content || !tail.trim()) {
    return null;
  }
  
  return tail;
}

// ── 重放判定 ──

/** 检查是否可以重放前缀 */
export function canReplayWarmPrefix(
  state: WarmPrefixState,
  modelKey: string,
  messages: readonly unknown[],
): boolean {
  // 1. 模型不需要重放前缀
  if (!needsWarmPrefix(modelKey)) return false;
  
  // 2. 没有保存的主请求 payload
  if (!state.lastRequestPayload || state.lastRequestPayload.messages.length === 0) {
    return false;
  }
  
  // 3. 消息列表为空
  if (!Array.isArray(messages) || messages.length === 0) return false;
  
  // 4. 最后一条消息不是摘要消息
  const lastMessage = messages[messages.length - 1] as { role?: string; content?: unknown };
  if (!isSummarizationMessage(lastMessage)) return false;
  
  return true;
}

// ── 重放构建 ──

/** 构建重放后的完整请求 payload */
export function buildReplayedPayload(
  state: WarmPrefixState,
  messages: readonly unknown[],
  payload: { messages?: unknown[]; tools?: unknown },
): Record<string, unknown> | null {
  if (!canReplayWarmPrefix(state, state.lastModelKey, messages)) {
    return null;
  }
  
  // 安全访问 lastRequestPayload
  if (!state.lastRequestPayload) {
    return null;
  }
  
  const lastMessage = messages[messages.length - 1] as { role?: string; content?: unknown };
  const content = extractMessageText(lastMessage.content);
  const tail = extractTailFromSummarization(content);
  
  if (!tail) return null;
  
  const next = {
    ...payload,
    messages: [
      ...state.lastRequestPayload.messages,
      { role: 'user' as const, content: tail },
    ],
  };
  
  // 保留 tools
  if (state.lastRequestPayload.tools !== undefined) {
    next.tools = state.lastRequestPayload.tools;
  }
  
  return next;
}

// ── 暖前缀数据提供 ──

/** 检查是否可以提供暖前缀数据 */
export function canProvideWarmPrefix(state: WarmPrefixState, modelKey: string): boolean {
  if (!state.compactWarmAllowed) return false;
  if (!state.lastRequestPayload || state.lastRequestPayload.messages.length === 0) return false;
  if (!needsWarmPrefix(modelKey)) return false;
  
  // 暖前缀需要 tools 数据
  const tools = state.lastRequestPayload.tools;
  if (!Array.isArray(tools) || tools.length === 0) return false;
  
  return true;
}

/** 构建暖前缀数据 */
export function buildWarmPrefixData(state: WarmPrefixState): {
  systemPrompt: string;
  tools: unknown;
  messages: unknown[];
} | null {
  if (!canProvideWarmPrefix(state, state.lastModelKey)) {
    return null;
  }
  
  // 安全访问 lastRequestPayload
  if (!state.lastRequestPayload) {
    return null;
  }
  
  return {
    systemPrompt: '',
    tools: state.lastRequestPayload.tools,
    messages: state.lastRequestPayload.messages,
  };
}

// ── 状态更新 ──

/** 保存主请求 payload */
export function saveMainRequestPayload(
  state: WarmPrefixState,
  modelKey: string,
  messages: unknown[],
  tools?: unknown,
): void {
  if (!needsWarmPrefix(modelKey)) return;
  
  state.lastModelKey = modelKey;
  state.lastRequestPayload = {
    messages: structuredClone(messages),
    tools: tools !== undefined ? structuredClone(tools) : undefined,
  };
}

/** 更新压缩暖前缀允许状态 */
export function updateCompactWarmAllowed(
  state: WarmPrefixState,
  reason: string,
  contextWindow: number,
  tokensBefore: number,
): void {
  // 非 overflow 原因且 token 占用未达到 90% 时允许
  state.compactWarmAllowed = 
    reason !== 'overflow' && 
    !(contextWindow > 0 && tokensBefore > contextWindow * 0.9);
}

// ── 导出 ──

export {
  AUTO_PREFIX_CACHE_RE as AUTO_PREFIX_CACHE_REGEX,
  CONV_TAG_RE as CONV_TAG_REGEX,
};
