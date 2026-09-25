# 上下文管理系统对比：my-pi vs DeepSeek Harness

> 目的：对照两个 agent 的上下文/预算管理机制，找出 my-pi 可优化项。
> DSH 侧的原始证据见 [DSH-CONTEXT-AUDIT.md](DSH-CONTEXT-AUDIT.md)（逐条 `file:line` 引用）。
> my-pi 侧数据来自 2026-09-24 的真实 10 小时会话（`portable/memory/context/.usage-diag.jsonl`
> 与 `portable/agent/sessions/--root-my-pi--/2026-09-24T13-47-52-620Z_*.jsonl`）。

## 一、结论摘要

| 维度 | DSH | my-pi（本轮优化前） | my-pi（本轮优化后） |
|------|-----|--------------------|--------------------|
| 自动压缩触发 | **0.8 × 窗口**（1e6 → 800K），实测从不触发 | 绝对 **256K**，因门3 恒假**也从未触发** | 256K，门3 默认关闭 → **会触发** |
| 历史 thinking 回收 | 无专用机制 | `pruneThinkingBudget` 已实现但**未接线** | ✅ 已接线（保留 64K） |
| 旧工具输出回收 | 8,192 字符中段裁剪，**仅在压缩触发后才跑** | `pruneToolResults` 阈值 120K/80K，实测**从未触发** | ✅ 阈值降至 60K/30K，**每次请求都跑** |
| 写入时截断+归档 | spill >50KB 落盘 + 路径，**可读回**，`read` 豁免 | 单次 5K + **全会话 20K**，用完后一律 300 token，`read` 也被压 → 归档形同虚设 | ✅ `read` 豁免会话预算，归档可读回 |
| 压缩摘要的缓存复用 | 摘要调用**重放前缀**，命中 KV 缓存 | `warm-prefix` 已有实现但因上游事件不覆盖压缩路径而**是死代码** | ⚠ 仍未修（需上游补丁） |
| system prompt 变动 | `in-history` 路由**追加到缓存历史之后** | 每轮重写 system prompt（含 sleeping summary/压力档） | ✅ 易变段移出 system prompt（转为 append-only 消息），并加运行时前缀指纹做归因 |
| 逐请求用量记账 | `inputTokens`（未命中）/`cacheReadTokens`/`cacheWriteTokens`/`reasoningTokens`，**无货币成本** | 同维度 + **¥ 成本** + 命中率 + `/usage-diag` | ✅ 领先 |
| 子代理上下文 | fork（继承历史、复用 KV）与 spawn（空）两种 | 仅 spawn（`--no-session --no-extensions`） | ⚠ 缺 fork 模式 |

一句话：**DSH 的默认策略是"几乎不压缩、靠窗口大 + 可恢复 spill"；my-pi 的策略是"早压缩 + 多层确定性擦除"。my-pi 的擦除层写好了却大半没生效，这是本轮的主要修复点。**

## 二、实测：my-pi 那个 10 小时会话的上下文构成

| 类别 | token（估算） | 占比 |
|------|--------------|------|
| `assistant:thinking` | 155,142 | **50.1%** |
| `toolResult:text` | 143,410 | **46.3%** |
| `assistant:text` | 10,950 | 3.5% |
| `user:text` | 389 | 0.1% |
| 合计 | ~309,891 |（pi 上报 341,416） |

关键事实：

- **一半上下文是历史 thinking 块**（444 块），而专门回收它的 `pruneThinkingBudget` 从未被调用。
- 工具输出占 46%，但 `pruneToolResults` 因保护带 120K + 最低回收 80K 过高而**从未触发**（该会话 `[pruned:` 出现 0 次）。
- 写入时截断却触发了 **308 次**（562 条工具输出里），且会话后期工具输出均值仅 155 token——说明回收压力全落在"有损的写入时截断"上，而不是"免费的事后擦除"上。

## 三、本轮已实施的优化（均已验证）

