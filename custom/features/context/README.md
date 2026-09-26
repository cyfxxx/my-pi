# context — Token 优化中枢

钩子型扩展：围绕「缓存友好」做上下文预算、剪枝、压缩去重、工具分层、thinking 档位与任务记账。
是 12 个功能里钩子最多、预算子系统最大的一个。

## 注册面

- 工具：`enable_tool`、`thinking_level`
- 命令：`/context <usage|report|fingerprint|help>`、`/tools <list|enable <组>|help>`
- 钩子：`session_start`、`before_agent_start`、`input`、`turn_start`、`context`、`tool_call`、`tool_result`、`message_update`、`turn_end`、`before_provider_request`（前缀指纹）、`session_compact`、`session_before_compact`（快照）、`agent_settled`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令/钩子；编排各预算模块 |
| `logic.ts` | 纯逻辑 barrel + 注入文本常量（`extractUserRequest`/`hasInProgressTask`/`EFFICIENCY_ADVICE`） |
| `usage-stats.ts` | 工具调用用量/缓存命中 JSONL 记账与汇总 |
| `budget/` | 预算子包，见 [budget/README.md](budget/README.md) |

## 数据落点（`portable/memory/`，可环境变量覆盖）

| 文件 | 内容 | 覆盖变量 |
|------|------|----------|
| `context/usage.jsonl` | 工具调用用量/缓存（轮转 4MB） | `PI_USAGE_FILE` |
| `task-records.jsonl` | 每轮任务结构记录（供 task-summarizer） | `PI_TASK_RECORD_FILE` |
| `logs/level-changes.jsonl` | thinking 档位变更审计 | `PI_LEVEL_CHANGE_FILE` |
| `logs/prune-refs/` | 工具输出擦除溯源 ref | `PI_PRUNE_REFS_DIR` |
| `checkpoints/compact/` | 压缩前快照（保留 8 份/7 天；旧版 `checkpoints/compact-*.json` 兼容清理） | `PI_COMPACT_SNAPSHOT_DIR` |
| `tool-outputs/` | 工具输出归档 | `PI_OUTPUT_ARCHIVE_DIR` |
| `logs/prefix-fingerprints.jsonl` | 逐请求前缀指纹（定位整段缓存失效，轮转 1MB） | `PI_PREFIX_FINGERPRINT_FILE` |
| `tmux-registry.json` | 只读，用于背景任务判定 | `PI_TMUX_REGISTRY` |

## 自动压缩门限（成本关键）

`turn_end` 判定是否 `ctx.compact()`，依次经过：阈值（`PI_CONTEXT_ABSOLUTE_TOKENS`，默认 256K）
→ 门1 进行中计划任务 → 门2 本会话 tmux 后台任务 → 门3 空闲门 → 冷却（`PI_CONTEXT_COMPACT_COOLDOWN_MS`）。

**门3 默认关闭（`PI_CONTEXT_IDLE_MS` 默认 0）**，这是 2026-09-25 成本审计的结论：

- 判定点只有 `turn_end`，而它总是紧跟一次用户输入，若比较「距最近一次输入」，差值恒为本回合耗时
  （秒级），门在连续工作中**永不可能通过** → 实测 10 小时 / 341K 上下文会话零压缩。
- **但压缩不是主要收益来源**（2026-09-25 价目修正）：缓存命中只要 $0.003/M（输入的 1/50），
  一次 256K 压缩的自身开销约 `256K × $0.15/M = $0.038`，而它省下的命中 token 仅值约
  `230K × $0.003/M = $0.0007/请求` → **回本约需 55 个后续请求**。此前"压缩可省 61%"的估算按 1/10 比例算，
  **该结论已作废**（详见 [CONTEXT-MANAGEMENT-COMPARISON.md](../../../docs/development/CONTEXT-MANAGEMENT-COMPARISON.md) 第六节）。
