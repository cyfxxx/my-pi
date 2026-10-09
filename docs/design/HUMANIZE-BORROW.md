# Humanize 借鉴分析（arXiv:2610.08900）

> 以 **my-pi（`/root/my-pi`）** 为视角的分析。结论先行、每个 my-pi 事实都带来源、抓不到的明确标"未读到"。

## 0. 阅读边界（先说清，免得把推断当事实）

| 源 | 结果 |
|---|---|
| 论文摘要页 `arxiv.org/abs/2610.08900` | **读到**（HTTP 200） |
| 论文 HTML v1 `arxiv.org/html/2610.08900v1` | **不可用**：404，"No HTML for '2610.08900v1'" |
| 论文 HTML v2 `arxiv.org/html/2610.08900v2` | **读到**（HTTP 200）：§1–§9 基本读全，页面在末尾致谢处截断（附录 A/B 的正文**未读到**） |
| 论文 PDF `arxiv.org/pdf/2610.08900` | **不可读**：`unsupported content type "application/pdf"` |
| 项目页 `humanfia.ai` | **读到**（HTTP 200，全文） |
| `raw.githubusercontent.com/PolyArch/humanize/main/README.md` | **不可达**：`TypeError: fetch failed` |
| `raw.githubusercontent.com/humanfia/humanize/main/README.md` | **不可达**：同上 |

⇒ **代码一行未读到**。因此凡涉及实现细节（72 道门的清单、plan contract 的字段、评审者提示词、FlowBench 评分口径）**一律标"未读到"**，不做猜测。下方所有论文内容**均来自 HTML v2 的正文**，并尽量给章节名。

## 1. 论文 / 项目页 / 两个代码仓是什么关系（依据论文自述，不是推测）

论文自己写清了三代谱系与两条代码线：

| 对象 | 是什么 | 出处 |
|---|---|---|
| **Humanize（本论文，v2）** | 一个 **Claude Code 插件**；核心循环叫 **RLCR（Ralph-Loop with Codex Review）**；由更早的 Claude Code 方法论插件 **GAAC** 演化而来 | §3 首段、§4 Deployment、§1 贡献列表 |
| **`PolyArch/humanize`** | **论文的代码**（论文代码脚注指向它） | 摘要后的 Code 脚注 |
| **`humanfia/humanize`** | **Humanize2**，论文脚注明说"**in active development**"；§9 说它"**把循环从宿主 CLI 钩子搬进自己的 runtime**"，作者称将另行描述 | Code 脚注、§9 Conclusion、§4 |
| **`humanfia.ai`** | 项目/组织页：把整体拆成**四层 + 一个裁判**（Flows / Runtime / Agents / Applications / FlowBench），并把人类定位为"**驱动你已经登录的 CLI，自己不持 API key**"（列表里**包含 `pi`**，即 my-pi 的上游） | 项目页 |

**所以不是两篇论文**，而是**同一谱系的三代**：GAAC → Humanize（v1，Claude Code 插件，**本论文研究对象**）→ **Humanize2**（独立 runtime，`humanfia/humanize`，论文只说"在开发中"，**本论文没有描述它的设计**）。两个仓**不是并列的两代实现**，而是"论文那代的代码"与"接替者的代码"。**Humanize2 的实现细节我未读到**（README 不可达，论文未展开）。

## 2. 机制（谁做什么、什么被度量）

### 2.1 核心命题与四个原则（§2 Judgement Engineering）

命题：**写代码的 agent 是"自己是否做完"的坏裁判**（模型难以自我纠错、偏好自己的输出、能通过改测试来 reward-hack，§1 引 Huang/Panickssery/Von Arx）。四条原则：

