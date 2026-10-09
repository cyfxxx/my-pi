# context — Token 优化中枢

钩子型扩展：围绕「缓存友好」做上下文预算、剪枝、压缩去重、工具分层、thinking 档位与任务记账。
是 12 个功能里钩子最多、预算子系统最大的一个。

## 注册面

- 工具：`thinking_level`、`session_title`（写会话元数据，不进上下文）；`edit_and_run`（编辑+立即验证的融合工具，参数同 `edit`）
- 命令：`/context <usage|report|fingerprint|help>`、`/tools <list|help>`
- 钩子：`session_start`、`before_agent_start`、`input`、`turn_start`、`context`、`tool_call`、`tool_result`、`message_update`、`turn_end`、`before_provider_request`（前缀指纹）、`session_compact`、`session_before_compact`（快照）、`agent_settled`

## 工具常驻策略（2026-09-26 起默认常驻）

全部工具 schema 常驻，不做休眠裁剪：工具 schema 位于请求最前处，会话中途改一次工具列表就让**整段**
前缀缓存失效（实测单次 $0.01–0.04，重启后分层复位还需再改一次）；而让休眠组 schema 常驻只按命中价
（1/50）计费——按保守上限（休眠 schema 20K token、上下文 250K）算，常驻 100 个请求共约 $0.006，
一次中途 wake 就是 $0.0375，**约 6 倍**。这笔账说明这个方向本身不成立。

**2026-10-08：分层/休眠组机制已整体删除**（`tool-groups.ts`、`tool-layering.ts`、`enable_tool`、
`PI_CONTEXT_TOOL_LAYERING`，约 340 行 + 一份要持续与工具面同步的组名单）。理由：① 上面那笔账说明
「中途 wake」永远亏（且现在前缀更小、上下文更大，亏得更多）；② 需要「不进前缀」的那部分已由
**pi 原生的 `deferred`** 更好地解决——`browser` 18 个工具 **0 前缀字节**，由 `tool_search` 按需拉出，
不需要组名单也不需要 `enable_tool`；③ 它默认关闭，30 天里 `enable_tool` 仅 8 次调用 ⇒ 按「按消费设门」
的标准不该留着。**知识保留**：那笔盈亏平衡账与「工具集变化 = 整段前缀失效」仍然有效，只是现在指向
激活 `deferred` 工具（`tool_search`）这条**依然存在**的断裂源。

**基线是 pi 的激活决定（2026-10-04 修正）**：常驻策略只管"my-pi 要用的工具别休眠"，**不替 pi 打开
它刻意休眠的工具**。`effectiveActiveTools` 的第一个参数是 `tool-layering.ts` 在首次动手前抓的
`getActiveTools()` 基线，函数只做减法（裁未启用休眠组）或在分层档把显式 enable 的组加回来，因此
`tool_search`/`codemode`（pi 以 `defaultActive: false` 注册）与 POSIX 上没有 `pwsh` 的 `powershell`
自然不会被激活。此前 `layered=false` 直接返回"全部已注册工具"，把这三个一并激活了
（实测 full 模式活跃 72 个 → 修正后 69 个）。

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令/钩子；编排各预算模块 |
| `logic.ts` | 纯逻辑 barrel + 注入文本常量（`extractUserRequest`/`hasInProgressTask`/`EFFICIENCY_ADVICE`） |

> 工作区指令（AGENTS.md）的注入位置（2026-10-01）：**不在 system prompt**，而是由 `budget/workspace-instructions.ts` 渲染成尾部 append-only 消息（`my-pi-workspace-instructions`）。system 层只保留 `budget/hard-rules.ts` 的静态常量与 pi 原生的 `APPEND_SYSTEM.md`。原因与验证见 `DECISIONS.md` 的 [2026-10-01] 条目。 |
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
  避免"前缀最前处变化 → 整段缓存失效"（实测单次 170K–316K 全价重算）。（休眠组摘要随 2026-10-08
  的分层机制删除而一并移除——它本来就是为那个机制服务的。）
