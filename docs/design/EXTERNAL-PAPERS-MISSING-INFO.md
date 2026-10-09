# 三篇外部材料：补齐"未读到"的部分（2026-10-08）

> 任务：尽量补齐父代理没读到的部分，把"确实拿到了什么"与"仍然拿不到"分开写清。
> **只读 + 只新建本文件**；未改任何其它文件、未做 git 写操作、未跑 golden/vitest。

## ① 一句话结论

**三篇论文的附录与关键机制细节基本全部拿到**（WikiSkill 的写入判据/pattern 规则/Table 3 消融数字、Humanize 的门类别与计划契约/合规判据/codebook、Lean4Agent 的消融/局限/成本），**三个代码仓也全部可达**——**唯一确凿拿不到的是 Humanize"72 道门"的逐条清单**（论文只给类别与计数，代码里也没有集中枚举）。

**关键突破（方法层面，父代理可直接复用）**：`bash` 里网络可用，且 **`arxiv.org/html/<id>v<N>` 全文（含附录）可 curl 下来本地精确抽取**；**GitHub 直连、`raw.githubusercontent`、`statically`、`githack` 全部不可达，但 `cdn.jsdelivr.net/gh/...` 与 `data.jsdelivr.com` 可用**。

---

## ② 分材料明细

### 2.1 WikiSkill（arXiv:2608.27454）

**拿到了什么**（出处：`https://arxiv.org/html/2608.27454v1`，本地抽取按行号定位）

- **§5.1 消融 / Table 3（模型 Gemini-3.5-Flash）**——这是父代理此前只读到小标题的部分：
  - 关闭 **Inference Agent** 的 wiki 访问、让 **Skill Proposer** 有 wiki：平均从 **48.7% → 63.7%（+15.0%）**；
    其中 LiveMath **51.3 → 72.6**、SpreadsheetBench **49.9 → 76.6**。
  - **当 Skill Proposer 已有 wiki 访问时，再给 Inference Agent 开 wiki 访问，平均从 63.7% 降到 60.9%**
    （原文小标题："Wiki access for the Inference Agent during evolution degrades final skill quality"）。
  - **这条"读 wiki 有害"是条件性的**：它只在 Skill Proposer 也有 wiki 访问的那组对照里成立；
    对照的另一端是 48.7（Skill Proposer 无 wiki）。
- **Table 4（知识/技能产出统计）**：按模型给 skill 与 wiki pattern 的 create/edit「proposed / accepted」与平均长度，
  例：Qwen-3.5-4B skills create 3.1/1.6、edit 4.9/1.3、平均 126.2 行；wiki patterns create 8.8、edit 18.4、平均 48.2 行。
  另有「accepted 更新按阶段分布」：早期（Iteration 0–1）占 39%–52%。
- **§5.3 案例（ALFWorld / Qwen-3.6-27B）**——pattern 页与技能的**真实文件名与演进链**：
  Iteration 0 Wiki Maintainer 识别 `take-examine-move-loop.md`；Skill Proposer 提 `goal-directed-action` →
  **被拒**，而 `skill-impact.md` 保留了提案 diff 与拒绝结论（"让后续提案不再重复"）；Iteration 1 据此产出
  `break-repetition-loop`（含具体动作规则 *Never Return an Item to Its Origin Location*）→ **被接受**；
  随后新循环变体出现 → `multi-operation-loop.md`；再细化为 *Each Operation Type ONCE Per Item*。
