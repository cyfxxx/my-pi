# context/budget/warm-prefix — 暖前缀重放

迁移自 pi-tools `agent/extensions/pi-context/warm-prefix-replay.ts` 的纯逻辑部分。

## 职责

处理特定模型（deepseek/qwen/kimi/moonshot/glm/zhipu/doubao/gemini/gpt/o1）的暖前缀重放逻辑：

1. **状态管理**：追踪最后模型、请求 payload、压缩暖前缀允许状态
2. **模型匹配**：识别需要重放前缀的模型
3. **摘要检测**：识别 `<conversation>` 标签的摘要消息
4. **前缀提取**：从摘要消息中提取 tail 内容
5. **重放判定**：判断是否需要重放前缀，并构建完整请求
6. **暖前缀提供**：为压缩操作提供暖前缀数据

## 纯逻辑 API

### 类型

```typescript
interface WarmPrefixState {
  lastModelKey: string;
  lastRequestPayload: { messages: unknown[]; tools?: unknown } | null;
  compactWarmAllowed: boolean;
}
```

### 工厂函数

- `createWarmPrefixState()` - 创建初始状态

### 检测函数

- `needsWarmPrefix(modelKey: string): boolean` - 检查模型是否需要重放前缀
- `isSummarizationMessage(message: { role?: string; content?: unknown }): boolean` - 检查是否为摘要消息
- `canReplayWarmPrefix(state, modelKey, messages): boolean` - 检查是否可以重放前缀
- `canProvideWarmPrefix(state, modelKey): boolean` - 检查是否可以提供暖前缀数据

### 提取函数

- `extractMessageText(content: unknown): string` - 从消息内容中提取文本
- `extractTailFromSummarization(content: string): string | null` - 从摘要中提取 tail

### 构建函数

- `buildReplayedPayload(state, messages, payload): Record<string, unknown> | null` - 构建重放后的完整请求
- `buildWarmPrefixData(state): { systemPrompt: string; tools: unknown; messages: unknown[] } | null` - 构建暖前缀数据

### 状态更新函数

- `saveMainRequestPayload(state, modelKey, messages, tools?)` - 保存主请求 payload
- `updateCompactWarmAllowed(state, reason, contextWindow, tokensBefore)` - 更新压缩暖前缀允许状态

### 常量

- `AUTO_PREFIX_CACHE_RE` / `AUTO_PREFIX_CACHE_REGEX` - 需要重放前缀的模型正则
- `CONV_TAG_RE` / `CONV_TAG_REGEX` - 摘要标签正则
- `MIN_TAIL_LENGTH` - 最小 tail 长度阈值

## 使用方式

### 在适配器层接线

```typescript
// 在 custom/adapters/ 创建 warm-prefix-adapter.ts

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  createWarmPrefixState,
  needsWarmPrefix,
  saveMainRequestPayload,
  buildReplayedPayload,
  updateCompactWarmAllowed,
  buildWarmPrefixData,
  canProvideWarmPrefix,
} from '../features/context/budget/warm-prefix';

export function registerWarmPrefix(pi: ExtensionAPI): void {
  const state = createWarmPrefixState();

  // 1. 在 before_provider_request 钩子中保存主请求并重放前缀
  pi.on('before_provider_request', async (event) => {
    const payload = event.payload as { messages?: unknown[]; tools?: unknown };
    const modelKey = event.model?.id ?? '';
    const msgs = payload?.messages;

    if (!Array.isArray(msgs) || msgs.length === 0) return undefined;

    // 保存主请求（非摘要消息时）
    const last = msgs[msgs.length - 1] as { role?: string; content?: unknown };
    const isSummary = last.role === 'user' && 
      typeof last.content === 'string' && 
      /<conversation>/.test(last.content);
    
    if (!isSummary) {
      saveMainRequestPayload(state, modelKey, msgs, payload.tools);
      return undefined;
    }

    // 重放前缀
    const replayed = buildReplayedPayload(state, msgs, payload);
    return replayed ?? undefined;
  });

  // 2. 在 session_before_compact 钩子中更新压缩暖前缀允许状态
  pi.on('session_before_compact', (event, ctx) => {
    const w = ctx.model?.contextWindow ?? 0;
    updateCompactWarmAllowed(
      state,
      event.reason,
      w,
      event.preparation.tokensBefore,
    );
  });

  // 3. 注册暖前缀提供器（如 Pi 支持）
  (async () => {
    try {
      const piAgent = await import('@earendil-works/pi-coding-agent');
      const setCompactionWarmPrefixProvider = (piAgent as any).setCompactionWarmPrefixProvider;
      if (typeof setCompactionWarmPrefixProvider === 'function') {
        setCompactionWarmPrefixProvider(() => {
          if (!canProvideWarmPrefix(state, state.lastModelKey)) return null;
          return buildWarmPrefixData(state);
        });
      }
    } catch {
      // 补丁未应用时静默降级
    }
  })();
}
```

### 在 bootstrap 中注册

```typescript
// 在 custom/bootstrap.ts 中
import { registerWarmPrefix } from './adapters/warm-prefix-adapter';

registerWarmPrefix(pi);
```

## 缓存纪律

- 所有正则表达式为常量，保证稳定性
- 不注入时间戳或精确数值
- 状态管理通过明确的接口进行

## 相关

- 上层：[../README.md](../README.md)
- 预算模块：[budget.ts](./budget.ts)