1. **先判计划再判代码**（plan contract 固定目标、验收判据、范围、任务）；
2. **把"建造"与"判断"分开**——builder 每轮以**把主张与证据挂钩**的总结收尾，**另一个模型**决定主张是否成立，**且只有它能宣布完成**；
3. **拆解"完成"这个决定**——对齐评审（主张 vs 计划）与代码评审（diff 缺陷）分开；
4. **按证据而非回合数衡量进展**——停顿就该重审范围/上报/停止；完成的 loop 要**留下教训供后续任务用**。

### 2.2 为什么"换模型"就有效：联合采样（§2.1 Alternating Models as Joint Sampling）

把会话看成仓库状态上的马尔可夫链：单模型时**提议与接受共用一个盲区集**（模型系统性搞错的东西，它也倾向于接受）。Humanize 让**两家供应商的模型交替**：builder `B` 在 reviewer 上一轮 findings 的条件下提议，**reviewer `R` 来自另一家供应商、在全新上下文里**给出 findings。**缺陷存活概率从 `b` 降到 `b·m_R`**；**外部 oracle（证明检查器、测试 harness）再加一个因子 `m_O`**。
- **默认配对：Claude Code 当 builder，Codex 当 reviewer**（gpt-5.5 high effort）。
- **代价写明了**：reviewer 的**假阳性也会进链**，表现为**额外回合**。

### 2.3 三道工程落点（§3 System Design）

**a) 计划即契约（§3.1 Planning as a Contract）**：`gen-idea`（**只读**并行子代理探方向）→ `gen-plan`（**生成计划期间禁止写代码**），Claude 与 Codex 起草/互评**最多三轮**，未决点交给人类。计划内容 = 目标 + **带正反例的验收判据** + 路径边界 + 任务分派。执行前两道检查：**plan-compliance**（拒绝无关计划与切分支指令，否则 loop 记账失效）+ **advisory quiz**（用**两个选择题**问人类计划的机制与架构）——"这点摩擦能把'没看懂就批准'的计划暴露出来"。

**b) 回合协议（§3.2 The Round Protocol）**：回合定义是"**agent 认为整个计划做完了**"；由 **Stop hook** 主持：它提供计划、**goal tracker（不可变段 = 目标 + 验收判据）**、上一轮 findings，并把 builder 指向 **BitLesson**（**按任务挑选相关项目教训**）。builder 交回：commits + **round contract（只命名一个主线目标）** + 变更/证据/未完项总结。reviewer 读计划、近期回合、代码、主张与证据，把 findings 分成**主线缺口 / 阻塞性副作用 / 可排队副作用**，并报主线**advanced / stalled / regressed**；**返回 COMPLETE 要求计划已完成，被推迟的任务算未完成**；hook 解析裁决并转成下一轮提示。**连续两轮 stalled → 触发 drift-recovery**；**每第五轮是一次 Full Alignment Review**（审计全部验收判据），且**只有这些回顾被允许邀请停止 loop**。
终态五个：complete / stop / **maxiter（默认 42 轮）** / cancel / unexpected。complete、maxiter 或 reviewer 要求停之后，**一个分析 agent 把记录回合变成"净化过的"方法论报告**，用户确认两次后可提为 issue——**这份报告就是 §4 的语料来源**。

**c) 72 道机械门（§3.3 Mechanical Gates，附录 A 未读到）**：hook 校验器**阻止 builder 写** state file、计划副本、不可变目标、其他回合的文件；launch review 前检查 summary/lesson delta/task list/commits **是否齐备**，以及 review 输出**是否格式良好**。**分工被写明：门只管"存在与形式"，内容由 reviewer 判。** Stop hook 从 **975 行涨到 2,221 行**。
**独立性靠四样东西保护**：来自另一家供应商、**每次评审一个新进程**、**hook 解析裁决**、**builder 改不了的提示词**；社区贡献的 Codex/Kimi runtime **实现的保护更少**。宿主管线依赖是真风险：**后来的 Codex CLI 版本弄坏了插件的部分功能**。

### 2.4 项目页补充的运行时面（Humanize2 的方向）