- **附录 E.2「Wiki Maintainer Agent System Prompt」全文要点（= 写入判据，父代理要的正是这个）**：
  - **wiki 结构**：`wiki/index.md`（每行一个 pattern 的目录）、`wiki/log.md`（按时间记迭代/分数/接受-拒绝）、
    `wiki/skill-impact.md`（试过哪些技能及其结果）、`wiki/patterns/`（**一页一个 pattern，带详细证据与分析**）。
  - **输入**：最新一轮的执行轨迹（含动作、命令、环境反馈）+ 当前 wiki 上下文。
  - **输出（Incremental Edit Mode）**：**一个 JSON**，键为
    `create_patterns`（`[{name:"pattern-name.md", content:"…"}]`，**给全文**）、
    `update_patterns`（`[{name, edits:[…]}]`，**patch 既有页**）、`update_index`（**总是给 index.md 的完整新内容**）。
  - **Pattern Documentation Rules（可操作判据）**：
    ① 每页写四样——**是什么 / 根因（WHY 而非 WHAT）/ 轨迹里的确切命令序列 / 已知解法（含确切语法的动作模式）**；
    ② **成功与失败都要记**；③ **不要建重复 pattern——用新证据更新既有的**；
    ④ **"10–30 行，不是论文"**；⑤ **只记有意义、可泛化的观察**。
  - **索引条目格式与理由**：`- [pattern-name] (wiki/patterns/pattern-name.md): PROBLEM + ROOT CAUSE + FIX`（一到两句；论文原文里 `]` 与 `(` 紧邻，这里为回避本仓的文档链接守门把两者分开），
    必须**具体到"agent 不读全文也能判断相关性"**；提示词明说**索引是最重要的部分**，因为它决定 inference agent 会不会去读全文。
- **作者自述的未来工作/局限（原 §7 区域）**：① 接受判据可以更灵活；② **"WikiSkill 目前没有自动清理 wiki 的机制"**
  ——原文点明"随着知识在更长的演化中累积，这种剪枝可能变得必要"；③ benchmark 不含数百步/数小时级的超长程任务，
  单次长 rollout 内的在线技能适应是未来方向。

**仍然拿不到什么**

- **Figure 3 是图片**：pattern 页的**逐字段样例**无法从图上读；上面 2.1 的"四样内容 + 索引格式"是从附录 E.2 的规则条款得到的
  （我认为这已等价于字段清单，但不是 Figure 3 的原文框）。
- 附录 A/C/D 的细节（抽样预算、分层标准、显著性检验）**我没有抽**——同法可得，若需要请说。

### 2.2 Humanize（arXiv:2610.08900）

**拿到了什么**（出处：`https://arxiv.org/html/2610.08900v2` 附录 A/B；`humanfia.ai`；`cdn.jsdelivr.net/gh/PolyArch/humanize@main/...`）

- **附录 A / Table 1：72 道门按类别**（父代理要的"72 道门"）：
  State integrity **12**（只读 loop 状态；schema/分支/损坏检查）｜Plan and scope protection **11**（setup 期的计划与合规检查；冻结的计划副本与目标）｜
  Round isolation **10**（每轮只写自己的文件；别的轮次不可读）｜Git hygiene **9**（setup 与每次 stop 都要干净树；loop 状态永不提交）｜
  Review protocol **7**（每轮有合法 review 与 verdict；STOP 与 drift 断路器；轮次上限）｜Session hygiene **6**（锁定的分析阶段；禁止直接跑 hook；只有用户能取消）｜
  Artifact presence **5**（初始化过的 goal tracker；每次评审前要有 contract 与 summary）｜Lesson memory **5**（每个 summary 都要有合法的 BitLesson delta）｜
  Environment precondition **4**（Codex、git、base branch 可用）｜Completion discipline **3**（没有未完成的主线/阻塞任务；**不允许变动文件超过 2,000 行**）。
  另：**29 道在工具调用/提示词校验器里**（只有 Claude Code 插件会安装）、**32 道在 Stop hook 里**；**恰好 1 道 fail-open**
  （state 文件损坏时校验器 exit 1，在 Claude Code 里被当作**非阻塞**错误，于是调用继续）。
