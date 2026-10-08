# SoL-Pi 借鉴优化方案（分步推进）

> 2026-10-08 制定。来源：NVIDIA SoL-Pi 项目页（`https://nvlabs.github.io/SoL-Pi/`，本次只读到项目页且**内容被截断**；
> README 抓取失败、arXiv 论文未读）。因此本方案只采用**项目页明确给出**的机制与数字，其余标注为推断。
>
> **执行者注意**：本文件是跨会话/跨压缩的**唯一权威计划**。每完成一项，在该项标题后标 `✅`，
> 并在 `DECISIONS.md` / `PROGRESS.md` 留档，然后提交推送。**逐项推进，不并行开工**——SoL-Pi 的
> 证据是"一次只让一个机制过门，损失会累积"（组装版只保留 Pi 约 94% 的分），所以我们要一项一项验。

## 0. 全局纪律（每一项都必须满足，不是可选项）

来自 SoL-Pi 的做法，也是我们这几轮已经在用的：

1. **预先声明能力地板**：动手前写明"哪些检查必须保持绿"（`tsc` / `vitest` / `check-features` /
   `check-conventions` / `golden` / 该项自己的守门）。**不允许事后下调地板**。
2. **至少一项效率指标改善**，且要**实测数字**（不许推断当结论）。
3. **负结果照样归档**（命令 + 数字），写进 `DECISIONS.md`。
4. 每项一个提交，格式 `{feat,fix,docs,test}: …`，只暂存显式路径，推送（pre-push 会跑全量 golden）。
5. **失败开放**：新增机制的异常一律不得让原有路径失败（参考池化的 stderr 留痕回退）。
6. **守门要能自证**：新增守门必须带"能抓出坏样本"的反向断言（参考 `evaluate-no-named-functions.test.ts`）。

## 1. 自主推进的边界（用户已去休息，这条最重要）

**可以直接做**：
- 新增测量/指标/日志；
- 新增守门与测试；
- 修正缺陷（含文档失真）；
- 把新行为放在**显式 opt-in** 之后（默认行为不变）；
- 纯文档、注释、台账。

**不可以自己做，只产出"决策提案 + 证据"留给用户**：
- 改变**默认行为**或削减能力（关功能、删工具、删休眠机制、改 `DEFAULT_OFF_FEATURES`）；
- 改变 `goal` 的**自主性边界**（轮次上限语义、默认开/关）；
- 任何破坏性/不可逆操作（删文件、改历史、强推）；
- 让子代理获得**写状态**的能力（`extensions` 默认值、D6 的 verifier 契约**强制**）。

判定标准：**"用户回来看到默认行为变了、且我没提前说"就是越界。**

---

## P1 目标完成语义：区分 verified / declared / advisory ✅ **已完成（2026-10-08）**

**SoL-Pi 依据**：P 族发现——"Separate verified, declared, and advisory completion modes"、
"Require validation evidence before claiming completion"、"Give counterexamples precedence"。

**我们的缺口**：`goal` 工具（`custom/features/autopilot/store/goal.ts` + `autopilot/index.ts`）的
`goal complete` **只信模型自述**。我方 `HARD_RULES` 已经写了"能自证的改动必须给实测证据"，但 goal 上没强制。

**做法（不削能力：默认行为不变，只是把"声明"标清楚）**：
- `goal complete` 增加可选 `evidence` 参数；**不带 evidence 时状态标为 `declared`**，
  `goalStatusText` 明确打印"（未经校验）"；
- 带 evidence 时标为 `verified`；
- `verify_*`（`autopilot/tools/verify-tools.ts`，LLM-as-a-Verifier 已存在）作为**可选**二次校验：
  `goal complete` 传入 `verify: true` 时才走，能跑通则升级为 `verified`，否则**保持 declared 并说明原因**
  （不阻塞完成——阻塞会改变自主性语义，属于边界内"新增"而非"改默认"）；
- **advisory**：`goal blocked` 同样要求一句原因（已有 `note`），标注为 advisory 结论。

**能力地板**：`goal.test.ts` 全绿 + 新增用例（三态区分、无 evidence 标 declared、带 evidence 标 verified）。
**效率指标**：本项不追效率（它买的是"可信度"）；验收看**行为可观测**：`goalStatusText` 能区分三态。
**落点**：`autopilot/store/goal.ts`（纯逻辑，加 `completionMode` 字段 + 判定）、`autopilot/index.ts`（工具参数）、
`autopilot/__tests__/goal.test.ts`。