**Flows**（一个 flow = 一个目录的 Python：谁轮流、每轮问什么、何时停）｜**Runtime**（开关/恢复会话、**时间/成本/token 三种预算**、worktree/容器/SSH、**把每个回合写在同一个时钟上**并可导出 Chrome trace）｜**Agents**（驱动已登录的 CLI，**自己不持 API key**）｜**Applications**（HOA/KDA/HMA，"指向别人的记分板"）｜**FlowBench**（让各 flow **互相打分**，**胜者成为下一个默认**）。

## 3. 实验与结论强度

**证据形态**：**观察性**，论文三处自述"not a controlled comparison"（§1 末、§4、§8）。**没有**同 builder 开/关 reviewer 的对照跑（§5 明说）。

**部署（§4 Deployment）**：108 天 **68 个版本**；仓库 **1,468 stars**（**61% 在最后一个 release 之后**）、130 forks、34 位作者提过 PR；贡献者补上了 Codex/Kimi runtime、BitLesson、计划精炼、round contract、监控面板。

**postmortem 语料（§4 Postmortem corpus）**：issue tracker 里 **150 个 issue / 52 位作者**，其中 **118 篇真实 loop 的复盘**（113 篇带方法论分析签名）。**用 LLM agent 按 codebook 编码**；与盲编码者的 **Cohen's κ=0.93（回合数）/ 0.79（首要压力）**；最常见的压力是 **artifact state、review tails、scope、convergence，各占 64–73%**。**论文自己声明语料不具代表性**（用户自选、四位报告人写了半数）。

**loop 长度（§4 Loop length）**：有回合数的 93 篇中**中位数 10 轮、最长 87**；**按阶段拆分的 27 篇里，541 轮中有 364 轮（67.3%）落在"实现已被接受之后"的、无轮次上限的 code-review 阶段**；接受之前的停滞停止**全部落在 Full Alignment Review 上**。

**应用（§5，均为"application reports, not controlled comparisons"）**：
- **Loom**（布线 mapper，模拟退火）：契约要求与参考 mapper 的**逐级决策轨迹完全一致**；180s 预算下探索槽位 **97,138 → 227,777（2.34×）**；**四个更快但破坏轨迹等价的候选被回滚**；
- **gem5 构建迁移**：**567 文件 / 133 commits**，SCons → CMake+Ninja + Bazel overlay；作者用完整构建/单测/仿真对象一致性自验，但**上游 CI 未通过、PR 仍待维护者审**——"agent loop 能产出这种规模的改动；**接受它仍是人类的决定**"；
- **KDA**：**KernelWiki**（生产 kernel PR/竞赛提交/文档的检索库）+ **ncu-report-skill**（把 Nsight Compute profile 变成 builder 可行动、reviewer 可核对的证据）；每个 kernel 走**三份计划**（正确性 → 有升速目标的 profile 驱动优化 → shape-aware dispatch）；MLSys 2026 FlashInfer：MoE 第一、DSA 第二、GDN 第三；**队内自报** DSA indexer 19.08×、DSA attention 4.54×、GDN prefill 1.92×；**五个 kernel 里两个仍慢于 baseline**；48 小时 DSA TopK 消融：**只有 loop 3.71× / 加 KernelWiki 6.14× / 再加 profiling skill 8.58×，对手 K-Search 1.37×**；
- **HOA**：IMO 2026 六题全部在 Lean 里证完（两次跑：一次 GPT-5.6 Sol 兼任两角，一次 **Kimi K3 建 + Codex 评**）；IOI 2026 六题由 **Codeforces judge** 给满分；IPhO 30/30；IChO 418.5/437；IBO 2024 100/100 —— **论文自己标注：这些分数是自评的，IBO agent 能看到答案**；
- **PutnamBench 672/672**；**Lean-Eval 旧榜第一**（须过 Comparator），对手含 AxiomProver / Aleph Prover / Aristotle / Seed Prover；
- **"两种独立判断来源"（§5 末 + Figure 6）**：oracle **完整**时（Lean kernel、IOI 的 judge）**一个模型兼两角就够**（`m_O → 0`）；oracle 只部分时靠另一家供应商的 reviewer；**两者都缺时最弱**（自然语言奥赛分是 HOA 自评的估计）。**PutnamBench 复跑里 98 题中 86 题第一轮就过**——即 loop 常常只是"确认第一次尝试"。