- **附录 B / Table 2：codebook 与压力分布**：语料 **150 个 issue = 118 篇 postmortem + 32 个其它**；
  编码了 round count（93 篇）、exit（complete 37 / stagnation 21 / maxiter 10 / cancel 7 / drift 1 / 未声明 42）、
  按阶段的轮次切分（27 篇）、**771 条编号建议**；盲编码抽查 30+6 ⇒ **κ = 0.93（轮数）/ 0.82（exit）/ 0.79（主压力）**。
  Table 2（压力｜在运行中观察到｜作为主压力｜κ）：artifact state 86｜3｜0.71；review tail 80｜36｜0.77；
  scope and plan 79｜16｜0.82；convergence 76｜27｜0.70；evidence 58｜19｜0.93；over-claiming 45｜8｜0.93；cost 25｜1。
- **计划契约字段（`skills/humanize-gen-plan/SKILL.md`）**：把草稿转成结构化计划，产出
  **goals + 验收判据（AC-X 格式）+ 路径边界 + 可行性建议**；它是一个 **flow**，带 `validate-gen-plan-io.sh` 做输入/输出校验。
- **plan-compliance 判据（`agents/plan-compliance-checker.md`）**：**两个检查 + 一个判定**——
  **Check A 仓库相关性**（探索 README/CLAUDE.md/目录结构，判断计划是否与本仓相关；**明确要求"宽容"，只拒绝明显无关的**）；
  **Check B 分支切换检测**（RLCR 要求全程同一分支 ⇒ 计划里出现切/建/checkout 分支即判失败；**并列出假阳性豁免**：
  `git checkout -- <file>`、否定式指令、描述性提及分支、`--base-branch` 参数）。
  判定必须**恰好一行**：`PASS: <摘要>` / `FAIL_RELEVANCE: <理由>` / `FAIL_BRANCH_SWITCH: <引用原文>`。
- **代码仓可用**：`PolyArch/humanize` **197 个非 docs 文件**（`agents/`、`commands/`、`hooks/{lib,*.sh,*.py}`、`scripts/{lib,*.sh}`、`skills/*/SKILL.md`、`templates/bitlesson.md`、`.claude-plugin/plugin.json`）；
  `humanfia/humanize`（Humanize2）= **0.1.0-beta.2，499 个非 docs 文件**，含 `specs/coganchor/*`；
  README 分别 4302 / 1810 字节。

**仍然拿不到什么**

- **72 道门的逐条清单拿不到，而且是"结构上拿不到"**：论文只给类别与计数（Table 1），
  代码里也没有一份"72 条"的枚举——`scripts/rlcr-stop-gate.sh` 只有约 6 KB，多数门分散在
  `hooks/*.sh`、`hooks/*.py`、`agents/*.md` 里，而论文的计数口径是"**代码里每个能检查并阻断/结束/改道循环的点**"
  ⇒ 逐条还原需要人为判定"什么算一道门"，**不可靠**。
- **评审提示词我未抓全**：`agents/` 里我抓了 `plan-compliance-checker.md`、`plan-understanding-quiz.md`；
  评审（reviewer）本身的提示词应在其余 agent/技能文件里（未抓）。
- **GitHub 原生 UI/API 不可达** ⇒ 那 150 个 issue 的原文**无法核对**（只能信论文的编码表）。

### 2.3 Lean4Agent（arXiv:2606.06523）

**拿到了什么**（出处：`https://arxiv.org/html/2606.06523v1`；README 走 jsdelivr）

- **§3.4.1 图级谓词消融**：ELAIP-Bench 上**原本 40 个工作流里有 21 个未通过完整 Layer-2 验证**；
  去掉 graph-level predicates 后**只剩 8 个仍失败** ⇒ 图级约束检出了许多缺陷；最常见违规是
  `makeUnifiedJudgement` 与 `unifiedLoopBack`（局部谓词无法表达的**工作流级一致性要求**）。