## P2 压缩"回本"决策（Online Context Compact 最小版）✅ **已完成（2026-10-08）**

**SoL-Pi 依据**：把**子任务完成**当作压缩触发的时钟，且**只在预期未来节省能还清重写成本时**才动作
（原话：compaction is a rewrite；KV-cache 复用通常把压缩推迟到很晚）。

**我们的缺口**：`custom/features/context/budget/auto-compact.ts` 是**阈值驱动**（
`LARGE_WINDOW_RATIO = 0.8` / `SMALL_WINDOW_RATIO = 0.85`），`budget.ts` 的 `HIGH_THRESHOLD = 0.85`；
**没有任何"回本"计算**。而我们实测过重写的代价极贵：那次会话 259,833 未命中里 **60.8% 只来自 2 次
system 段翻转**（147,555 + 10,308）。

**做法**：
- 新增纯逻辑 `custom/features/context/budget/compact-payback.ts`：
  `shouldCompact({ contextTokens, compactCostTokens, recentTurnTokens, remainingTurnsEstimate })`
  → `{ compact: boolean; reason: string; paybackTurns: number }`。
  判定：`预计剩余轮次 × 每轮省下的 token > 重写成本`，并给出"还要几轮回本"。
- **默认只记录不改行为**（属于"新增测量"）：把判定结果写进 `daily-health` 可读的日志，
  跑一段时间后用真实数据决定是否接管默认阈值（**接管默认 = 改默认行为，留给用户决策**）。
- 若已有 `session_before_compact` 钩子可挂，则在同一处输出"如果按回本判定，这次压不压"的对照，
  便于拿真实会话校准。

**能力地板**：`vitest`（含该模块新用例）、`check-features`、`golden`。**效率指标**：日志里能算出
"被回本判定拦下/放行"的比例与金额影响（`daily-health` 输出一列）。
**风险**：剩余轮次估计不准 → 因此**本项只观察不接管**，避免用不准的估计改变真实行为。

## P3 ObservationPack 细节审计（保留访问、去掉重复）✅ 待做

**SoL-Pi 依据**：大输出**本地归档**，上下文留 **handle + 短摘录**，需要时**分页精确召回**；
实现规格 **315 行 / 2 个钩子 / fail-open 契约**，且经过 **8 配置权衡扫描**才定版。
关键论点：大结果"在之后每个请求里重复出现，同时占用上下文与缓存"。

**我们已有什么**（先审计再决定改不改）：工具输出归档到 `PI_OUTPUT_ARCHIVE_DIR`
（默认 `portable/memory/tool-outputs/`）、`prune-refs`、`sweepArchive`。

**审计清单**（逐条给结论 + 证据）：
1. 归档后上下文里留的是**句柄还是只有一句"已归档"**？模型能否据此召回？
2. 召回是**整篇读回**还是**分页**？
3. **fail-open** 是否写死并有测试（归档失败不得让工具失败）？
4. 归档**默认是否开启**、多大阈值触发？
5. 是否有"同一大输出在后续请求里重复出现"的**实测计数**（这是我们自己的缓存论点，值得量化）。

**产出**：审计报告 + **决策提案**（阈值/分页/句柄形态的候选值）。**改默认留给用户点头**。

## P4 休眠机制审计：启用或删除，二选一 ✅ 待做

**SoL-Pi 依据**：C13 "Disable dormant mechanisms at configuration time"、C24 "Gate ObservationPack by
expected lifetime value"、M24 "Gate V2 candidates on consumption, dormant behavior, and distribution shift"。
**注意方向与我此前的倾向相反**：我之前在纠结要不要**打开** `TOOL_LAYERING`；SoL-Pi 的结论是
**长期不被消费的机制应当在配置期就关掉/去掉，而不是留着**。

**做法**：列出 my-pi 全部**休眠或默认关闭**的机制，逐条给：存在理由、最近是否被消费（用
`portable/memory/stats/tool-count-localhost.json` + 会话日志）、维护成本、**建议（启用 / 删除 / 保留并说明）**。
至少覆盖：`TOOL_LAYERING` + `tool-groups.ts` 的休眠组、`enable_tool`（仅在 layering 开启时注册）、
`web-search` 的降级路径、`voice`/`link`（已在 `DEFAULT_OFF_FEATURES`）、`codemode`。

