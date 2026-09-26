# context/budget — 预算、擦除与压缩子包

`context` 功能的确定性（零 LLM）内核：token 预算与压力分档、工具输出擦除/归档/截断、thinking 擦除、
压缩阈值与压缩前快照、任务门（何时允许压缩）、运行时前缀指纹，以及暖前缀重放（当前为死代码，见文末）。

所有模块均为**纯逻辑**（零 Pi 依赖），由 `context/index.ts` 经 `custom/adapters/` 接线；
`../logic.ts` 只做 barrel 转发。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `budget.ts` | 全局预算/压力报告、输出预算与截断 | `setTotalBudget`/`setContextWindow`/`setCompactThreshold`/`getBudgetReport`/`getTokenPressureTag`/`estimateTokens`、`truncateByTokens`/`truncateHeadTail`/`tailByTokens`、`recordOutput`/`pruneToolOutput`/`getOutputReport` |
| `prune.ts` | 消息级擦除（工具输出 + thinking） | `PRUNE_PROTECT_TOKENS`(60K)/`PRUNE_MINIMUM_TOKENS`(30K)/`DEFAULT_KEEP_THINKING_TOKENS`(64K)、`pruneToolResults`、`pruneThinkingBudget`、`sweepPruneRefs` |
| `prune-dump.ts` | 擦除转储引用目录（14 天清理） | `pruneRefsDir`、`PRUNE_REFS_RETENTION_DAYS`、`buildPruneDumpRef` |
| `output-archive.ts` | 大工具输出落盘 + 占位符 + 清理 | `ARCHIVE_RETENTION_DAYS`(14)/`ARCHIVE_MAX_TOTAL_BYTES`(200MB)、`archiveOutput`、`archivedStub`、`sweepArchive` |
| `compression.ts` | 压缩前快照（`checkpoints/compact/`，旧版根目录兼容清理）与 JSON 缩减 | `snapshotBeforeCompact`、`pruneSnapshots`、`shrinkHalf`、`compactJson`、`snapshotDir`、`legacySnapshotDir` |
| `task-gate.ts` | 阈值/门限解析（含 env 覆盖）与后台任务判定 | `ABSOLUTE_TOKENS`/`RESTART_TOKENS`/`COMPACT_COOLDOWN_MS`/`IDLE_MS`/`TASK_GATE`、`resolveContext`、`hasBackgroundTask` |
| `auto-compact.ts` | 压缩判定与阈值计算 | `computeCompactThreshold`、`makeCompactDecider`、`makeAutoContinueGate` |
| `prefix-fingerprint.ts` | 逐请求前缀指纹（system/tools/消息头/总量分段哈希） | `fingerprintRequest`、`formatFingerprint`、`systemTextOf`、`FINGERPRINT_HEAD_MESSAGES` |
| `thinking-level.ts` | 思考档位自动升降 | `tickThinkingLevel`、`proposeThinkingLevel`、`inferTaskType` |
| `tool-groups.ts` / `tool-layering.ts` | 工具分层与休眠组 | `SLEEPING_GROUPS`、`buildSleepingSummary`、`applyToolLayering`、`enableGroup` |
| `tool-health.ts` | 错误输出精简与失败熔断提示 | `dehydrateErrorOutput`、`updateFailStreak`、`FAIL_STREAK_LIMIT` |
| `warm-prefix.ts` | 压缩摘要的暖前缀重放（**当前未生效**） | `needsWarmPrefix`、`isSummarizationMessage`、`buildReplayedPayload`、`buildWarmPrefixData` |
| `task-record.ts` / `token-speed.ts` | 任务记录与出字速度统计 | `recordTaskRecord`/`loadTaskRecords`、`createSpeedTracker`/`formatSpeed` |

## 关键常量与环境变量