- **§3.4.2 + Table 4（去掉 pure-LLM evolve）**：逐模型增益 GPT-5.2 **4.67%**、GLM-5 **3.33%**、Kimi-K2.5 **5.33%**、
  Gemma-4-31B **4.00%**、Qwen-3.5-27B **8.00%**；正文写明**完整系统平均仍提升 5.07%，比全集低 2.40%**
  ——即 pure-LLM 那一支贡献约 2.4 个点，且**formal-guided 才是主驱动**。
- **§3.5 案例**：3.5.1 展示 FormalAgentLib 在 rollout **之前**检出**非平凡的上下文管理错误**
  （示例 YAML 在附录 C.1；该 SWE 工作流全由"上下文隔离的 task 步骤"组成，而指令反复引用此前轮次的信息）。
- **附录 E（Limitations，三条）**：① 黑盒 LLM 行为**无法被完全检查**（只能把行为分解为结构化步骤、
  把自然语言要求抽象成可检查谓词 ⇒ 部分语义歧义留在形式系统之外）；② 实验里的谓词标注**由 LLM 生成**，
  可能**误标或规格写错**，尽管 Lean 检查本身是形式的；③ 现代 LLM 生成的工作流**结构错误很少**，
  导致部分组件**难以定量评估**，只能靠定向案例。
- **附录 F（Experiment Costs）**：大模型（GPT-5.2 / GLM-5 / Kimi-K2.5 / Claude）走官方 API，
  实验成本约 **$4,000**；小模型（Qwen-3.5-27B / Gemma-4-31B）在 **4×GH200 VLLM** 上跑，约 **1,500 GPU 小时**。
- **代码仓可用**：`RickySkywalker/Lean4Agent`，README 7998 字节（确认 headline 11.94% / 7.47%）；
  **498 个非 docs 文件**，代码主体在 `AgentSPEX/**`（含 config/scripts/docs）。

**仍然拿不到什么**

- **§3.5.2 及之后的案例**我没抽（只抽到 3.5.1 开头）；附录 **B（Lean 库定义）**、**C（YAML 示例）**、**D** 也未抽
  ——同法可得。
- 附录 A.2（95% CI）、A.3（LLM-as-judge 质量分析）未抽。

### 2.4 三个代码仓：可达性与获取方式

**拿到了什么**

| 仓 | jsdelivr 可达 | 文件数（非 docs） | README |
|---|---|---|---|
| `RickySkywalker/Lean4Agent` | ✅ `@main` | 498 | ✅ 7998 B |
| `PolyArch/humanize` | ✅ `@main` | 197 | ✅ 4302 B |
| `humanfia/humanize`（Humanize2） | ✅ `@0.1.0-beta.2` / `@main` | 499 | ✅ 1810 B |

**可复用的取法（本环境实测）**：

```bash
# 论文全文（含附录）——父代理此前两次被截断，用 curl 落盘再本地抽取即可
curl -s https://arxiv.org/html/<id>v<N> -o p.html
# 仓库文件（替代不可达的 GitHub 直连）
curl -s https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch-or-version>/<path>
# 仓库文件树
curl -s https://data.jsdelivr.com/v1/packages/gh/<owner>/<repo>@<ref>
```

**不可达**：`raw.githubusercontent.com`、`cdn.statically.io`、`raw.githack.com`（三者均 `000`）；
GitHub 原生页面/API。**可达**：`arxiv.org/html/*`、`ar5iv.labs.arxiv.org`、`cdn.jsdelivr.net`、`data.jsdelivr.com`、`humanfia.ai`。

**仍然拿不到什么**：GitHub issues/PR/releases 的原文（含 Humanize 那 150 个 issue 语料、
Lean4Agent 的 release 说明）⇒ 凡是依赖"读 issue 原文"的核对都做不了。

---

## ③ 这些新信息改变了什么判断（只写确凿的）