**产出**：决策清单（**删除动作留给用户**）。**能力地板**：纯文档 + 可能的 `check-features` 基线说明。

## P5 golden 留出集：让"我按 golden 调好的"不再自动通过 golden ✅ **已完成（2026-10-08）**

**SoL-Pi 依据**：held-out 验证——"Held-out trajectories never enter subsequent analysis, and no agent
inside the auto-research loop sees the held-out results."。留出集是 EdgeBench（51 任务）。

**我们的真实缺口**：`golden-tasks.sh` 的 20 步**既是设计依据又是验收依据**——按它调就会通过它。
（幸运的是 19/20 两个真实 pty 场景已经默认跳过，`PI_GOLDEN_SCENARIO=1` 才跑。）

**做法（低成本、高说服力）**：
- 明确并文档化一条纪律：**步骤 19/20 属于留出集，开发过程中不看其结果**，只在**验收**时用
  `PI_GOLDEN_SCENARIO=1` 跑；
- 把这条写进 `scripts/README.md` / `STRUCTURE.md` / `docs/README.md` 的 golden 说明处；
- 给本地开发一个默认命令（`golden --fast` + 目标项的定向测试），避免"顺手把留出集跑掉"；
- **不要**为了让留出集通过而修改留出集本身。

**能力地板**：文档链接守门（`check-conventions` 的文档计数段）通过。**效率指标**：无（买的是证据强度）。

## P6 `edit_and_run`：编辑与其验证命令融合（Action Fusion 最小版）✅ 待做

**SoL-Pi 依据**：编辑/写入 → 命令的相邻转场占**跨轮转场 12.3%**，后继动作中 **bash 占 85.1%**；
融合后反事实推算 **轮次 1386→1237（−10.8%）**、**token 32.38M→28.64M（−11.5%）**（轨迹推算，非重跑）。

**我们的实测对应**：被中断那次会话 `bash` 1190 次、`edit` 164 次；115 个工具轮里 **52 轮 ≥2 调用**，
`bash+bash` 25 次、`bash+edit` 2 次——"改完就想跑"同样存在。

**做法**：
- 新工具 `edit_and_run`（**新增**，不动 pi 的 `edit`）；
- **复用 pi 的 edit 而不是重写**：用扩展 API 的 `ctx.executeTool()`（我在 pi 源码里确认过存在）调用
  `edit`，再跑命令，返回**一条合并观测**；
- 合并结果**必须显式分段**（`[edit]` 状态 / `[run]` 输出），否则一次失败的编辑会让模型把两件事混在一起归因；
- `executionMode: 'sequential'`（它既改文件又跑命令，且 pi 的判定粒度是整批）；
- 失败开放：`ctx.executeTool` 不可用时退化为"只做编辑"并说明。

**能力地板**：`viest`、`check-features`（会更新注册面基线 `node scripts/gen-registrations.mjs --update`）、
`golden`、`check-dead-exports`。**效率指标**：真实会话里 `edit`→`bash` 相邻对的数量下降、轮次下降
（从 `prefix-fingerprints.jsonl` + 会话文件统计）。

## P7 重复提醒升级为"按错误指纹的修复预算" ✅ **已完成（2026-10-08）**

**SoL-Pi 依据**：P15 "Budget repair per error fingerprint"、P23 "Break repeated diagnostic loops
without stopping real progress"、P9 "Give counterexamples precedence and break repeated failure loops"。

**我们的现状**：`custom/features/context/budget/repeat-reminder.ts` 按"**完全相同**（名+参数）连续调用"
在 3/5/8 档提醒——已经拿到 P23 的要点（只提醒、不阻塞）。

**升级点（新增，不改现有阈值语义）**：
- 把计数从"完全相同"扩展为**按错误指纹**聚合：同一**错误签名**（工具名 + 归一化错误文本）在
  滑动窗口内累计到 N 次时提醒，**跨不同的参数**也计入（因为"换参数重试同一错误"才是真打转）；
- 归一化要**去掉可变部分**（路径、行号、耗时、哈希），否则指纹过窄、永远不触发——这一条要有测试；
- 保留"只提醒不阻塞"，并在提醒里带上**该指纹已尝试过的不同参数个数**（给模型可操作信息）。

**能力地板**：`repeat-reminder.test.ts` 现有 8 项全绿 + 新增指纹归一化用例（含"路径/行号不同不应改变指纹"
与"不同错误不应合并"两个方向）。**效率指标**：指纹触发次数记录进日志，供后续比较。

