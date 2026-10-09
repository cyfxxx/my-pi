# 休眠机制审计（P4）：启用、删除，还是保留并说明

> 2026-10-08。对照 SoL-Pi 的三条发现制定：
> C13 *"Disable dormant mechanisms at configuration time"*、C24 *"Gate ObservationPack by expected
> lifetime value"*、M24 *"Gate V2 candidates on consumption, dormant behavior, and distribution shift"*。
>
> **方向与我此前的倾向相反**：我前几轮一直在纠结"要不要打开 `TOOL_LAYERING`"，而 SoL-Pi 的结论是
> **长期不被消费的机制应该在配置期就关掉/去掉，而不是留着**。这份审计按后者的标准做。
>
> **本文只审计与提案：不删任何东西、不改任何默认。** 按方案第 1 节的边界，删除动作留给用户点头。

## 一、消费证据的来源（先说明判据，避免拿过期数据当结论）

- 30 天工具调用分布：`portable/memory/stats/tool-count-localhost.json`（窗口 30 天，**1920 次调用 / 71 个工具**）；
- 仓库自带的"未接线"清单：`scripts/dead-exports-allowlist.txt`（A 有意保留 / B 测试辅助 / C 待清理）；
- 代码里的默认值与环境开关。

**一个重要口径提醒**：`tool_search` 在 30 天窗口里是 **0 次**，但它是**上一轮（P0/P1 那批）才被我启用**的
（`settings.json` 的 `defaultTools` 加 `+tool_search`）。**0 次是"尚未有机会被用"，不是"已被证明没用"**——
下面凡涉及它的结论都按这个口径写。

## 二、清单

### A. 代码级未接线（`dead-exports-allowlist.txt` 的 A 段，共 18 条）

| 条目 | 存在理由（清单原文要点） | 消费证据 | 建议 |
|---|---|---|---|
| `filterInjectedMessages` / `isInjectionBlock` | 注入 append-only 不变量；**生产路径禁止调用**（有回归测试断言 index.ts 不含该调用） | 被**测试**消费 | **保留**（这是守门的反面锚点，删了会削弱不变量） |
| `MIN_TAIL_LENGTH` | 暖前缀重放受**上游事件限制**，当前是死代码（补丁点已注明） | 无 | **保留**（阻塞在上游，不是我们的取舍） |
| `resolveAndApply` / `mergeCandidates` | 记忆合并的落地入口（迁移资产） | 无（生产只用 jaccard 去重） | **保留**，但这是"接线需产品决策"——**建议尽快决策**（要么接、要么删） |
| `DEFAULT_JUDGE_PROMPT` / `recordVerification` / `parseJudgeScores` / `shouldVerify` / `ProgressTracker` | Best-of-N LLM judge **未迁移** | 无 | **建议删除或接线二选一**（5 条同属一个未迁移子系统，长期挂着没有价值） |
| `compactJson` / `jsonBytes` / `shrinkHalf` | JSON 结构性压缩；R4 截断目前统一走 head+tail | 无 | **建议删除或接线二选一**（"先定哪些输出按 JSON 压缩"这个前提一直没定） |
| `getTokenPressureTag` / `getUrgencyHint` / `setTotalBudget` / `recordCacheUsage` / `registerHooks` | 标注为"公共 API / 查询 API" | 无（被其它机制取代：压力提示自行组装、缓存用量由 footer 统计） | **保留**（公共 API 属性），但 `getUrgencyHint`/`setTotalBudget` **从未接线**，属"挂着的能力" |

### B. 测试辅助（4 条 + 我误放的 1 条）

`validateGroups`、`__resetSeedCache`、`resetSendGuards`、`resetWhisperHealthCache` —— 正常，保留。

**本次修正一处分类错误**：我上一轮加的 `__setPoolFactoryForTest` 被**追加到了 C 段（待清理存量）**，
而它本质是**测试辅助（B 段）**。已移到 B 段。C 段因此**清空**（段头注释说"下列历史条目暂缺理由"，
实际历史条目已清理完毕，只剩我这条被误放）。

### C. 配置级休眠（环境开关 / 默认关闭）

| 机制 | 默认 | 消费证据 | 建议 |
|---|---|---|---|
| **`TOOL_LAYERING` + `tool-groups.ts` 休眠组 + `enable_tool`** | **关**（`enable_tool` 仅在开启时注册） | 30 天里 **`enable_tool` 8 次** ⇒ **历史上开过、现在关着** | **需要明确决策**：要么按 SoL-Pi 的 C13 **删掉这套休眠组机制**（连同 `enable_tool`、`tool-groups.ts`、相关测试），要么**打开它**。**长期"关着但留着"是最差状态**——它维护成本持续存在（`tool-groups.ts` 的组名单要与工具面同步），却没有任何收益 |
| `codemode`（pi 内置，未激活） | 未激活 | 30 天 **0 次** | **保留**（上游能力，激活只需 `defaultTools` 加一项；不属于我们的维护面） |
| `tool_search` | **已启用**（上轮加的 `+tool_search`） | 30 天 0 次，**但启用后才有效** | **保留**（`deferred` 的 browser 18 个工具靠它按需拉出；这是新机制，需要时间累积数据） |
| `DEFAULT_OFF_FEATURES = {voice, link}` | 关 | `voice_transcribe` 2 / `link_status` 2（窗口内、当时开着） | **保留**（注册有副作用：whisper 服务 / 入站通道；且用户明确要求默认关） |
| `browser`（18 工具 `deferred`） | 注册但不声明 | `browser_*` 28 次调用**全挤在 1 天内**，此后 10 天 0 次 | **保留**（已按"默认不占前缀、要用时 `tool_search`"处理） |