1. **WikiSkill：那条"读 wiki 有害"必须带条件引用。** 新数字显示它是**条件性**的：只有在 **Skill Proposer 也有 wiki 访问**时，
   给 **Inference Agent** 开 wiki 才把 63.7 拉到 60.9；若 Skill Proposer 没有 wiki，基线是 **48.7**。
   ⇒ 若像父代理先前那样把它当成"知识不该给执行 agent 用"，会得出**与我们自身机制相冲突的结论**
   （my-pi 的 `memory_search` 正是"使用期按需检索"）。**结论要改写成"演化期不要给执行者全量 wiki、且论文禁的是演化期"**。
2. **WikiSkill：写入判据从"没有可核查的定义"变成"可操作"**（附录 E.2）：字段（是什么/根因/确切命令序列/确切语法的解法）、
   去重规则（**更新而不重复建**）、篇幅（**10–30 行**）、索引格式与理由**都写明了**。
   ⇒ **此前因缺写入判据而搁置的"C 项：离线经验→知识编译器"现在具备动手条件**；且它的"索引是最重要部分"这一条，
   **正好印证父代理刚建的 `docs/INDEX.md`**（先索引、后按需取全文=论文 Skill Proposer 的 `read_file` 模式）。
3. **WikiSkill：作者自认没有自动清理机制**，并说知识长期累积后"剪枝可能变得必要"。
   ⇒ 父代理给 my-pi 定的"知识层要设容量/消费上限"**不是过度谨慎**，而是论文自承的缺口；这条也应写进借鉴文档。
4. **Humanize：计划契约与合规判据可以精确到字段与判定串**：契约 = goals + **AC-X 验收判据** + 路径边界 + 可行性建议；
   合规 = **相关性（要求宽容）+ 分支切换检测（含假阳性豁免）**，判定只有三种且必须一行。
   ⇒ 父代理先前把这两项笼统记为"计划合规检查与 quiz"，现在可以按字段/判定实现，**且"宽容"是论文明确要求的**。
5. **Humanize：72 道门"照搬"不可行**（论文只给类别与计数，代码无集中枚举，计数口径是人为的"阻断点"定义）。
   ⇒ 任何"移植这 72 道门"的提法都要改成"**按这 10 个类别自建**"，并且注意论文自曝的代价：Stop hook 从 975 行涨到 2,221 行、
   后来的 Codex CLI 版本**弄坏了插件**、还有 1 道门**fail-open**。
6. **Lean4Agent：成本有了确数，且其自述局限与我方折扣一致**：约 **$4,000 + 1,500 GPU 小时**；
   作者承认谓词由 **LLM 标注、可能误标**，且"黑盒行为无法完全检查"。
   ⇒ 任何"引入形式化验证"的提议必须先过这个成本与这个可靠性折扣。**唯一较硬的组件级证据是 §3.4.1**
   （图级谓词去掉后失败数 21→8）⇒ 若要借鉴，借鉴点应是"**图级/数据流一致性检查**"，而**不是** LLM-judge。
7. **操作性结论（对父代理最有用的一条）**：本环境里**读外部材料要靠"curl 落盘 + 本地抽取"与 jsdelivr 镜像**；
   直接 web_fetch 长文会被截断、GitHub 直连全挂。后续任何"读论文/读代码"的任务都应先用 ②.4 的取法，
   **不要**因为 web_fetch 截断或 GitHub 失败就判定"不可达"。

---

# 补充轮次（第二轮，2026-10-08）：72 道门的代码枚举 + 三篇附录正文

> 本轮方法（在既有"可达路子"之上细化）：论文全文仍用 `curl -s https://arxiv.org/html/<id>v<N>` 落盘后本地抽取；
> **代码仓改为全量克隆**——先用 `https://data.jsdelivr.com/v1/packages/gh/PolyArch/humanize@main` 拿到**文件树**
> （204 个文件），再对 `hooks/`、`scripts/`、`agents/`、`skills/` 下 **46 个文本文件**逐个走
> `https://cdn.jsdelivr.net/gh/PolyArch/humanize@main<path>` 下载后本地统计。

## 4.1 Humanize 的 72 道门：能从代码枚举到什么程度（**对不平，差在哪已说明**）