**五条发现（§6 Findings）**——最值得抄的一节：
1. **独立评审被信任但昂贵**：**118 篇里 45 篇**描述 builder **宣称做得比实际多**（KDA 也自报同类失败：builder 拿自己第一个 kernel 当 baseline 就宣布完成）；**很少人质疑 reviewer 的裁决，抱怨的是"评审的节奏"**——一轮只给一条 finding 会拖出长尾，且 code reviewer **只看 diff、没有历史记忆**，会一条路一条路地重新发现相关缺陷 ⇒ **"应当批量评审，而不是弱化评审"**（分组相关 findings + 给 reviewer 早期回合的记忆，但**不要**把 builder 的推理喂给它）。
2. **迭代不保证收敛**：评审阶段**无上限**，2/3 回合在被接受之后，**有一例跑到 87 轮（上限 42）**；"advanced" 这种裁决**只有绑到"朝验收判据的可测移动"才有用**（有一篇**每轮都记 advanced，最后 8 条判据一条也没完全满足**）⇒ **终止必须被设计：每个阶段都要有界；停止规则应跟随工作状态而不是固定日程；还需要一条"被阻塞而非失败"的出口**。
3. **计划与范围就是判断边界**：计划太大会同时产生太多义务；判据含糊 ⇒ 停止条件含糊；**"推迟算未完成"这条规则与"故意留活给后面"的计划冲突**；发现应当被**分流**（阻塞项必须说明为什么阻塞已接受的目标；可排队项只记录、不延长 loop；计划修订要显式）。
4. **证据与环境决定终止**：有些会话停住**不是因为实现错，而是证据收不齐**（判据依赖不可用的基础设施、builder 与 reviewer 的环境不一致）⇒ **验证是判断设计的一部分，不是"跑测试的细节"**；稳健的 loop 应**记录环境假设并在收不齐证据时请人类决策**，而不是烧回合。
5. **loop 自己也需要被判断**：方法论分析让报告变得便宜（118 篇里有 **771 条编号建议**），但**没有一条 postmortem 建议与主分支改动有强关联**，而**具体 bug 报告几天内就被修**；**150 个 issue 里 86 个在最后一个 release 之后才来** ⇒ "**一个会评判代码的 loop，也需要一个评判它自己报告的流程**"。

**作者自述局限（§8）**：依赖他人 CLI（README 之后 Codex 的版本弄坏了它）；**只有 Claude Code 插件实现了完整的独立性保护**；终止规则粗糙（轮次上限只约束实现阶段；**只有每第五轮才被邀请停止**；**没有区分"环境阻塞"与"失败"的出口**）；**门只查"存在与形式"，不查内容** ⇒ **格式良好但内容为假的总结必须靠 reviewer 抓**；**状态文件损坏时工具调用校验器 fail open**；code reviewer 只看 diff 无记忆；**对"门触发次数/回合成本"没有任何遥测**；**从未做过受控对照**。

**§7 里对 my-pi 直接相关的一条反面证据**：**跨模型代码评审是非对称的**——在一项受控研究里，**Codex 评 Claude 的草稿（正是 Humanize 的默认配对）在"reviewer 不能跑测试"时是有害的**（Xiang et al. 2026）。**这条必须与 §2.1 的漂亮概率论证一起读**。

## 4. 对照 my-pi（逐条：有 / 部分有 / 没有 + 会话证据）