### O1 — 接通 thinking 擦除（收益最大，零 LLM 成本）

- `context` 钩子在工具擦除之后调用 `pruneThinkingBudget(working, KEEP_THINKING_TOKENS)`。
- 默认保留最近 **64K** thinking，更早的删除；`PI_CONTEXT_KEEP_THINKING_TOKENS` 可调。
- 依据：该会话 thinking 155K → 64K，可回收 **~91K（占上下文 ~29%）**，且不产生任何 LLM 调用。

### O2 — 下调工具输出擦除阈值（零 LLM 成本）

- `PRUNE_PROTECT_TOKENS` 120K → **60K**、`PRUNE_MINIMUM_TOKENS` 80K → **30K**；
  `PI_CONTEXT_PRUNE_PROTECT_TOKENS` / `PI_CONTEXT_PRUNE_MINIMUM_TOKENS` 可调。
- 依据：原阈值在真实长会话中从未触发；写入时截断已把单条输出压小，旧输出总量难以越过保护带。
- 擦除比压缩便宜：**同样断裂一次前缀缓存，但擦除不产生 LLM 调用**，压缩要发一次全价摘要请求。因此顺序应为"先擦除、后压缩"。

### O3 — 修复归档"可读回"被击穿（正确性）

- 问题：`read` 也受全会话 20K 输出预算约束，预算耗尽后每次 read 只剩 300 token →
  `output-archive` 承诺的"凭占位符路径读回原文"**在长会话后期失效**。
- 修复：`read` 豁免会话累计预算，只受单次 5K token 上限约束（与 DSH spill 排除 `read` 的做法一致）。
- 另加 `PI_CONTEXT_OUTPUT_BUDGET_TOKENS` 便于调参。

### O4 — 压力分档改以压缩阈值为基准（逻辑脱节）

- 问题：`setCompactThreshold` **存在但从未被调用**，压力分档（0.7/0.85/0.95）一直以**窗口**为分母。
  窗口 1M 而压缩阈值 256K 时高档是 850K —— 模型在压缩前**永远收不到预警**。
- 修复：`before_agent_start` 计算并写入压缩阈值；`getBudgetReport` 新增 `budgetBase`/`pressureRatio`，
  0.7/0.85/0.95 改为相对**压缩阈值**；`/context usage` 同时显示窗口占比与阈值占比。
  现在用量达阈值 90% 即报 `high`。

### O5 — 归档目录加清理（磁盘泄漏）

- 问题：`tool-outputs` 归档目录**没有任何清理**（实测已 442 文件 / 2.8MB 且无上限），
  只有 `prune-refs` 有 14 天/50MB 的 sweep。
- 修复：新增 `sweepArchive`（递归两层、按 14 天 / 200MB，保留窗口比 prune-refs 宽），
  `session_start` 时与 prune-refs sweep 一起执行。

### O6 — 截断改为"头+尾"保留（信息完整度）

- 问题：写入时截断只保留**头部**，而命令/测试的错误与结论通常在**尾部**。
- 修复：`truncateHeadTail`（头 40% / 尾 60%，中间省略标记），与 DSH spill 的 head/tail 预览同思路。

### O7 — 易变运行时提示移出 system prompt（防整段缓存失效）

- 问题：`before_agent_start` 把压力档文案、休眠工具摘要、重启提示都追加进 **system prompt**（前缀最前处）。
  这些内容会变化（O4 修好后压力档在阈值 75%/90% 处变化；工具集变化时摘要变化），
  一旦变化即**整段缓存失效**——与该会话中 6 次 170K–316K 全价重算一致。
- 修复：system prompt 只追加**静态常量** `EFFICIENCY_ADVICE`（逐字节稳定）；
  易变段改为一条 `my-pi-context-advice` 消息，**仅在内容变化时追加**（append-only，不删除旧的），
  变化点落在尾部，只影响其后的少量 token。对齐 DSH 的 "system 在历史节点 0 + change-only volatile context"。