**论文的"门"计数定义（附录 A 原文）**：「We count as a gate **every point where the code of Humanize checks
the loop and can block, end, or redirect it**」——即它是一个**人为的"检查点"定义**，**不是代码里的注册表**。

**论文自身数字不自洽**（这是本轮最该记的一条）：附录 A 写 **29 道在 tool-call 与 prompt 校验器 + 32 道在 Stop hook
+ 1 道 fail-open = 62**，而附录 A 的 Table 1 十个类别合计 **72**（12+11+10+9+7+6+5+5+4+3=72）。**差 10 条**，
论文没有解释这两组数字为何不同。

**代码实测（`PolyArch/humanize@main`，204 文件）**：

- `prompt-template/block/` 下有 **42 个具名阻断模板**；其中 **41 个**能在下载下来的代码里找到引用，
  只有 `claude-eyes-timeout.md` 没找到引用（**存疑**：可能由动态路径引用，也可能是废弃模板——我没有下结论）。
- 实现层的分布（我按"具名函数数 / 引用的模板数 / 顶层 `exit 1` 次数"统计）：

| 实现文件 | 具名函数 | 引用模板 | 顶层 exit 1 | 归属层 |
|---|---|---|---|---|
| `hooks/loop-bash-validator.sh` | 0 | 3 | 4 | 工具调用 |
| `hooks/loop-edit-validator.sh` | 0 | 2 | 3 | 工具调用 |
| `hooks/loop-read-validator.sh` | 0 | 3 | 4 | 工具调用 |
| `hooks/loop-write-validator.sh` | 0 | 5 | 5 | 工具调用 |
| `hooks/loop-plan-file-validator.sh` | 1 | 1 | 1 | 提示提交 |
| `hooks/loop-codex-stop-hook.sh` | 10 | 14 | 1 | Stop hook |
| `hooks/lib/loop-common.sh` | 49 | 12 | 0 | 共享库（被上面两者调用） |
| `scripts/rlcr-stop-gate.sh` | 1 | 0 | 1 | 收尾门 |
| `scripts/bitlesson-validate-delta.sh` | 3 | 5 | 4 | 教训记忆校验 |

- **42 个具名模板 → 实现层的完整归属**（这是本轮可交付的"名称 + 在哪一层"枚举）：
  - **工具调用校验器（5 个 validator）**：`git-push`、`plan-backup-protected`、`round-contract-bash-write`、
    `wrong-round-number`、`wrong-directory-path`、`wrong-file-location`、`wrong-round-file`、
    `wrong-contract-location`、`wrong-summary-location`、`schema-outdated`
  - **Stop hook 本体**：`codex-review-failed`、`git-not-clean`、`git-not-clean-humanize-local`、
    `git-not-clean-untracked`、`git-status-failed`、`goal-tracker-not-initialized`、`incomplete-todos`、
    `large-files`、`mainline-drift-stop`、`mainline-verdict-missing`、`plan-file-modified`、
    `round-contract-missing`、`unpushed-commits`、`work-summary-missing`
  - **共享库 `lib/loop-common.sh`**：`finalize-contract-access`、`finalize-state-file-modification`、
    `git-add-humanize`、`git-tracked-humanize`、`goal-tracker-bash-write`、`goal-tracker-modification`、
    `methodology-analysis-state-file-modification`、`prompt-file-write`、`state-file-modification`、
    `stop-hook-direct-execution`、`summary-bash-write`、`todos-file-access`
  - **教训记忆**：`bitlesson-delta-empty-kb`、`bitlesson-delta-inconsistent`、`bitlesson-delta-invalid`、
    `bitlesson-delta-missing`、`bitlesson-delta-missing-notes`