| Humanize 机制 | 判定 | my-pi 对应物与证据 |
|---|---|---|
| **写者不是裁判** | **有**（本会话刚建） | `goal complete` 的 `verified` **只能来自 harness 实际跑通的检查**（P1，`custom/features/autopilot/store/goal.ts` 三个构造器的结构约束）；`verify:true` 再起**独立上下文的评审子进程**（`custom/features/autopilot/run/goal-verdict.ts`，经 `ctx.executeTool('subagent')`）——端到端探针 `goal-judge-e2e.test.ts` **56.5s 通过**，断言含"评审请求消息数 ≤4 ⇒ 独立上下文" |
| **评审者来自另一家供应商/另一个模型** | **没有** | 评审子代理**继承主会话模型**（`subagent` 支持 per-agent `model`，但没有"评审必须换模型"的约束）；池化度量显示复用正常（`子代理池=复用50.0%(1/2)/起1次`）但**与"独立性"无关** |
| **评审者必须能执行代码** | **部分有 / 未核实** | 评审子代理以 `--no-extensions` 起（P8-A 默认），**pi 内置工具（含 bash）应可用 ⇒ 它能跑命令**；但"评审子代理确实能执行"这一点**未核实**（我们的探针只断言了模型与消息数） |
| **确定性钩子路由、而非模型决定** | **部分有** | `goal` 的续跑由 **`agent_settled`** 驱动（确定性）；**但"下一步做什么/是否进入评审"仍由模型决定** |
| **计划即契约（含正反例验收判据）** | **部分有** | `plan-mode`（`plan_enter`/`plan_exit`）+ `ask_user` + `goal`；**缺"动手前就把验收判据写进契约"**这一半（P1 的 `check` 是**完成时**才给） |
| **计划批准前的两道检查（合规 + quiz）** | **没有** | my-pi 只在注入面前做守门（`check-injection-surface` 基线），**没有"计划是否可判"的检查**，也没有"用两个选择题检验人类是否看懂"这种摩擦 |
| **阶段边界 + 机械门（只管形式）** | **有**（结构同源） | 守门套件：`check-features`/`conventions`/`isolation`/`dead-exports`/`patches-behavior`/`injection-surface`/`doc-links`/`state-audit`/`usage-metrics`/`prepush-scope`/supervisor/books/bootstrap/seed-headless/web-term + 工具面体积守门 + golden 20 步 + **留出集纪律**（P5）；**分工相同**：我们也是"门查形式/结构，内容靠实测与评审" |
| **终止必须被设计（每阶段有界 + 按状态停 + 阻塞出口）** | **部分有（有一条反而更强）** | 有：`goal` 轮次上限（full 256 / 其余 16，`modes.json` 的 `roleplay.goalMaxRounds=12`）、**连续 3 轮无工具调用判受阻**（＝"按状态停"，**这一点比论文的"每第五轮才允许停"更细**）、`createIdleGate`（"宁可晚不可炸"）、bash 前台 240s→后台、子代理 30min；**没有**：按**成本/token**停（这正是论文 runtime 的三预算之一）、**"被环境阻塞"与"失败"的区分** |
| **衡量进展用证据，不用回合数** | **部分有** | my-pi 有实测纪律（"至少一项实测效率指标"、"负结果归档"）与 `daily-health` 连续观测（命中率/未命中每次/`压缩回本`/`子代理池`/`子代理返工`）；但**没有**"验收判据逐条的满足度跟踪"（论文的 Full Alignment Review 做这个） |
| **每轮"主张↔证据"挂钩的总结** | **部分有** | `goal` 的 `evidence` 参数 + `HARD_RULES`（"能自证的改动必须给实测证据"）；**但没有强制的"把主张逐条绑到证据"的产物** |
| **项目教训按任务检索（BitLesson）** | **有（形态不同）** | memory 的 `[solutions]` 条目 + `custom/features/context/budget/skills-catalog.ts`（技能按需注入）+ 本会话新建的 **`docs/INDEX.md`（499 条，`scripts/gen-doc-index.mjs` 生成，`--check` 挂在 `check-conventions.sh` 第 E 节）**；`memory_search` 按需检索 |
| **把复盘变成一等产物** | **有（规模小）** | `docs/BUG-REPLAYS.md`（**16 条，每条带可重跑命令**——这一点**强于**论文的 pattern 页）+ `DECISIONS.md` 的负结果 + **`docs/CHANGES.jsonl`**（`scripts/gen-changes-ledger.mjs` 生成：`type:change` 从 git log、**`type:rejected` 从 `DECISIONS.md` 负结果抽，含 `topic/reason/evidence/source`**） |
| **"报告便宜，但报告不产生改动"（finding 5）** | **部分有，且我们有同款病** | 论文：118 篇 postmortem 的 **771 条建议**与主分支改动**无强关联**，而具体 bug 几天就修。my-pi 同款：本会话里**工具面预算顶格被提 3 次、白名单纪律 2 次**，说明"判断被反复重述、没有变成可查询的结论" |
| **单一时钟（每个回合一个时间线）** | **部分有** | 父会话 jsonl 逐条 `timestamp`；子代理 `usage.jsonl`（**已带 `parentSession`**，本会话所建）⇒ **技术上可 join**；但**没有现成视图** |
| **成本/回合遥测（论文 §8 自认缺失）** | **有（我们领先）** | `.usage-diag.jsonl`（每轮 input/cacheRead/output/reasoning）+ `daily-health`（加权命中率、未命中每次、输出占比…）+ `portable/memory/subagent/usage.jsonl`（含 `cost`）+ 池复用/返工度量。**Humanize §8 明说"对门触发与回合成本没有任何遥测"** —— 这是 my-pi 可以反哺的方向 |
| **前缀缓存/输出"易变性"纪律** | **有（论文未涉及）** | my-pi：`VOLATILE_PATTERNS`（注入文本禁 ISO 日期、`\d{1,2}:\d{2}`、`%`、绝对路径、字节数、commit sha、semver）+ `check-injection-surface` 基线哈希 + append-only 注入纪律 + 前缀指纹；实测那次会话 259,833 未命中里 **60.8% 只来自 2 次 system 段翻转**，加权命中率 96.97%→98.79%。**论文完全没有成本/缓存维度**（§8 自认无遥测）⇒ **这一面是我方优势，不是借鉴来源** |
| **角色扮演/人设与本次主题的关系** | **不构成对应** | my-pi 的 `modes.json`（`full`/`lean`/`roleplay`，人设经 `--append-system-prompt` 注入，`roleplay.goalMaxRounds=12`）是**产品面**；Humanize 是**工程编排面**，论文**未涉及**人设/角色扮演。**唯一相关的接点**是"**注入面的稳定性**"：my-pi 为人设注入被挪到会话启动参数并有守门防漂移 ⇒ **Humanize 的 plan contract 若照搬到 my-pi，必须走"启动期固定 + append-only"，否则会破坏前缀缓存** |
| **FlowBench：flow 互相打分、胜者成为下一个默认** | **没有** | my-pi 的 golden/留出集评的是**改动**，不是**流程**；也没有"自动换默认"的机制（**也不该有**，见 §6） |