## P8（提案）编辑类子代理的 verifier 契约

**SoL-Pi 依据**：D6 "Avoid generative edit delegates without a verifier contract"。

**我们的现状**：`subagent` 的子代理可以**自由写文件**，无 verifier 要求。

**做法（**只出提案，不改默认**）**：设计一个 opt-in 的 `verify: true` 参数（复用 `verify_*`），
让"派出去改代码"的子代理必须带一个可判定的验收条件；默认保持现状。
**产出**：决策提案 + 证据（子代理改动导致返工的真实案例计数，若拿得到）。

## P9 父级复用度量（池化后可得）

**SoL-Pi 依据**：D4 "Bound child work and measure parent reuse"。

**我们已做**：子代理常驻 RPC 池（`custom/features/subagent/core/rpc-pool.ts`）——**端到端实测
"两次任务只起一个进程"**（16.8s 两轮；纯冷启动 19.1s）。

**做法（新增测量）**：把池的复用情况写进 `daily-health`：进程启动次数 / 任务数（复用率）、
热/冷墙钟比、池大小峰值；`RpcPool` 已有 `size()` / `idleCount()` 可用。
**能力地板**：`daily-health` 自身守门（`test-state-audit` / `test-usage-metrics`）全绿。

---

## 执行顺序与理由

1. **P1**（最小、补最薄一环：goal 只信自述）
2. **P2**（对着我们实测最贵的前缀重写；只观察不接管，风险低）
3. **P5**（几乎是文档工作量，但从此每次优化的说服力不同）
4. **P7**（小而封闭，纯逻辑 + 测试）
5. **P9**（新增测量，池化刚落地，顺手可得）
6. **P3**（先审计后决定，审计本身就有价值）
7. **P4**（审计 + 决策清单，不动手删）
8. **P6**（最大的一项，需注册面基线更新与端到端验证；放最后避免与其他项相互干扰）
9. **P8**（只出提案）

每项完成后：更新本文件的状态标记 → 更新 `DECISIONS.md` / `PROGRESS.md` → 全量守门 → 提交推送。
**任一项若实测否掉，就把负结果归档并把该项标 `❌ 已否掉（附证据）`**，不要悄悄跳过。

### P1 实施结果（2026-10-08）

**关键设计决定：`verified` 不能由模型自封。** 如果模型只要在 `goal complete` 里写一句"我有证据"就能升级，
三态立刻退化成摆设。所以做成**结构约束**：

- `store/goal.ts` 只暴露三个构造器：`declaredCompletion` / `advisoryCompletion` / `verifiedCompletion`，
  **只有 `verifiedCompletion` 收得到「已跑通的检查结果」**——没有"带 mode 参数的通用完成函数"，
  因此不存在自封路径。测试直接锁这条映射（`expect(outs).toEqual(['declared','advisory','verified'])`）。
- `store/run-check.ts`（新）：`runCheckCommand(command)` 用 `sh -c` 跑一条**只读**检查命令，
  默认 120s 超时（比 bash 前台 240s 上限更短——检查本就该快）、输出只留尾部 4000 字符、
  超时按失败处理且不挂住调用方。**不接受模型自封**：只有 exit 0 才产生 `verified`。
- `goal` 工具：新增 `evidence` 与 `check` 两个可选参数。
  · 带 `check` → my-pi 实际执行；**通过** → `verified`（留存命令 + 输出尾部 + 时间）；
    **不通过** → 目标**不标记完成**，把输出尾部回给模型（模型自己要求了判据，就按判据说话——
    这条在新 opt-in 路径内，**不改任何旧默认**：不带 `check` 的 `goal complete` 行为与之前完全一致）。
  · 不带 `check` → `declared`（状态文案明写"声称完成，未经校验"）。
  · `blocked`/`pause` → `advisory`；**harness 自己判定的停止**（达到轮次上限、连续 3 轮无进展）也标 `advisory`。
- `goalStatusText` 现在会打印 `完成语义：declared（声称完成，未经校验）/ verified（已独立校验）/ advisory（判断性结论，不是证明）`。

**能力地板**：`tsc` 干净；`goal.test.ts` 16 项 + `run-check.test.ts` 7 项全绿；
`check-features` / `check-conventions` / `check-dead-exports` / `golden` 全绿。
**验收证据（本项不追效率，买的是可信度）**：`goalStatusText` 能区分三态、`verified` 只能来自跑通的检查
（两条都有测试钉住）；`run-check` 的超时用例实测 **1.32s 收口**（`sleep 5` + 300ms 超时），
证明"不会把调用方挂住"。