## 三、结论与建议（按"先做哪个"排序）

1. **`TOOL_LAYERING` 必须二选一**（最高优先）。它是"关着但留着"的典型：`enable_tool` 历史上被调用过 8 次
   说明它曾是有意开启的能力，而现在默认关——**要么承认它没用并删除整套机制，要么承认它有用并打开**。
   保持现状等于长期付维护成本（`tool-groups.ts` 与工具面同步）却没有收益。
   **我的倾向**：这台机器上工具面已经被 `deferred`（browser）+ `DEFAULT_OFF_FEATURES`（voice/link）解决，
   `TOOL_LAYERING` 的功能与之重叠且更复杂 ⇒ **倾向删除**。但这是削减能力，**留给用户决策**。
2. **两个"未迁移子系统"应尽快二选一**：Best-of-N judge（5 条）与 JSON 结构性压缩（3 条）。
   它们各自成体系地挂着，**要么接线、要么删除**；继续挂着只是让清单腐烂。
3. **`resolveAndApply`/`mergeCandidates`（记忆合并）**：同样标注"需产品决策"——建议一并决策。
4. **保留并说明的**：`filterInjectedMessages`/`isInjectionBlock`（守门锚点）、`MIN_TAIL_LENGTH`（阻塞在上游）、
   budget/adapters 的公共 API。这些**不是休眠**，是**有意保留**，审计的作用就是把"有意"与"忘了"分开。
5. **需要注意的口径**：`tool_search` 的 0 次**不能**当"没用"的证据（它刚启用）；
   相反 `enable_tool` 的 8 次是**历史消费证据**，说明 `TOOL_LAYERING` 并非"从来没人用"。

## 四、本次的实测数字（本项的"效率指标"）

- 未接线清单规模：**A 段 18 条 + B 段 4 条 + C 段 1 条（我误放的，已移正）**；
- 其中**同属一个未迁移子系统**的成组条目：Best-of-N **5 条**、JSON 压缩 **3 条**、
  记忆合并 **2 条** ⇒ **10/18（56%）的"有意保留"其实是"未决策"**；
- 配置级休眠机制：**2 个真休眠**（`TOOL_LAYERING` 关着、`codemode` 未激活）+ **1 个新启用待观察**（`tool_search`）
  + 2 个按用户口径关闭（voice/link）；
- 休眠机制的历史消费证据：`enable_tool` **8 次**（说明 `TOOL_LAYERING` 曾被使用）。

**能力地板**：`tsc` / `vitest` / `check-features`（文档链接）/ `check-conventions`（第 D 节）/
`check-dead-exports`（白名单分类移动后必须仍通过）/ `golden`。本项**无代码行为变更**，仅一处清单分类修正。

## 五、执行结果（2026-10-08）：`TOOL_LAYERING` 已删除

用户授权"由你决定"。**判断：删除。** 依据（按分量排序）：

1. **仓库自己就算过这笔账，且结论是不划算**。`task-gate.ts` 的注释里留着一次 2026-09-26 的成本审计：
   按保守上限（休眠 schema 20K token、上下文 250K）算，让休眠组 schema 常驻，100 个请求共约 **$0.006**；
   而**一次**会话中途 `enable_tool` 就要 **$0.0375** —— **约 6 倍**。它还写了"只有『从不使用休眠组、
   且会话极长』的场景才需要重新打开"。换言之：这个机制**从一开始就站在亏的那一边**，
   留着它只是留着一个"考古开关"。
2. **它要解决的问题已被 pi 原生的 `deferred` 更好地解决**。需要"不进前缀"的最大一块是 `browser` 的
   18 个工具（6_442B）——现在它们 **0 前缀字节**，由 `tool_search`（BM25）按需拉出，
   **不需要组名单、不需要 `enable_tool`、不需要维护"哪些工具属于哪一组"**。
3. **它的 wake 路径正是我们全年最贵的那类操作**：工具段变化 ⇒ 整段前缀失效（实测单次 140K–250K 全价重算）。
   我这一批的 P2 量化过：那次会话 259,833 未命中里 **60.8% 只来自 2 次前缀翻转**。
4. **休眠 + 消费极低**：默认关闭；30 天里 `enable_tool` 仅 **8 次**调用。按 SoL-Pi 的 M24/C24
   （按消费与休眠情况设门）它不该留着。
5. **维护成本持续**：340 行代码 + 一份**必须与工具面同步**的组名单（10 个组、覆盖 ~39 个工具），
   而组里已经出现过"指向不存在的工具"的情况（`voice`/`link` 组对应的工具已因
   `DEFAULT_OFF_FEATURES` 而根本不注册）。

**删除范围（一并完成）**：`budget/tool-groups.ts`、`budget/tool-layering.ts`、`TOOL_LAYERING` 开关、
`enable_tool` 工具、`/tools enable` 子命令与补全、`before_agent_start` 里的分层自愈、
`volatileText` 里的休眠组摘要、`logic.ts` 的再导出、3 个测试文件、白名单里的 `validateGroups`；
注册面基线重生成（工具 63 → **62**）。`/tools list` 保留但简化为"报告活跃/已注册工具"。

**保留的知识**（删代码不等于删认知）：上面第 1 条的盈亏平衡账、以及"工具集变化 = 整段前缀失效"
这两条结论仍然有效，已改指向**激活 `deferred` 工具（`tool_search`）**这条依然存在的断裂源。