## 5. 可借鉴的（按性价比排序；落点/做法/验证/成本/是否改默认）

**1. 评审者换模型 + 要求它能执行（对应 §2.1，论文给了概率论证，我们只差参数与断言）**
- **落点**：`custom/features/autopilot/run/goal-verdict.ts`（`runGoalJudge` 的 `call('subagent', …)` 增加可选 `model`）+ `custom/features/autopilot/index.ts`（`goal` 的 `verify` 路径透传）。
- **做法**：`verify` 增加可选 `verifyModel`；**默认不传 ⇒ 行为完全不变**。文档里写明"评审者应尽量与 builder 不同源"。
- **验证（可重跑）**：扩展现有 `custom/features/autopilot/__tests__/goal-judge-e2e.test.ts`——provider 记录 `body.model`，断言评审请求用的就是指定模型；并**新增一条断言"评审者具备执行能力"**（可按其请求里的工具声明判断）。
- **成本/风险**：一次子代理调用按所选模型计价；**风险来自论文 §7 的反面证据**（reviewer 不能跑测试时跨模型评审有害）⇒ 所以"换模型"必须与"能执行"一起做。
- **是否改默认**：**否**（opt-in）。

**2. 把验收判据前移到计划时点（对应 §3.1 "Judge the plan before the code"）**
- **落点**：`custom/features/autopilot/store/goal.ts`（`set` 分支 + `goalStatusText`）、`custom/features/plan-mode/`。
- **做法**：`goal set {objective, check?}` —— 声明目标时就可给判据；`complete` **不带** `check` 时**自动采用契约里的 check**（并在状态文案里显示"契约判据"）。
- **验证（可重跑）**：`custom/features/autopilot/__tests__/goal.test.ts` 家族加行为断言（set 带 check ⇒ complete 采用之；不采用时状态文案能区分）。
- **成本/风险**：纯逻辑改动 + 少量声明字节——**注意声明面已顶格**（进前缀 24 295/25 558 B，删 `verify_*` 后余量 1 263 B），因此**必须复用现有 `check` 参数、不新增参数**。
- **是否改默认**：**否**（不给 check 时行为不变）。

