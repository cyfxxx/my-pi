# context/budget — 上下文预算与收敛

`context` 的预算子包：token 记账、剪枝、压缩、工具分层、thinking 档位、任务记账与门控。
全部为纯逻辑（零 Pi 依赖），由 `../index.ts` 的钩子驱动。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `budget.ts` | 预算总量/上下文窗口/工具用量/输出预算/缓存统计 | `setTotalBudget`、`setContextWindow`、`setCompactThreshold`、`recordToolUsage`、`getBudgetReport`、`getTokenPressureTag`、`estimateTokens`、`truncateByTokens`、`recordOutput`、`pruneToolOutput`、`recordCacheUsage`、`getCacheStats` |
| `prune.ts` | 消息级剪枝（thinking / tool_result）、擦除标记与 ref、清理 | `pruneMessageText`、`pruneToolResults`、`pruneThinkingBudget`、`sweepPruneRefs`、`isPrunedMessage` |
| `auto-compact.ts` | 压缩阈值决策与自动继续门 | `computeCompactThreshold`、`makeCompactDecider`、`makeAutoContinueGate` |
| `compression.ts` | 压缩前快照、JSON 收缩、快照清理 | `snapshotBeforeCompact`、`compactJson`、`pruneSnapshots` |
| `output-archive.ts` | 大工具输出落盘 + 占位 stub | `archiveOutput`、`archivedStub`、`archiveDir` |
| `prune-dump.ts` | 擦除原文落盘 ref（可回溯） | `buildPruneDumpRef`、`pruneRefsDir` |
| `tool-groups.ts` | 工具分组与休眠组定义 | `CORE_TOOLS`、`SLEEPING_GROUPS`、`computeActiveTools`、`buildSleepingSummary` |
| `tool-layering.ts` | 按需加载（休眠组启用） | `applyToolLayering`、`dormantToolsActive`、`enableGroup`、`buildToolsReport` |
| `thinking-level.ts` | thinking 档位自适应切档 + 审计 | `inferTaskType`、`tickThinkingLevel`、`proposeThinkingLevel`、`recordLevelChange`、`loadLevelChanges` |
| `task-record.ts` | 每轮任务结构记录（JSONL） | `recordTaskRecord`、`loadTaskRecords` |
| `task-gate.ts` | 压缩门控（背景任务/环境阈值/上下文回退） | `resolveContext`、`hasBackgroundTask`、`readEnvRatio` |
| `tool-health.ts` | 连续失败熔断 + 错误输出脱水 | `updateFailStreak`、`dehydrateErrorOutput`、`rebuildTextContent` |
| `token-speed.ts` | 输出速度（tokens/s）跟踪与格式化 | `createSpeedTracker`、`estimateTokensFromChars`、`formatSpeed`、`formatSpeedCompact` |

## 缓存纪律

注入相关文本保持稳定前缀，不注入精确 token 数值；压缩/压力提示为静态文本。

## 相关

- 上层：[../README.md](../README.md)