- 实测：headless 冒烟中消息数 3 → 4（多出易变提示消息），`system` 指纹不再包含易变段。

**实测效果（用真实会话消息序列忠实复刻两套擦除算法）**：

| | 优化前 | 优化后 |
|---|---|---|
| thinking | 155,142 | 63,883（保留 64K） |
| 其它文本（含工具输出） | 154,749 | 79,966（擦除 248 条 / 回收 75,279） |
| **合计** | **309,891** | **143,849（-53.6%）** |

即约 **-54% 的稳态上下文**，且**零额外 LLM 调用**；折算到成本模型相当于每请求省掉一半的 prompt 计费。
O7 另把"整段缓存失效"的风险面从 system prompt 收窄到消息尾部（上一轮测得的整段失效占额外费用 33%）。

验证：`tsc` 通过；vitest **44 文件 514 用例**；`golden-tasks.sh` 十一项全绿（`--smoke` 时十二项）；
新增用例覆盖 `truncateHeadTail`/`tailByTokens`、`sweepArchive`（按龄/按量）、`read` 预算豁免、
压力基准（阈值分母 + 未设阈值回退窗口）、指纹 `sinceLastMs`、以及新擦除阈值下的默认行为。

## 四、仍可优化项（按收益排序）

### P1 — 压缩摘要的暖前缀重放仍是死代码（需上游补丁）

- DSH 的摘要调用**逐字重放 system+tools+region**，让辅助调用命中 KV 缓存；my-pi 的
  `budget/warm-prefix.ts` 想做同一件事，但挂在 `before_provider_request` 上，而 pi 的压缩路径
  （`agent-session._runDefaultCompaction` → `completeSummarization` → `agent.streamFunction`）
  **不经过 Agent 的 `onPayload`** → `isSummarizationMessage` 分支永不执行。
- 已确认补丁点很小：`core/sdk.ts` 的 `buildRequestOptions` 返回值加 `onPayload: transformProviderPayload`
  （压缩与主循环共用同一个 `streamFn`）。但需要新增 `patches/007-*` 并重建 dist，且改的是关键路径。
- 收益已下降：擦除生效后压缩很少触发；每次压缩省约 $0.065。
- 建议：暂不动 vendor；若后续压缩频繁，再打该补丁，或删除死代码并明确标注。

### P2 — 子代理缺 fork 模式

- my-pi 的 subagent 一律 `--no-session --no-extensions` 起子进程（等价 spawn，空上下文）。
- DSH 提供 fork：子代理继承父会话历史，并**特意保持 provider/model 以复用 KV 缓存**；只有最终消息回传。
- 做法：pi 有 `session_before_fork` 事件，可在 subagent 增加 `fork: true` 选项，
  让"审查我的改动/接着做"这类委派复用父前缀缓存。

### P3 — 压缩阈值与保留量的取舍

- 当前 256K（1M 窗口的 25.6%），DSH 是 800K（80%）。回放估算：阈值 256K 比不压缩省 ~61%，
  150K 可省 ~72%。但**这是在本轮擦除修复之前**测的——擦除生效后稳态上下文已显著下降，
  压缩很可能很少触发。
- 建议：先观察 `/context usage` 与指纹日志；若压缩仍频繁，再把 `PI_CONTEXT_ABSOLUTE_TOKENS`
  降到 150K 左右，而不是现在改默认值。

### P4 — 其余可选

- `grep`/`bash` 等大输出已有归档路径；可参照 DSH 为 `read` 之外的高风险工具设更明确的
  单次上限与"head/tail + 路径"预览格式，减少一次性灌入（head/tail 已实现）。
- 每请求都跑 `pruneToolResults`/`pruneThinkingBudget`，需对全部消息做 token 估算（大上下文下有 CPU 开销）。
  可加"上下文低于某下限则跳过"的廉价前置判断。
