# context/budget — 预算、擦除与压缩子包

`context` 功能的确定性（零 LLM）内核：token 预算与压力分档、工具输出擦除/归档/截断、thinking 擦除、
压缩阈值与压缩前快照、任务门（何时允许压缩）、运行时前缀指纹，以及暖前缀重放（当前为死代码，见文末）。

所有模块均为**纯逻辑**（零 Pi 依赖），由 `context/index.ts` 经 `custom/adapters/` 接线；
`../logic.ts` 只做 barrel 转发。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `budget.ts` | 全局预算/压力报告、输出预算与截断 | `setTotalBudget`/`setContextWindow`/`setCompactThreshold`/`getBudgetReport`/`getTokenPressureTag`/`estimateTokens`、`truncateByTokens`/`truncateHeadTail`/`tailByTokens`、`pruneToolOutput`/`getOutputReport` |
| `prune.ts` | 消息级擦除（工具输出 + thinking） | `PRUNE_PROTECT_TOKENS`(60K)/`PRUNE_MINIMUM_TOKENS`(30K)/`DEFAULT_KEEP_THINKING_TOKENS`(64K)、`pruneToolResults`、`pruneThinkingBudget`、`sweepPruneRefs` |
| `prune-dump.ts` | 擦除转储引用目录（14 天清理） | `pruneRefsDir`、`PRUNE_REFS_RETENTION_DAYS`、`buildPruneDumpRef` |
| `output-archive.ts` | 大工具输出落盘 + 占位符 + 清理 | `ARCHIVE_RETENTION_DAYS`(14)/`ARCHIVE_MAX_TOTAL_BYTES`(200MB)、`archiveOutput`、`archivedStub`、`sweepArchive` |
| `compression.ts` | 压缩前快照（`checkpoints/compact/`，旧版根目录兼容清理）与 JSON 缩减 | `snapshotBeforeCompact`、`pruneSnapshots`、`shrinkHalf`、`compactJson`、`snapshotDir`、`legacySnapshotDir` |
| `task-gate.ts` | 阈值/门限解析（含 env 覆盖）与后台任务判定 | `ABSOLUTE_TOKENS`/`RESTART_TOKENS`/`COMPACT_COOLDOWN_MS`/`IDLE_MS`/`TASK_GATE`、`resolveContext`、`hasBackgroundTask` |
| `auto-compact.ts` | 压缩判定与阈值计算 | `computeCompactThreshold`、`makeCompactDecider`、`makeAutoContinueGate` |
| `compact-payback.ts` | 压缩的**回本估算**（P2，2026-10-08）：压缩是一次前缀重写，先算「还要几轮才回本」再谈压不压。**只算不决策**——未给剩余轮次时 verdict 为 `unknown`，不做猜测。成本模型：`savedPerTurn = 上下文 − 摘要`、`rewriteCostTokens = 上下文 × (1 + missPremium)`（生成摘要读一遍 + 压缩后整段前缀失效重读一遍）。默认参数下回本约 **60 轮**；把缓存溢价设 0 只需 **2 轮** ⇒ 「重写很贵」几乎全来自**缓存失效**。观察点挂在 `session_before_compact` **最前面**（自动压缩分支会提前 return），整段 fail-open；日报字段 `压缩回本=p50=<轮数>/n=<条数>` | `estimateCompactPayback`、`formatPayback`、`DEFAULT_MISS_PREMIUM`、`DEFAULT_SUMMARY_RATIO` |
| `workspace-instructions.ts` | 工作区指令（AGENTS.md/CLAUDE.md）收集与渲染：复刻 pi 的发现规则（agentDir 优先 → cwd 向上、宽泛→具体、按路径去重）+ 64KB 体积预算 + UTF-8 安全截断。产出待注入的尾部消息文本与 hash | `collectWorkspaceInstructions`、`collectContextFiles`、`renderWorkspaceInstructions`、`truncateUtf8Safe`、`WORKSPACE_INSTRUCTIONS_MAX_BYTES` |
| `hard-rules.ts` | system 层保留的**静态注入文本**（常量）：不变量摘要 + 效率建议/委派建议。改动它等于所有会话前缀失效一次（也是 `check-injection-surface.sh` 的基线对象） | `HARD_RULES`、`EFFICIENCY_ADVICE`、`LOW_PRESSURE_DELEGATION`、`FULL_DELEGATION_ADVICE` |
| `system-prompt.ts` | **system 注入的唯一装配点**（`buildSystemPrompt`）+ 运行期注入面体检（超预算/易变内容告警）+ 字节预算与易变内容模式常量。配套守门 `../__tests__/injection-stability.test.ts` | `buildSystemPrompt`、`appendedSystemParts`、`auditSystemInjection`、`findVolatileInjection`、`VOLATILE_PATTERNS`、`SYSTEM_INJECTION_MAX_BYTES`、`SYSTEM_APPEND_MAX_BYTES` |
| `session-title.ts` | 会话标题规范化（剥离 ANSI/控制字符、折叠空白、UTF-8 字节上限）：供 `session_title` 工具使用；标题只落 `session_info` 元数据、不进上下文 | `normalizeSessionTitle`、`MAX_SESSION_TITLE_BYTES` |
| `prefix-fingerprint.ts` | 逐请求前缀指纹（system/tools/消息头/**全消息序列分段**/总量哈希） | `fingerprintRequest`、`formatFingerprint`、`systemTextOf`、`messageSegments`、`firstDivergentSegment`、`FINGERPRINT_HEAD_MESSAGES`、`FINGERPRINT_SEGMENT_MESSAGES` |
| `thinking-level.ts` | 思考档位自动升降 | `tickThinkingLevel`、`proposeThinkingLevel`、`inferTaskType` |
| `tool-health.ts` | 错误输出精简与失败熔断提示 | `dehydrateErrorOutput`、`updateFailStreak`、`FAIL_STREAK_LIMIT` |
| `warm-prefix.ts` | 压缩摘要的暖前缀重放（**当前未生效**） | `needsWarmPrefix`、`isSummarizationMessage`、`buildReplayedPayload`、`saveMainRequestPayload`、`canReplayWarmPrefix` |
| `task-record.ts` / `token-speed.ts` | 任务记录与出字速度统计 | `recordTaskRecord`、`createSpeedTracker`/`formatSpeedCompact` |

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
  其中 `changed` 里的 `messages@<start>-<end>` 给出**前缀失效的起点消息下标**：`messages@0-7` 等价整段重放（最贵），
  起点越靠后代价越小；**尾部追加不算分叉**（只记 `messages`），否则正常追加会被误报成整段失效。
  2026-10-01 之前的记录没有 `segments` 字段，分叉统计只对新增记录有效。
  已知断裂源按代价排序：每轮擦除（已关闭）> **会话中途激活 `deferred` 工具**（`tool_search` 拉出 → 工具段变化；分层机制已于 2026-10-08 删除，这是当前唯一「工具集变化」来源）> system prompt 变化 > 记忆注入首次刷新。