- **每轮擦除已默认关闭**（`PI_CONTEXT_ERASE=on` 可开）：它和压缩一样断裂前缀缓存，但压缩只断一次
  并顺带摘要（一次全价请求），而每轮擦除**每轮都断**——且擦除点随会话增长前移，其后 190K–250K
  token 全部按全价重发。2026-09-26 实测：某真实会话 105 请求 / 13 个冷请求 / 占该会话 67% 成本，
  而当轮回收仅几千 token。缓存命中价是未命中价的 1/50，擦除回本需约 `49×S/F` 次后续请求，不可达。
  见 [budget/README.md](budget/README.md#缓存纪律) 与 `task-gate.ts` 的 `PER_TURN_ERASE`。
- 压缩保留是为了避免超窗与冷缓存后的大额重算，不再是省钱主力。
- 如需保守行为（只在长时间空闲后压缩），设 `PI_CONTEXT_IDLE_MS>0`（毫秒）；此时由
  `passesIdleGateAtTurnEnd` 按「回合开始前的空闲」正确判定。打断风险仍由门1/门2 承担。

**压力分档以压缩阈值为基准**（`getBudgetReport` 的 `budgetBase`/`pressureRatio`，0.7/0.85/0.95）。
此前分档一直以**窗口**为分母且 `setCompactThreshold` 从未被调用：窗口 1M 而阈值 256K 时高档是 850K，
模型在压缩前**永远收不到预警**。现在达到阈值 90% 即报 `high`。

## 前缀稳定性（缓存友好的注入策略）

- **system prompt 只追加静态常量** `EFFICIENCY_ADVICE`。易变运行时提示（压力档文案、休眠工具摘要、
  重启提示）**不再写入 system prompt**，而是在 `before_agent_start` 以 `my-pi-context-advice` 消息
  **仅在内容变化时追加**（append-only，不删除旧的）：变化点落在尾部，只影响其后的少量 token，
  避免"前缀最前处变化 → 整段缓存失效"（实测单次 170K–316K 全价重算）。
- 记忆注入同理（`shouldInjectMemory`：内容未变不重插；**原项目 `pi-tools` 每轮都重插，无去抖**，
  my-pi 是更省的那一侧）。移除旧注入的位移点是**上一条注入的位置**（注入总追加在轮末，故通常就是
  上一次请求的尾部 → 只影响尾部少量 token）；唯一例外是会话中的**首次**刷新：上一条注入还是第 1 轮
  注入（消息序列第 3 条，属头部）→ 整段失效一次。实测该次 cacheRead 10.6K/199.5K（$0.029/会话），
  之后刷新位移点在 198.5K 处（cacheRead 198.5K/244K）。`filterInjectedMessages` 与原项目逐字一致
  （防注入累积），**保持不变**。

## 运行时前缀指纹（诊断整段缓存失效）

`before_provider_request` 时对请求分段落指纹（system / tools / 消息头 / 总序列 + 消息条数 + **距上一条请求的间隔 `sinceLastMs`**），
逐条追加到 `logs/prefix-fingerprints.jsonl`，`changed` 字段直接给出本次哪一段发生变化。
用于定位「单次 170K–316K 全价重算」这类整段失效：若 `system`/`tools` 变化 → 前缀最前处变了；
若仅 `messages` 变化 → 压缩/裁剪或注入位移；若 `sinceLastMs` 很大 → 属空闲后缓存失效（provider 侧）。
`PI_PREFIX_FINGERPRINT=off` 关闭，`/context fingerprint` 查看最近一次。

## 关键环境变量

`PI_CONTEXT_THINKING_AUTO=off`（关自动切档）、`PI_CONTEXT_TASK_GATE`、`PI_CONTEXT_ERASE=on`（开每轮擦除，默认关）、`PI_CONTEXT_WINDOW_FALLBACK`、`PI_CONTEXT_ABSOLUTE_TOKENS`、`PI_CONTEXT_IDLE_MS`（默认 0=关空闲门）、`PI_CONTEXT_COMPACT_COOLDOWN_MS`、`PI_CONTEXT_PRUNE_PROTECT_TOKENS`（默认 60K）、`PI_CONTEXT_PRUNE_MINIMUM_TOKENS`（默认 30K）、`PI_CONTEXT_KEEP_THINKING_TOKENS`（默认 64K）、`PI_CONTEXT_OUTPUT_BUDGET_TOKENS`（默认 20K）、`PI_PREFIX_FINGERPRINT=off`、`PI_DISABLE_LEVEL_AUDIT`、`PI_DISABLE_PRUNE_DUMP`、`PI_DISABLE_TASK_RECORD`、`PI_CONTEXT_RATIO_TEST`、`PI_SESSION_ID`。

## 确定性擦除（零 LLM 成本，默认关闭）

`context` 钩子每轮按序执行三层，**都不产生 LLM 调用**；只有它们兜不住时才轮到 auto-compact：

1. **写入时截断**（`tool_result` 钩子，`budget.pruneToolOutput`）：单次 ≤5K token；非豁免工具另受
   会话累计 20K 预算约束，超出后压到 300 token 档。**`read` 豁免会话预算**——它是"凭占位符路径
   读回归档原文"的唯一手段，若也被压到 300 token，`output-archive` 的"可读回"承诺即失效
   （实测长会话后期 read 输出均值仅 155 token）。截断内容经 `archivedStub` 落盘并附路径。
2. **工具输出擦除**（`budget.pruneToolResults`，**仅 `PI_CONTEXT_ERASE=on` 时生效**）：保留最近 2 轮 + 60K 保护带，
   更早的 toolResult 替换为 `[pruned: N chars → ref]`（ref 落盘，14 天/50MB 清理）；可回收量 <30K 时不擦。
3. **历史 thinking 擦除**（`budget.pruneThinkingBudget`，同上门控）：保留最近 64K thinking，更早的删除。

落盘引用由 `session_start` 一并清理：`sweepPruneRefs`（擦除 ref，14 天/50MB）与
`sweepArchive`（工具输出归档，14 天/200MB，此前无任何上限，实测 442 文件仍在增长）。

校准依据（2026-09-25 成本审计，10 小时 / 341K 上下文会话）：thinking 占 **50%**、工具输出占 **46%**；
原阈值（120K/80K）与未接线的 thinking 擦除导致两者全程未生效，回收压力全落在有损的写入时截断上。

**2026-09-26 成本审计推翻了"擦除比压缩便宜"的结论**：离线重放真实会话（105 请求 / 250K 上下文）显示，
`context` 钩子每轮都从未改写的历史重算擦除计划，擦除边界随会话增长不断前移，于是**每轮**请求序列都在
一个更靠后的位置与上一轮不同 → 其后全部 token 失去前缀缓存。13 个请求因此以全价重发 190K–250K
（单次约 $0.03），占该会话成本的 **67%**，而当轮实际回收仅几千 token。缓存命中价是未命中价的 1/50，
擦除需 `49×S/F` 次后续请求才回本（S=200K、F=10K → 约 1000 次），不可达。故改为默认关闭，仅
`PI_CONTEXT_ERASE=on` 时按旧行为执行；无前缀缓存的 provider（本地模型）仍可用。

## 缓存纪律

注入文本保持稳定前缀，**禁止注入精确 token 数值**（小数变动会破坏前缀缓存）；因此压缩/压力提示使用静态文本。

## 相关

- 预算子包：[budget/README.md](budget/README.md)
- 只读依赖 `plan-mode/logic` 的 `getTodos`（跨功能引用走 logic barrel）与 `memory/recall` 反向依赖本功能的 `logic`。