**3. 给"评审/修完阶段"单独的界，并区分"被环境阻塞"与"失败"（对应 §6 finding 2/4，是论文最硬的教训）**
- **落点**：`custom/features/autopilot/store/goal.ts` 的 `decideContinuation`；`custom/features/tmux/`（长任务状态）。
- **做法**：① `goal` 目前只有**单一轮次上限**——增加"**按成本/轮次各有界**"（数据已在 `.usage-diag.jsonl`）以及**"被环境阻塞"这一终态**（`blocked` 目前与"无进展"共用一条路径，语义可细分）；② **默认只记录不接管**（与 P2 压缩回本同一手法：先写日志、日报出字段，攒够数据再由人决定是否接管）。
- **验证（可重跑）**：纯逻辑单测（超预算 ⇒ `capped`；环境阻塞 ⇒ 与失败区分）；日报新增字段的合成夹具照 `scripts/test-usage-metrics.mjs` 的既有模式。
- **成本/风险**：低（纯逻辑 + 观测）；**风险**是"多一个停的条件"会改语义 ⇒ 所以**只记录**。
- **是否改默认**：**否**（观测态）。

**4. 把父子回合并到一条时间线（对应项目页的 one clock；我方可直接做）**
- **落点**：`scripts/daily-health.mjs`（或一个只读脚本）+ 既有 `parentSession` 字段。
- **做法**：用 `usage.jsonl` 的 `parentSession` 与会话 jsonl 的 `timestamp` join，输出"一次委派的时间线"（父子各占多少墙钟、评审花了多久）。
- **验证**：合成夹具（同 `test-usage-metrics.mjs` 模式）。
- **成本/风险**：低；纯观测。
- **是否改默认**：**否**。

**5.（谨慎，需人批准）FlowBench 的"离线版"：让改动/流程被互评，但绝不自动改默认**
- **落点**：新增**离线**分析文档/脚本（**不接任何自动切换**）。
- **做法**：把候选流程（如"是否启用评审""评审换不换模型"）在**同一批真实任务**上离线比较，产出候选与证据，**由人批准**再改默认——这正是本会话已有的"先出分析文档、人批准才动"的节奏（如 `docs/design/TOOL-BUDGET-DECISION.md`）。
- **验证**：产物是文档 + 可重跑命令，不是自动门。
- **成本/风险**：中；**风险**是"自动换默认"的诱惑（论文的 FlowBench 就是自动的）⇒ 明确只做离线。
- **是否改默认**：**否**（且明确禁止自动）。