- **工具 schema 常驻 vs 休眠分层**：schema 在请求最前处，会话中途 wake 一次 = 整段重算（实测 $0.01–0.04，
  重启后还要再来一次）；休眠组常驻只按命中价计费，一次 wake 的成本就超过整场会话的常驻成本（约 6 倍）。
  **2026-10-08：分层机制已整体删除**（含 `enable_tool` 与组名单）——需要「不进前缀」的部分改由 pi 原生
  `deferred` + `tool_search` 承担（`browser` 18 个工具 0 前缀字节）。这笔账的结论仍有效，
  并已改指向 `deferred` 激活这条仍然存在的断裂源。

## 已知限制：warm-prefix 是死代码

`warm-prefix.ts` 的纯逻辑完整，但触发它的 `before_provider_request` 事件只挂在主 agent 循环的 `onPayload` 上；
压缩走 `agent.streamFunction` 直连且不带 `onPayload`，因此 `isSummarizationMessage` 分支**永不触发**，
摘要请求按全价计费。补丁点已定位在 vendor `core/sdk.ts` 的 `buildRequestOptions`（需改上游关键路径），
**有意延后**——见 [MIGRATION-AUDIT.md](../../../../docs/development/MIGRATION-AUDIT.md) 的 G3
与 DECISIONS 的上下文优化条目。

## 历史限制（已随机制删除，2026-10-08）

曾有一处已知限制：分层档自愈时会拿「首次动手前的 pi 基线」重算，从而把 pi 在会话中途激活的工具
（典型：MCP 的 `tool_search`/`codemode`）裁掉。**该机制已整体删除，此限制随之消失**；记录保留是因为
它说明了一个仍然通用的坑：**任何「以旧基线重算工具集」的做法都会吃掉中途激活**。

## 相关

- 上层：[../README.md](../README.md)
- 上下文优化对比与成本模型：[docs/development/CONTEXT-MANAGEMENT-COMPARISON.md](../../../../docs/development/CONTEXT-MANAGEMENT-COMPARISON.md)