- **为什么对不平 72（三条原因，都确凿）**：① 论文自己就是 **62 vs 72**；② 代码**没有门的注册表**，
  只能按"检查点"数，而粒度取决于数法（具名模板 = 42；顶层 `exit 1` 检查点 = 17（工具层）+ 其它；
  共享库有 49 个函数但只有 12 个模板）；③ 还有大量**内联检查**（例如 bash 校验器里的命令白名单判定）
  **不产生模板**，因此不进我那 42 条的计数。
- **我没有做的**：论文**没给**"类别 ↔ 具体门"的映射，所以我没有硬把 42 个模板塞进那 10 个类别
  （试过的对应会留下若干模板无类可归，这本身就是"两组数字不是同一总体"的旁证）。

## 4.2 Humanize 的评审 / 合规 / 漂移提示词（本轮新拿到）

| 文件 | 要点（我读到的） |
|---|---|
| `prompt-template/codex/regular-review.md`（4829B） | 四部分：实现审阅 / **Goal Alignment Check（MANDATORY）** / **Required Finding Classification** / goal tracker 更新段；输出含 `verdict:` |
| `prompt-template/codex/full-alignment-review.md`（4917B） | 四小节：**验收判据状态** / 遗忘项检测 / **推迟项审计** / 目标完成总结（对应论文"每第五轮 Full Alignment Review"） |
| `prompt-template/claude/drift-replan-prompt.md`（2756B） | **Drift Recovery Mode**：输入含 `stalled/regressed`，要求"必需恢复重锚 + Task Lane Rules"，输出 `verdict:` |
| `prompt-template/block/round-contract-missing.md`（441B） | 回合契约缺失时的阻断消息 |
| `prompt-template/block/mainline-drift-stop.md`（496B） | 主线漂移停机的阻断消息 |

加上上一轮已拿到的 `agents/plan-compliance-checker.md`（3619B）与 `agents/plan-understanding-quiz.md`（5410B）
和 `agents/bitlesson-selector.md`（1444B），**评审侧的提示词骨架基本齐了**（我未逐字读全这些文件的每一行）。

## 4.3 Humanize 附录 B codebook 与 §6/§7（本轮逐条）

**§6 的五条发现（标题原文照抄）**：① Independent review is trusted but expensive；② Iteration does not
guarantee convergence；③ Plans and scope are judgement boundaries；④ Evidence and environment decide
termination；⑤ The loop needs judgement around it。（§7 = Related Work：Coding agents and loops / Multi-agent
orchestration / Models as judges。）

**附录 B（Corpus Coding）**：语料 = 该仓的 **150 个 issue = 118 篇 postmortem + 32 个其它**
（bug report / feature request / question 等）。逐篇编码内容与分布：
- **回合数**：93 篇有陈述；
- **退出方式**：complete 37 / **stagnation stop 21** / **maxiter 10** / cancel 7 / drift stop 1 / **未陈述 42**；
- **按阶段拆分的回合**：27 篇；
- **pressures**：Table 2；
- **提议机制**：**771 条**编号建议；
- 盲编复核：**κ = 0.93（回合数）/ 0.82（退出）/ 0.79（主压力）**；
- 作者自注：**issue 内的计数是自述（self-reports）**。

（作者与单位我也读到：Humanize 作者含 NVIDIA / UCLA / 清华 / MIT；这与"多供应商联合采样"的设计取向一致。）

## 4.4 WikiSkill 附录（本轮新拿到）

- **附录 C = Implementation Details**，其中含 **Statistical significance testing**：论文用的是
  **paired bootstrap test，1,000 次迭代，p < 0.05**；正文并说明"**多个加粗结果代表与最优无显著差异**"
  ⇒（读它的 Table 时**必须按这个口径**，否则会把"并列"误读成"更好"）。
- **附录 D = Baseline Details and Optimizer API Call Analysis**（D.1 Baseline Methods：Trace2Skill、EvoSkill、
  SkillOpt…；并提到对优化器 API 调用量的复杂度分析）。