**未做（留待以后）**：把 `verify_*`（LLM-as-a-Verifier，默认关闭）接成第二种校验来源。
本项只用**确定性命令**做校验——这更符合 SoL-Pi 的"Demand a check that can distinguish the broken state"，
而 LLM 评审是另一类（他们也是分开的：M15/M32 讲把评审证据绑定好，而不是拿它当唯一判据）。

### P2 实施结果（2026-10-08）

**只观察、不改默认**（这是本项的边界：接管阈值 = 改默认行为，留给用户）。

- 新增纯逻辑 `context/budget/compact-payback.ts`：`estimateCompactPayback({contextTokens, contextWindow,
  forcedRatio, summaryRatio?, missPremium?, remainingTurns?})` → `{trigger, savedPerTurn,
  rewriteCostTokens, paybackTurns, verdict, reason}`。
  **成本模型显式写出**：`savedPerTurn = 上下文 − 摘要`；`rewriteCostTokens = 上下文 × (1 + missPremium)`
  （生成摘要要读一遍整段 + 压缩后整段前缀失效要重读一遍）；`missPremium` 默认 **49**（DeepSeek 命中价
  约为未命中的 1/50）。模型**偏保守**（把重写成本算高），所以它说"值得压"时可信度更高。
- **当前默认参数下的客观数：回本约 60 轮**（省 84%、成本 50 倍上下文）。而把缓存溢价设成 0 时只需 **2 轮**
  ——**"重写很贵"几乎全部来自缓存失效**，这条把我们的成本结构量化了。
- **不猜测**：没给 `remainingTurns` 就是 `verdict: 'unknown'`（只给客观的"还要几轮回本"）。
  允许调用方以后拿真实会话的剩余轮次分布来判定，而不是我现在拍一个。
- 观察点：`context/index.ts` 的 `session_before_compact` 处理器**最前面**（必须放早退之前——自动压缩
  分支此前会因 `snapshotDoneForCompact` 提前 return），每次压缩前写一条
  `portable/memory/logs/compact-payback.jsonl`。**整段 try/catch：观察失败绝不影响压缩。**
- 日报接上：`daily-health.mjs` 读该日志并输出新字段 **`压缩回本=p50=<轮数>/n=<条数>`**。

**能力地板**：`tsc` / `vitest`（含新增 11 项）/ `check-features` / `check-conventions` /
`check-dead-exports` / `golden`。
**效率指标**：本项**只建立测量**（还没有可比较的"优化前后"）——但给出了第一个可比较的客观数
（回本 60 轮 vs 无缓存溢价 2 轮），并让日报每天给出真实会话的 p50 回本轮数。

**测试抓到的真实缺陷**：`missPremium: NaN` 会一路污染 `rewriteCostTokens` 与 `paybackTurns`
（`Number.isFinite` 变 false）。原因是 `missPremium` 的合法值包含 0，不能用"必须 > 0"的通用正数守卫。
已加显式有限性检查——**这是先写测试再跑出来的，不是我读代码看出来的**。

**下一步（需要用户点头）**：积累几天 `压缩回本` 数据后，若 p50 回本轮数明显大于实际剩余轮次，
再考虑让回本判定参与压缩阈值。**在那之前不动默认阈值。**

### P5 实施结果（2026-10-08）

**先说一个有利前提**：第 19/20 步**本来就默认跳过**（`PI_GOLDEN_SCENARIO=1` 才跑，理由原本是连接时长
约束）。也就是说"留出集"这个性质**已经存在**，P5 要做的是**给它命名、把纪律写死、并让它在最需要被看见的
那一刻可见**——而不是新造一套机制。

**四处改动**：
1. `scripts/README.md`：新增 `### 留出集（held-out）：第 19/20 步开发期间不看`（**权威定义**）——
   含四条纪律：开发期间不看结果；只在验收时用 `PI_GOLDEN_SCENARIO=1` 跑；**绝不为了让它们通过而修改
   留出集本身**（有正当理由须在 DECISIONS 留档并说明为何不算作弊）；本地开发用 `--fast` + 定向 vitest。