- 记忆注入同理（`shouldInjectMemory`：内容未变不重注）。**2026-09-29 更正**：旧实现在 `context`
  钩子里用 `filterInjectedMessages` 移除除最新一条外的全部注入（防累积），其注释认为位移点"通常是
  上一次请求的尾部 → 只影响尾部少量 token"，**实测不成立**：注入后的 83 次请求命中率仅 **61.1%**，
  占全部未命中的 **39.0%**（其余 567 次为 96.2%）；2026-09-26 12:41–12:52 连续 10 次请求命中率
  4%–25%（ctx 250K，cacheRead 9K–60K），说明删除旧注入是**从会话头部附近截断整段缓存**。
  现已改为 **append-only**：不再移除旧注入，块首声明"以最新一块为准"，旧注入随压缩折叠（有界）。
  代价是每轮多几百 token 的 cacheRead（≈1/50 全价），远低于一次 150K–320K 全价重算。

### 切档与工具集（2026-09-29 实测新增）

- **切档 = 整段失效**：DeepSeek 的前缀缓存键包含 `reasoning_effort`，
  切 thinking 档位后下一次请求 `cacheRead` 归零（2026-09-27 12:05:59 切 `low`：141,184/141,406
  → 0/142,075，其间其它分段指纹无变化）。故：
  - **自动切档默认关闭**（`PI_CONTEXT_THINKING_AUTO=on` 才开启）——降一档省下的 thinking token
    远小于一次整段全价重算；
  - 运行时档位经 `clampForCacheSafety` 夹到 `PI_THINKING_MAX_LEVEL`（默认 `high`）：切换到
    `deepseek-flash` 会被自动解析成 `max`（实测 4/4 次），而 `max` 只烧 reasoning token。
    夹档发生在模型切换的同一次，模型切换本身已使缓存失效，故不产生额外代价。
- **`applyToolLayering` 只在集合真的变化时才调 `setActiveTools`**：工具数组位于请求最前部，
  一次变更使 system prompt + 整段消息前缀全部失效（2026-09-26 四次 `enable_tool` 各触发一次
  140K–250K 全价重算）。计划模式自 2026-09-27（`08ea930b2`）起改用 `tool_call` 拦截，不再切工具集。

## 运行时前缀指纹（诊断整段缓存失效）

`before_provider_request` 时对请求分段落指纹（system / tools / 消息头 / **thinking 档位** / 消息条数
/ 总序列 + 距上一条请求的间隔 `sinceLastMs`），逐条追加到 `logs/prefix-fingerprints.jsonl`，
`changed` 字段直接给出本次哪一段发生变化。用于定位「单次 170K–316K 全价重算」这类整段失效：
`system`/`tools`/`head`/**`level`** 变化 → 前缀最前处变了；`total` → 变化点在 head 覆盖的前 6 条
之外的消息内容里（中段改写）；仅 `messages` → 追加或压缩；`sinceLastMs` 很大 → 空闲后缓存失效。

**2026-09-29 补齐的两处盲区**：旧实现 `total` 算了却从不比较、`messages` 仅在条数变化时标记，
于是"中段消息内容被改写但条数不变"会被记成 `changed: []`（看起来前缀没变，实际整段失效）；
且未记录档位，使切档导致的失效看起来"无原因"。现在 `total` 作为兜底标记，档位单独标记 `level`。
`PI_PREFIX_FINGERPRINT=off` 关闭，`/context fingerprint` 查看最近一次。

## 关键环境变量

`PI_CONTEXT_THINKING_AUTO=on`（**开**自动切档，默认关）、`PI_THINKING_MAX_LEVEL`（运行时档位上限，默认 `high`）、`PI_CONTEXT_TASK_GATE`、`PI_CONTEXT_ERASE=on`（开每轮擦除，默认关）、`PI_CONTEXT_WINDOW_FALLBACK`、`PI_CONTEXT_ABSOLUTE_TOKENS`、`PI_CONTEXT_IDLE_MS`（默认 0=关空闲门）、`PI_CONTEXT_COMPACT_COOLDOWN_MS`、`PI_CONTEXT_PRUNE_PROTECT_TOKENS`（默认 60K）、`PI_CONTEXT_PRUNE_MINIMUM_TOKENS`（默认 30K）、`PI_CONTEXT_KEEP_THINKING_TOKENS`（默认 64K）、`PI_CONTEXT_OUTPUT_BUDGET_TOKENS`（默认 20K）、`PI_PREFIX_FINGERPRINT=off`、`PI_DISABLE_LEVEL_AUDIT`、`PI_DISABLE_PRUNE_DUMP`、`PI_DISABLE_TASK_RECORD`、`PI_CONTEXT_RATIO_TEST`、`PI_SESSION_ID`。

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
