# 迁移策略：先整体搬、再删减（可行性分析）

> 你的判断：上次"按需添加"导致功能缺失，这次改成"**先整体迁移，再在新项目里删/改**"。
> 结论：**方向对，但"整体迁移"要拆成两件事**——把**代码与数据**整体搬过来（可行、便宜、无损），
> 和把**全部功能跑起来**（需要 2441 行 facade 翻译层，是持续成本）。两者混在一起，就会重演上次的问题：
> 删除时没有参照物，只能凭感觉。

## 1. 两种"整体迁移"，成本差 10 倍

| 读法 | 做法 | 成本 | 风险 |
|---|---|---|---|
| **A. 代码/数据整体进仓（推荐）** | 把 `custom/`、`portable/` 等**冻结**进新仓库的 `legacy/`（不挂载、不运行），作为参照实现；现行区只保留 DSH 插件 | 几乎为零（拷文件） | 仓库变重；需要"最终删除 legacy"的纪律 |
| **B. 功能整体跑起来** | 重新启用 facade（2441 行，把 pi ExtensionAPI 翻译到 DSH）+ 12 个 feature 全挂上（实测 **80 工具**），再逐项删 | 高：facade 要跟 DSH 升级同步维护 | facade 自身就有翻译缺口；80 工具会让模型选错、前缀变长 |

**推荐 A**：功能"不缺失"靠的是**参照物在**，不是"跑着"。真正会缺失的是"你删掉之后没法验证"——
所以关键不是"先跑起来"，而是"**每个能力都有一条可执行的行为断言**"。

## 2. 旧家底有多大（决定"整体搬"贵不贵）

| 项 | 量 |
|---|---|
| facade（`dsh/`，pi→DSH 翻译层） | 13 文件 / **2441 行** |
| 12 个 feature | **约 48,000 行**（context 10.1k、autopilot 9.8k、subagent 4.2k、voice 3.7k、memory 3.6k、mode 3.4k、plan-mode 2.2k、link 2.0k、tmux 2.0k、browser 1.3k、web-search 1.0k、intervention 0.8k） |
| 数据 | `portable/agent`（sessions/modes/settings）、`portable/dsh`、`portable/memory`（记忆 127 条、摘要、台账、干预） |

搬文件：几乎零成本。**跑起来**：facade + 12 feature 的联调成本才是大头。

## 3. 可判定判据（避免"删不删"拍脑袋）

每个能力按四维打分，分数决定 keep / adapt / drop：

| 维度 | 问什么 | 数据来源 |
|---|---|---|
| **使用证据** | 最近 30 天被用过吗？几次？ | 会话工具调用统计（我们已有脚本，实测 32 会话/1512 次） |
| **替代覆盖** | DSH 原生或我们的插件有等价能力吗？ | `dsh-*` 包清单 + 工具面 |
| **数据负担** | 有必须迁移/保留的数据吗？ | `portable/*` 数据目录 |
| **维护成本** | 依赖上游内部结构多深？ | 读代码：是否 import 宿主内部、是否镜像内部结构 |

判定规则（写进账本，逐条勾）：
- 四维都低 → **drop**；
- 有使用证据或有数据，但 DSH 有替代 → **adapt**（用 DSH 原生 + 迁移数据）；
- 有使用证据、无替代 → **keep**（自建，进现行区）；
- 不确定 → **pending**（先留 legacy，不阻塞主线）。

## 4. 删除本身也有成本（这是上次翻车的镜像）

| 风险 | 说明 | 对策 |
|---|---|---|
| **无标尺删除** | 删了之后没人能证明"没坏" | 删除前先补一条行为断言（我们的 mock + verify 体系正好干这个） |
| **横切依赖** | `context` 被所有 feature 调用；删它牵动全身 | 删除顺序：叶子功能 → 横切能力（最后） |
| **隐形依赖** | 旧 feature 之间通过 hook-adapter 互调（如 autopilot → mode → session） | 删除前跑 `git grep` 依赖图 + 启动冒烟 |
| **数据孤儿** | 删功能后 `portable/*` 里的数据没人读 | 账本里登记"数据归属"，删除时一起处置（迁/冻/删） |
| **配置双轨** | 旧 `settings.json`/`modes.json` 与 DSH profile 并存 | 过渡期只允许一个"生效源"，另一个显式标 deprecated |
| **工具面膨胀** | 80 工具时模型选错率上升、前缀变长 | 账本里给"工具预算"设上限（我们现在 ≤40） |
| **无法回滚** | 删完才发现要 | 每个删除单独提交 + 打 tag；legacy 区保留原文件 |
| **上游升级** | 每次升级 DSH，legacy 参考实现可能过期 | legacy 只读、不参与构建；升级验证只针对现行区 |

## 5. 与当前进度的衔接（其实你已经在"删除优先"的路上）

已经完成的反向删除：facade 从默认组合里移除（**80 → 27 工具**）、不移植 `ctx_*`、不移植 autopilot 调度、
`/memory` 命令放弃。这些都靠"使用证据 + 替代覆盖"两条判据，没有靠感觉。

剩余 10 个能力的初步判定（详见 [`CAPABILITY-LEDGER.md`](CAPABILITY-LEDGER.md)）：

| 能力 | 使用证据 | DSH 原生 | 我们的实现 | 初判 |
|---|---|---|---|---|
| memory | 8 次（2 store + 6 search） | 无 | ✅ store/检索/摘要/脚本 | **keep（已做）** |
| tmux | 15 次 | 只读 `tmux-context` | ✅ 5 工具 | **keep（已做）** |
| web-search | 0（窗口内） | ✅ 原生 + SearXNG 接缝 | ✅ provider | **keep（已做）** |
| subagent | 11 次 | ✅ `dsh-tool-subagent` | — | **adapt（用原生）** |
| plan-mode | 17 次（`plan_exit`） | ✅ `dsh-plan-mode` | — | **adapt（用原生）** |
| mode | 0 | ✅ agent preset | 部分（`local` preset） | **adapt** |
| context | 0（指标类） | ✅ token-meter/compaction | 部分（瘦身 preset） | **adapt** |
| autopilot | 仅 `admin_restart` 6 次 | ✅ schedule + goal | 部分（`maintain.sh`） | **adapt** |
| voice | 0 | ✅ voice-input bundle | — | **drop（要用时挂 bundle）** |
| browser | 0 | ❌ 无工具（只有 UI 侧栏） | — | **pending（要用再自建）** |
| link | 0 | 部分（remote.mux 协议） | — | **pending** |
| intervention | 0 | 部分（message-feedback） | 部分（教训挖掘读旧数据） | **adapt** |

## 6. 建议的执行顺序

1. **P0 账本**：把上表落成 `CAPABILITY-LEDGER.md`（每行：状态/证据/数据归属/断言/负责人）；
2. **P1 legacy 快照**：`custom/` + `portable/` 原样进新仓库 `legacy/`（只读、不挂载、不参与构建）；
3. **P2 逐项判定**：按 §3 四维打分，把 pending 收敛成 keep/adapt/drop；
4. **P3 执行**：每个删除/适配单独提交，**先补断言再删**，verify 必须绿；
5. **P4 收尾**：账本全部非 pending ⇒ 删 `legacy/`，仓库回到"只有现行区"。

**完成判据**：`legacy/` 删除；`verify-m1.sh` 全绿；账本里没有 pending；工具面 ≤ 上限。

## 7. 一句话

**"先整体迁移"应该发生在文件/数据层，不是运行层**；"再删除"必须发生在**有断言护着的现行区**。
这样既不会功能缺失（参照物在、断言在），也不会把 facade 背进新项目。
