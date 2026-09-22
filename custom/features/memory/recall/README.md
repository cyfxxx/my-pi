# memory/recall — 检索与注入

记忆检索（BM25 + 质量分 + MMR 去重 + 会话轮转）与系统提示注入（预算内、去重、可过滤）。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `retrieval.ts` | 检索打分与重排、检索台账 | `buildDoc`、`bm25Score`、`qualityScore`、`visibleAt`、`mmrDiversify`、`roundRobinBySession`、`searchEntriesWithScores`、`searchEntries`、`findSimilar`、`logSearchTrace` |
| `inject.ts` | 注入块构建、预算、已注入过滤 | `buildInjectionBlock`、`isInjectionBlock`、`filterInjectedMessages`、`getBudget`、`INJECT_TAG`、`truncateContent`/`truncateEntrySummary` |

## 约定

- 注入有 token 预算（`DEFAULT_BUDGET_TOKENS`，可用 `PI_MEMORY_INJECT_TOKENS` 覆盖），内容/摘要各有上限。
- 注入块带 `INJECT_TAG`，下一轮据此过滤，避免重复注入。
- 依赖 `context/logic` 的 `estimateTokens`/`truncateByTokens`（跨功能只走 logic barrel）。

## 数据落点

`portable/memory/memory-search.jsonl`（`PI_MEMORY_TRACE_FILE` 覆盖，轮转 4MB）。

## 相关

- 上层：[../README.md](../README.md)
- 存储：[../store/README.md](../store/README.md)