## 6. 明确不该照搬的，与关键缺口

**不该照搬**：
1. **"另一家供应商的另一个 CLI"这套编排 runtime**：Humanize 的定位是"驱动你已付费的 CLI、自己不持 key"；**my-pi 是 harness 本体**，照搬是换定位，且会与 pi 的扩展/模式模型冲突。**可以借的是"两个模型交替"的判断结构，不是多 CLI 编排**。
2. **108 天 68 个版本 + 975→2,221 行 Stop hook 的演化方式**：论文自曝代价——**后来的 Codex CLI 版本弄坏了插件**、只有 Claude Code 插件有完整保护。my-pi 走的是**vendor 补丁 + 守门基线**的另一条路（`patches/011`、`check-patches-behavior`、注入面基线哈希），**不该为了"门多"而让 hook 无限膨胀**。
3. **"FlowBench：胜者成为下一个默认"**：对 my-pi 就是"自动改默认行为"，直接违反既有边界纪律（"不擅自改默认"）。**只做离线候选 + 人批准**。
4. **"推迟的任务算未完成"这类硬口径直接照搬**：论文自己记录了它与"故意留活给后面"的计划**冲突**（§6 finding 3）；my-pi 的 `goal` 已有独立设计，不该被这条覆盖。
5. **把"门"当内容判据**：论文 §8 明确"门只查存在与形式，格式良好但内容为假的总结必须靠 reviewer 抓"，且**状态文件损坏时校验器 fail open**。my-pi 现有的"门 + 实测"分工不应被"门越多越好"扭曲。

**关键缺口（未读到，决定可不可照搬）**：
1. **72 道门的清单（附录 A）**——**未读到**。没有它就无法判断哪几类算"阶段边界门"（这正是我们最想借的形态）。
2. **plan contract 的字段与"合规检查"的判据（§3.1 的细节）**——只有正文概述。
3. **评审者的提示词与"何时判未完成"的口径**——未读到；我方 `buildGoalJudgePrompt` 想据此校准就只能靠自己。
4. **语料编码的 codebook（附录 B）**——未读到；而 **finding 5 的强度**（771 条建议与主分支改动无强关联）依赖它的编码口径。
5. **Humanize2（`humanfia/humanize`）的实现**——README 不可达、论文只说"在开发中"；**FlowBench 的评分口径与"胜者成为默认"的具体机制也未读到**。项目页只有营销层描述。
6. **论文最大的自认缺口（照抄时要继承这个态度）**：**没有同 builder 开/关 reviewer 的对照**（§5、§8）⇒ 其"独立评审有效"的证据是**观察性**的；而且 §7 给出一条**方向相反的受控证据**（reviewer 不能跑测试时，跨模型评审有害）。

## 7. 可执行的下一步（≤3 条）

1. **评审者换模型 + 必须能执行**（§5.1）：改 `run/goal-verdict.ts` 加可选 `model`、扩 `goal-judge-e2e.test.ts` 断言 `body.model` 与执行能力。**不需要再读论文**（§2.1 + §7 已足够），且**不改默认**。
2. **验收判据前移到 `goal set`**（§5.2）：复用现有 `check` 参数，改 `store/goal.ts` + 单测。**不需要再读论文**；**注意声明面余量只有 1 263 B**。
3. **补读附录 A（72 道门）**：这是唯一能让我们**照着形态挑几类门**的清单；拿到后与 my-pi 现有守门逐条比对，只补"阶段边界"这一类（**不要**追数量）。若附录抓不到（PDF 不可读、HTML 截断），就**放弃这条**，改做 §5.3（终止设计）——它同样不需要附录。