2. `STRUCTURE.md` 与 `docs/FAQ.md`：在 golden 说明处各加一句指针（**保持 "20 步" 字样不变**，
   因为 `check-conventions.sh` 第 D 节会拿它与 `golden-tasks.sh` 的实际步数对账）。
3. `scripts/golden-tasks.sh`：在第 19/20 步**真正开跑的那一刻**打印
   `⚠ 留出集：开发期间不应查看本步结果，只在验收时跑`。用 `echo` 而不是 `step` ——
   **不能新增 step，否则第 D 节的步数对账会红**。
4. 交付说明（本文件 + DECISIONS + PROGRESS）。

**能力地板**：`tsc` / `vitest` / `check-features`（含文档链接扫描与步数对账）/ `check-conventions`
（第 D 节：脚本数、步数、台账行数）/ `check-dead-exports` / `golden --fast`。

**"效率指标"在本项是"可验证的性质"**（本项买的是证据强度，方案里已写明不追效率）：实测常规开发路径
`bash scripts/golden-tasks.sh --fast` —— 第 19/20 步都落在 `skip`，**留出集提醒出现 0 次** ⇒
"开发期间看不见留出集"这条性质在当前工具链下**成立且可核对**，不依赖人的自觉。

### P7 实施结果（2026-10-08）

**侦察时的关键发现：不要另起一套。** my-pi 的 `context/budget/tool-health.ts` 里已经有
`updateFailStreak`（**按工具名**的连续失败熔断，第 3 次给一次提示）与 `dehydrateErrorOutput`
（错误输出确定性脱水）。所以 P7 做成**互补而非替换**：

| | 判据 | 语义 |
|---|---|---|
| 既有熔断 | **工具名**连续失败 | "同一个工具连续失败 3 次"（可能每次错因不同） |
| **P7 修复预算** | **错误指纹**（跨不同参数） | "同一个错误出现 3 次，期间换过 M 组参数仍失败" |

**后者才是真打转的信号**：换参数无效说明问题不在参数上。既有的按名熔断**一个字没动**
（它的阈值与键都被依赖，改它属于改默认行为）。

**实现**（都加在 `tool-health.ts`，因为"工具健康度/失败逻辑"本就归它）：
- `normalizeErrorForFingerprint(text)`：去掉 ANSI、绝对路径/家目录、UUID 与长十六进制、耗时、
  行号列号、其余独立数字，空白折叠。**只用于指纹，不改给模型看的原文。**
- `errorFingerprint(toolName, text)` → `{key: "bash:1a2b", excerpt}`（excerpt 截 160 字符）。
- `createRepairBudget()` / `observeRepairAttempt(state, {toolName, errorText, argKey, nowMs?, windowMs?})`
  → `{attempts, distinctArgs, remind, excerpt}`；阈值 `REPAIR_BUDGET_AT = {3,5,8}`、
  滑窗 `REPAIR_WINDOW_MS = 15min`（窗口外的旧指纹丢弃——打转是短时间内的事）。
  `argKey` 复用 `repeat-reminder.ts` 的 `stableKey(input)`（**统一一份稳定键实现**，不再写第二份）。
- `repairBudgetHint(o)`：给出"同一错误已 N 次 + 换过 M 组参数"两个可操作事实，并明确"不要原样重试"。
- 接线在 `context/index.ts` 的 `tool_result`（那里才有错误文本）：与既有熔断**同一通道**追加提示，
  `e.isError` 为真才计，整段 `try/catch`（fail-open）。
  **没有引入新的消息类型**——复用工具结果尾部提示这条既有通道。

**能力地板**：`tsc` / `vitest` / `check-features` / `check-conventions` / `check-dead-exports` / `golden`。
**守门**：`context/__tests__/error-fingerprint.test.ts` **15 项**，重点是归一化的**两个方向**：
① 路径/行号列号/耗时/哈希/UUID/ANSI 不同 ⇒ **同一指纹**（否则永远不触发，等于没做）；
② 不同 errno、不同目标模块、不同工具 ⇒ **不同指纹**（合并不同错误比不提醒更糟）。
另测：跨参数计数与 distinctArgs、同参数 distinctArgs 保持 1、不同错误互不污染、滑窗外重置、提示文案。

**效率指标**：本项是"打断打转"的**预防**型改动，没有可比较的前后数字。可核对的行为事实是
**只提醒不阻塞**（总是 `out += hint`，从不阻断工具结果），且既有熔断行为完全未变（既有测试全绿）。