| 项 | 默认 | 覆盖变量 |
|----|------|----------|
| 绝对压缩阈值 | 256K | `PI_CONTEXT_ABSOLUTE_TOKENS` |
| 重启提示阈值 | 100K | `PI_CONTEXT_RESTART_TOKENS` |
| 压缩冷却 | 10 分钟 | `PI_CONTEXT_COMPACT_COOLDOWN_MS` |
| 空闲判定 | 关闭（0） | `PI_CONTEXT_IDLE_MS` |
| 任务门总开关 | 开 | `PI_CONTEXT_TASK_GATE=off` |
| 每轮擦除总开关 | **关** | `PI_CONTEXT_ERASE=on` |
| 工具擦除保护带 | 60K | `PI_CONTEXT_PRUNE_PROTECT_TOKENS` |
| 工具擦除最小回收 | 30K | `PI_CONTEXT_PRUNE_MINIMUM_TOKENS` |
| thinking 保留量 | 64K | `PI_CONTEXT_KEEP_THINKING_TOKENS` |
| 会话输出预算 | 20K | `PI_CONTEXT_OUTPUT_BUDGET_TOKENS`（`read` 豁免） |
| 归档目录 | `<PI_MEMORY_DIR>/tool-outputs` | `PI_OUTPUT_ARCHIVE_DIR` |
| 压缩快照目录 | `<PI_MEMORY_DIR>/checkpoints/compact` | `PI_COMPACT_SNAPSHOT_DIR` |

比例类阈值另可经 `PI_CONTEXT_*_RATIO` 覆盖（`readEnvRatio`）。

## 缓存纪律

- **每轮擦除默认关闭**（`PI_CONTEXT_ERASE=on` 才启用）。2026-09-26 成本审计：`context` 钩子每轮
  都用**未改写的历史**重算擦除计划，擦除边界随会话增长前移，于是每轮请求序列都在更靠后的位置
  与上一轮不同——该点之后全部 token 失去前缀缓存。实测某真实会话 105 请求中 13 个因此以全价
  重发 190K–250K（单次 $0.03，占该会话 67% 成本），而当轮真正回收只有几千 token。
  盈亏平衡需 `49×S/F` 次后续请求（S≈上下文、F≈回收量；S=200K/F=10K → 约 1000 次），不可达。
  回收上下文交给压缩（压缩本就要重建前缀）。详见 `task-gate.ts` 的 `PER_TURN_ERASE` 注释。
- 压力档文案按档位**固定文本**，且不再写入 system prompt：由 `context/index.ts` 以 `my-pi-context-advice`
  消息 append-only 追加（仅在内容变化时），避免前缀最前处变动导致整段缓存失效。
- 禁止时间戳/精确数值进入注入面；token 估算统一走 `estimateTokens`。
- 缓存断裂归因用 `prefix-fingerprint.ts`（记录到 `portable/memory/logs/prefix-fingerprints.jsonl`，`/context fingerprint` 查看）。
  已知断裂源按代价排序：每轮擦除（已关闭）> 会话中途 `enable_tool` 改工具集 > system prompt 变化 > 记忆注入刷新。

## 已知限制：warm-prefix 是死代码

`warm-prefix.ts` 的纯逻辑完整，但触发它的 `before_provider_request` 事件只挂在主 agent 循环的 `onPayload` 上；
压缩走 `agent.streamFunction` 直连且不带 `onPayload`，因此 `isSummarizationMessage` 分支**永不触发**，
摘要请求按全价计费。补丁点已定位在 vendor `core/sdk.ts` 的 `buildRequestOptions`（需改上游关键路径），
**有意延后**——见 [MIGRATION-AUDIT.md](../../../../docs/development/MIGRATION-AUDIT.md) 的 G3
与 DECISIONS 的上下文优化条目。

## 相关

- 上层：[../README.md](../README.md)
- 上下文优化对比与成本模型：[docs/development/CONTEXT-MANAGEMENT-COMPARISON.md](../../../../docs/development/CONTEXT-MANAGEMENT-COMPARISON.md)