- 另确认存在包含 **Inference Agent System Prompt** 的附录（与上一轮拿到的 **Wiki Maintainer** 提示词同族）。
- **未做**：附录 A/C/D 的**逐字全文**没抽（我只抽到标题与关键句）。

## 4.5 Lean4Agent 附录（本轮新拿到，含成本与局限）

- **成本（附录 F）**：闭源模型走 **official API calls ≈ $4,000**；小模型（Qwen-3.5-27B、Gemma-4-31B）
  跑在 **4×GH200（vLLM）** 上，实验合计约 **1,500 GPU 小时**。（两条数字都是正文原话。）
- **A.2（95% CI）**：ELAIP-Bench 子集上的平均增益 **9.07%，95% CI [5.66%, 13.07%]**（作者称统计显著）。
- **附录 E 局限（三条，要点照抄）**：① 黑盒 LLM 行为**无法被完全检查**——框架只能把 agent 行为分解成
  结构化步骤、把自然语言需求抽象成**可检查谓词**，因此**仍有语义模糊留在形式系统之外**；
  ② 实验里的**谓词标注由 LLM 生成**，可能引入**误标**（即便随后的 Lean 检查本身是形式的）；
  ③ 现代 LLM 生成的工作流**结构错误本来就少**，所以**部分组件难以定量评估**。
- **附录 B 的结构（只到小节标题，正文未读）**：B.1.1 `BaseType` 全定义 / B.1.2 `StepType` /
  B.1.3 `WorkflowNode` / B.1.4 `WorkflowEdge` / B.1.5 `WorkflowGraph` / B.1.6 Layer-1 能识别的错误案例 /
  B.2.1 `PredicateType` / B.2.2 `SemanticWorkflowNode` / B.2.3 `SemanticWorkflowGraph`。
  另有 C.1.1/C.1.2 失败验证案例、C.2 evolve 研究样例、D.1/D.2 Lean 验证示例、**G Broader Impacts**。

## 4.6 仍然拿不到（本轮结论）

| 目标 | 状态与原因 |
|---|---|
| Humanize **72 道门逐条清单** | **结构性拿不到**：论文只给类别计数、代码无注册表、且论文自身 62≠72。本轮给的是**42 个具名模板 + 层归属**（已是代码里可枚举的上限） |
| `claude-eyes-timeout.md` 的归属 | **存疑**：42 个模板里唯一没在代码中找到引用者的一个 |
| Humanize 的 150 个 issue 原文 | **不可达**（GitHub issues 页面与 API 不在本环境可达路径内）⇒ 语料级核对做不了 |
| WikiSkill 附录 A/C/D 全文 | **未抽**（可同法再抽，说一声即可） |
| Lean4Agent 附录 B/C/D 的**定义正文** | **未抽**（只到小节标题） |
| 三个代码仓的**运行验证** | **未做**（本轮是只读代码与文档，没有安装/执行） |

## 4.7 这些新信息改变了什么判断

**改变（确凿三条）**：
1. **"照搬 72 道门"从建议升级为有据的否**：论文自身 **62 vs 72 不自洽** + 代码**无注册表** + 我只枚举到 **42 个具名门**
   ⇒ 正确做法是**按类别自建**（这条上一轮只是"判断"，现在是"证据"）。
2. **不引入 Lean4 形式化的理由更硬**：**≈$4,000 + 1,500 GPU 小时**，且作者自承**谓词由 LLM 标注可能误标**、
   **黑盒行为无法完全检查** ⇒ 与我们"断言 + 守门 + 留出集"的性价比路线相比，形式化的成本/收益不划算。
3. **引用 WikiSkill 数字要带限定**：它的"最优"是 **paired bootstrap（1000 次，p<0.05）**口径下的，
   **并列加粗 = 无显著差异**。

**不改变**：Humanize §6 五条发现的方向性结论（写者非裁判 / 迭代不保证收敛 / 证据与环境决定终止）与我们既有取向
一致；WikiSkill 的**写入判据**（上一轮拿到）仍是可操作的那一套。