- DSH 的 `agent-instructions` 对超大 AGENTS.md 采取**整份忽略**（>1MB/source）而非截断；
  my-pi 基线实测仅 ~10.4K token，暂无必要。
- 两边都没有缓存 TTL 逻辑；my-pi 的空闲超时全量未命中已可由指纹日志归因。

## 五、设计取舍小结

- **DSH**：把压缩当"安全网"（阈值 80% 窗口，实测不触发），靠大窗口 + 可恢复 spill + 缓存友好构造
  （system 在历史节点 0、变更追加、摘要重放前缀、fork 复用 KV）控成本。优点是信息不丢、抖动小；
  代价是每个请求都按大上下文计费（该会话均值 182K）。
- **my-pi**：把确定性擦除当主力（保护带 + 占位符 + 归档可读回），压缩当兜底。优点是**零 LLM 成本**、
  可控；代价是擦除会断裂前缀缓存、且实现若不生效会静默退化为"有损截断 + 大上下文"。
  本轮修复正是让这套设计从"写着但没生效"变成"真正生效"。

## 六、价目修正与优先级重排（重要更正）

前几轮的成本估算用了 `cacheRead = input/10` 的假设。核对 `portable/agent/models.json` 的
`modelOverrides.deepseek-flash.cost`（footer 实际使用、且 `provider-composer` 确认 override 会生效）后，
真实价目是：

| 项 | 单价（$ / M token） | 相对 input |
|---|---|---|
| input（未命中） | 0.15 | 1x |
| cacheRead（命中） | **0.003** | **1/50** |
| output（含 reasoning） | 0.60 | 4x |

用正确价目重算同一组对照：

| | harness | my-pi | 比 |
|---|---|---|---|
| 未命中 input | 205,456 | 1,167,949 | 5.7x |
| 命中 cacheRead | 23,548,416 | 41,872,000 | 1.78x |
| 输出+推理 | 136,697 | 178,807 | 1.31x |
| **费用** | **$0.184** | **$0.408** | **2.22x** |

**增量分解：未命中 64%、命中上下文 24%、输出 11%。**

由此产生三点修正：

1. **未命中（整段缓存失效）是最大单项（64%）**，而不是"上下文更大"。这与"空闲 >约 3 分钟必失效"
   的实测模式一致（6 次事件吞掉 0.93M 未命中 token ≈ 该项的绝大部分）。
2. **压缩的性价比远低于先前估计**。缓存命中只要 0.003/M，压缩一次 256K 的自身开销约
   `256K × 0.15/M = $0.038`，而它把后续每请求省下的 ~230K 命中 token 折现只有
   `230K × 0.003/M = $0.0007/请求` → **回本需要约 55 个后续请求**。
   先前"压缩可省 61%"是按 1/10 比例算的，**该结论作废**。现在的正确表述是：
   擦除（免费）是主力，压缩只在高阈值/长会话下才划算。
3. **擦除的收益依然成立**：把上下文压到 -53.6% 后，未命中与命中同步下降 →
   该会话费用约 **$0.408 → $0.247（-40%）**，相对 harness 由 **2.22x 降到约 1.35x**。
   由于擦除零 LLM 成本，它不依赖任何回本计算，是确定的正收益。

因此优先级排序修正为：**① 消除/缩小整段失效 → ② 免费擦除压小上下文 → ③ 控制输出/推理（占修正后成本约 43%）→ ④ 压缩（保守）**。
第 ① 项的运行时归因已就绪：指纹记录新增 `sinceLastMs`（距上一条请求的间隔），下次出现整段失效时可直接判定
"是否空闲后失效 + 变化段是 system/tools/head"。

## 相关

- [DSH-CONTEXT-AUDIT.md](DSH-CONTEXT-AUDIT.md)：DSH 侧逐条证据
- [MIGRATION-AUDIT.md](MIGRATION-AUDIT.md)：pi-tools → my-pi 迁移审计
- [custom/features/context/README.md](../../custom/features/context/README.md)：my-pi 上下文功能与门限说明
