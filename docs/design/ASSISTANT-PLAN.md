# 拼接方案（定稿待确认）：DSH 当供应商，pi 出模型层与渲染，社区 TUI 当备用

> 状态：**方案已讨论完，等确认后开工**。本文替代此前零散的论证，作为唯一落点。
> 现状快照见 [ASSISTANT-STATUS.md](ASSISTANT-STATUS.md)；接缝规则见 [PRIVATE-ASSISTANT.md](PRIVATE-ASSISTANT.md)。

## 1. 结论一句话

**脊柱用 DSH 的 loop 与 Web，模型层用 pi-ai（经 `dsh-llm-pi-ai`），终端渲染用 pi-tui 或社区 TUI 插件；
我们自己只拥有千行级的"产品面"（组合、品牌、启动、验收、少量插件），不 fork 任何上游。**

## 2. 为什么是这个组合（用需求硬碰）

| 需求 | 谁满足 | 不选别的的原因 |
|---|---|---|
| Web 界面（要） | DSH 自带 React GUI | pi 没有 Web（`client/protocol/server` 只是 RPC/SDK 传输层）；给它造 Web ≈ 从零 |
| 在线 + 本地模型 | `llm-deepseek` + `llm-pi-ai` | pi-ai 本身已是最省事的引擎，DSH 只是在它上面加了配置/凭证/重试/计量 |
| TUI（备用） | 社区 `@deepseek-harness-tui/dsh-tui` 0.16.1（peer 覆盖 0.2.0-rc.2）；退路是自研 183 行客户端 | 移植 pi 的 TUI 应用 = 22k 行（其中 8k 绑 pi 会话），只有"主力界面"才值这个价 |
| 便携 | vendored DSH + 单指令 | 已验证 |
| 扩展 | 插件 API（工具/命令/路由/UI） | — |
| opencode | 只当"外部 agent"（ACP/MCP），以后再说 | 它的 TUI 是 opencode server 协议的客户端，不可移植 |

## 3. 模型层：DSH 相比 pi 的增量

**事实**：`@deepseek-ai/dsh-llm-pi-ai` 依赖 `@earendil-works/pi-ai ^0.87.1`——DSH 的多 provider 能力用的就是 pi 的引擎。

| | pi-ai（库） | dsh-llm + 适配器 |
|---|---|---|
| 加一条本地路由 | 写代码 `createProvider({baseUrl})` | 写 YAML `providers.local.{api,baseURL,models,apiKeyEnv}` |
| 凭证 | provider 内 resolve | 每请求经 credentials 接缝解析 |
| 发现 | 有 | 有（未收录网关 `GET {baseURL}/models`） |
| 重试 | 自己做 | `dsh-llm-retry` 统一 |
| 计量 | 无 | `token-meter`（压缩与 UI 共用一份压力值） |
| 错误 | 各家异常 | 稳定错误码，按 code 判 |
| 换 provider | 改代码 | 换包（多适配器并存，路由名不撞） |

**结论**：个人用"两条路由"两者都够；DSH 更方便在"配置化 + 与压缩/计量同一体系"，代价是多一层间接（`llm` → 适配器 → pi-ai）与 rc 变动。

## 4. 用了 DSH 的什么；升级怎么"选择性合并"

| 层 | 用到的包 |
|---|---|
| 容器 | `cordis` + loader + `dsh-app-boot` |
| 会话 | `session` / `session-persistence-jsonl` / `session-projection` / `session-query-sqlite` |
| 工具 | `tools` + `tool-fs` / `tool-bash` / `tool-web` / `tool-todo` / `tool-subagent` … |
| 模型 | `llm` + `llm-deepseek` + `llm-pi-ai` + `token-meter` |
| 权限/沙箱 | `user-approval` / `sandbox` + `sandbox-local` / `fs-observation-policy` |
| 上下文 | `compaction` / `compaction-basic` / `-tool-result-pruner` / `output-retention` / `spill` |
| 能力 | `plan` / `subagent` / `goal` / `jobs` / `schedule` / `skill` / `mcp-client` |
| 界面 | `host-webserver` / `api-gateway` / `web-frontend` / `client-ui-*` |
| 外壳 | `acp` / `sdk-jsonrpc-server` / `headless` |

**升级的三层含义**：

1. **版本层：锁步**。peer 依赖是精确版本（`0.2.0-rc.2`），不能逐包挑；升级=整组换。
2. **能力层：可选**。profile 挂哪些插件=合并哪些能力；没挂的即使装了也不生效，新功能默认不进来。
3. **代码层：解耦**。我们不读内部结构 ⇒ 不需要"解决冲突"，只需要跑 `verify` 看行为是否仍成立。

**做法**：钉版本 + 仓内 vendor + profile 白名单 + 一条 `verify` + 版本回滚。
**若真想逐行挑上游改动 ⇒ 必须 fork**（289 包 + cordis 生态），不划算。

## 5. "一切皆插件"的证据

1. **CLI 自己就是组合**：`dsh` 启动 = profile bundle 列表 + patch 层；`dsh-web-app` 自带 standard/ptc/minimal/cordis 四套 preset。
2. **接口包与实现包成对**（换实现不动调用方）：
   ```
   dsh-llm                 ← -deepseek | -pi-ai | -retry
   dsh-session-persistence ← -jsonl
   dsh-sandbox             ← -local | -windows-acl | -policy
   dsh-fs                  ← -local | -sandbox
   dsh-jobs                ← -local
   dsh-spill               ← -local
   dsh-credentials         ← -local
   dsh-attachment          ← -local
   dsh-subagent            ← in-process-driver | fork-in-process | spawn-in-process
   dsh-compaction          ← -basic | -image-offload | -tool-result-pruner
   ```
3. **注入决定谁活着**：插件声明 `inject`，服务不在就不激活（我们踩过 `no agent factory registered`）。
4. **我们的定价**：注册一个工具 72 行 / 1 个 import，两端可见；一条本地模型路由一段 YAML。

## 6. 定制五档与"真内核"面积

| 档 | 做什么 | 成本 | 落在哪个包 |
|---|---|---|---|
| L1 配置 | 去入口、改路由、调压缩 | 小时 | profile / patch / settings |
| L2 加插件 | 工具/命令/UI/品牌 | 天，几十~几百行 | 我们的插件 |
| L3 换实现 | 压缩策略、沙箱策略、持久化、子代理驱动、LLM 适配器、会话格式迁移 | 周 | 对应的**接缝包** |
| L4 改内核 | 回合边界、请求内容、日志语义、协议 | 难，受不变量限制 | `agent(-loop)` / `session` / `llm` / `api-gateway` |
| L5 换脊柱 | 不用 DSH | 可估（接缝已压到 3 个文件） | 我们自己的 loop + 自建 Web |

**关键发现**：很多"看起来像内核"的东西其实是 L3 接缝——**压缩**（`dsh-compaction` 接缝 + `-basic` 实现）、**权限/沙箱策略**、**会话格式**（`session-format` + v0→v4 迁移插件）、**子代理驱动**、**持久化**、**任一 LLM provider**。
所以 L4 的真实面积不是"289 个包"，而是 **4 个包**：`agent(-loop)`、`session`（append-only 语义）、`llm`（请求深冻结契约）、`api-gateway`（协议）。

## 7. 完全定制的代价

| 代价 | 具体形态 | 量级 |
|---|---|---|
| 接管生态 | fork 后 289 个包 + cordis 生态归你；每个上游版本都要 rebase | 持续，按季度计 |
| 跨包改动 | 改一条 loop 语义通常要同时动 `agent-loop` + `session` + `compaction`（+ 回归） | 1–2 人周/项 |
| 不变量对抗 | 请求**深冻结**（"read it, never rewrite it"）、日志 **append-only**、事件瀑布语义——这些是设计约束，不是 bug | 改不动就只剩 fork |
| Web 耦合 | DSH 的 Web 读宿主会话/投影；换 loop 就同时失去 Web，除非重实现宿主 API | 这是最贵的一项 |
| 失去升级通道 | 你的改动与上游冲突，只能手工合并 | 每次升级 |
| 知识成本 | cordis 的 service/inject/fiber/dispose、typert 远程描述符、client 模块打包 | 数周上手 |

**一句话**：完全定制的真正代价不是代码量，而是**"接管生态"或"丢掉 Web"二选一**。

## 8. 减轻"将来改内核"代价的措施（按杠杆排序）

1. **产品状态自有化（最重要）**：记忆、笔记、配置、模型路由、日程，全部用**我们自己的文件格式**放在仓库里，不塞进 DSH 的数据结构。换脊柱时数据不丢。
2. **不变量依赖清单**：明确列出我们依赖 DSH 的哪些语义（见第 9 节）。任何新需求若触碰清单，立刻判定为 L4/L5，先评估再动手。
3. **patch 而非 fork**：确需改上游时，只以**自标记、可重放**的 patch 形式存在（本仓 `patches/` 已有这套纪律），永不建 fork 分支。升级=重放 patch，失败即显式停下。
4. **契约测试即产品定义**：`verify` 覆盖会话生命周期、工具循环、压缩触发、审批、恢复、模型切换。脊柱可换的判据就是"这套断言还绿"。
5. **接缝预算 + import 守门**：`assistant/**` 对 `@deepseek-ai/*` 只允许 `plugin/entry.ts` 一处，行数上限 900；超了报警而不是警告后继续。
6. **协议边界薄适配**：终端/Web 客户端只依赖**文档化的线协议**；若将来换脊柱，只改一个 ≤300 行的"事件翻译层"，**不镜像任何内部结构**。
7. **升级演练**：每次升级 = 改版本 + 跑 verify + 记录回滚点；每年做一次"换一个接缝实现"的小演练（例如换掉 `compaction-basic` 用自己的实现），保持替换能力不生锈。
8. **决策记录**：每条"依赖某个 DSH 行为"的决定都写理由与替代方案，避免后人重新论证。

## 9. 不变量依赖清单（初始）

| 依赖 | 含义 | 若去掉/改变 | 归属 |
|---|---|---|---|
| 会话日志 append-only | 历史可重建、可回放、可迁移 | 投影/压缩/审计全要改 | L4 |
| 请求深冻结 | loop 构造的请求不可被插件改写 | 任何"改请求内容"的能力都被禁 | L4 |
| 事件瀑布语义 | 插件可拦/可短路，但语义固定 | 拦截类功能失效 | L4 |
| 会话 id / seq | 客户端与投影的关联键 | 客户端协议改 | L4 |
| 插件 API（`inject`/`tools.register`/`defineTool`） | 我们唯一的编译期依赖 | 我们的 entry 要重写 | L2/L4 |
| 线协议（`/api` + `/api/remote.mux`） | 终端/其他客户端 | 客户端重写 | L2/L4 |

## 10. 里程碑（待确认后执行）

| | 内容 | 验收 |
|---|---|---|
| **M0 断奶** | ✅ **已执行**：宿主启动搬进 `assistant/host/launch.mjs`；摘掉 my-pi facade；两条模型路由 + `mypi model` 切换；verify 扩到 9 项；接缝预算守门。✗ 未含品牌（M0.6 后置） | ✅ 工具面 **80 → 27**（无旧工具名、`mypi_note` 在）；在线/本地各一轮；干净 home 一条指令起；接缝 567 行 ≤ 900 |
| **M1 TUI** | 社区 bundle 装独立 profile，验证共存与"接续" | TUI 起得来/能对话；TUI 建会话 Web 可见、Web 继续后 TUI 能恢复；冲突如实记录 |
| **M2 Termux** | 探针脚本（libc/flock/landlock/内存/启动/一轮对话）+ PRoot 上验证 | 能启动、一轮对话、会话落盘、降级项逐条记录 |
| **M3 Windows** | 等有实机（DSH 原生支持 pwsh/ACL；主线有 `run-my-pi.ps1` 经验） | 启动 + 一轮端到端 |
| **功能回填** | 暂不做（用户决定）。DSH 原生顶 `plan-mode`/`subagent`/`context`/`mode` 的人设部分 | — |

## 11. 升级影响清单（每次 DSH 升级真正要动的东西）

**结论**：绝大多数升级零改动；真要改，只落在 6 个文件里（合计约 700–900 行）。

| 我们的东西 | 行数 | 什么会让它坏 | 改哪里 |
|---|---|---|---|
| profile 组合（patch YAML） | ~40 行 YAML | 条目 id/name 改名、bundle 名变化、**被配置项的 schema 变化**（`compaction-basic.modelPolicies`、`llm-pi-ai.providers`…） | 改 YAML（最高频） |
| `plugin/entry.ts` | 72 | `defineTool` 签名、`tools.register` 契约、参数 DSL | 单文件小改 |
| `src/transport.mjs` | 126 | RPC 信封、路由路径、token→cookie、mux 帧格式、**事件名/形状** | 单文件，10–50 行 |
| `src/tui.mjs` | 183 | 只在 pi-tui 或事件形状变化时 | 极少动 |
| `host/`（M0 后自包含） | ~100 | CLI 参数、profile 布局、**带 token 的 URL 格式**、`DSH_HOME` 布局 | 单文件 |
| 品牌/UI 插件 | ~150 | 客户端模块 API（`dsh.client.inject`、`ctx.remote`、client store） | 单文件，中等 |
| 我们的数据（记忆/笔记/配置/路由） | — | **状态自有化 ⇒ 永远不受影响** | 0 |

**`verify` 不在清单里**：它是判据。它红了说明上面某处坏了；若为了让断言变绿而改断言，那是改产品定义，必须单独决策。

### 三种升级情形

| 情形 | 典型内容 | 要做什么 | rc 期频率（估计） |
|---|---|---|---|
| A 补丁级 | 内部实现、未挂载的包、文档 | 换版本 + 跑 verify，全绿即结束 | 多数 |
| B 契约级 | 插件 API / 配置 schema / 线协议 / client 模块 | 改上表 1–3 个文件 + 确认对应断言 | 每 2–3 版一次 |
| C 内核语义级 | 回合边界、请求冻结、日志格式、协议版本 | 进入 L4：patch 或放弃该需求 | 少见，分水岭 |

### 升级税分级（定制方式决定成本）

配置/组合 **低** ＜ 自己的插件 **低** ＜ 品牌/UI 客户端插件 **中** ＜ 协议客户端 **中** ＜ patch 上游 **高** ＜ fork **极高**；
把状态存进 DSH 结构 **高**；依赖内部结构（shim/类型镜像/注入基线）**极高**——旧仓的病根就在最后一级。

### 六步升级流程

1. 改 pin（`DSH_VERSION` + 整组依赖，lockstep）；
2. 重装/重 vendor（连带原生平台包）；
3. **快照 diff**：升级前后各存一份 `--dump-config`（当前 web profile 挂 **183 条**），diff 出改名/移除/新增；
4. 跑 `verify`；
5. 按接缝定位修复：配置错→YAML；协议错→transport；插件错→entry；UI 错→品牌插件；
6. 记录 + 回滚点；verify 红就回滚版本，**不在产品里打补丁**。

## 12. 执行流程（M0，待确认后开工）

**顺序按"风险从低到高"排，每步都以 verify 断言收口。**

| 步 | 动作 | 涉及文件 | 验收（会红的断言） | 回滚 |
|---|---|---|---|---|
| **M0.0 基线** | 打 tag `pre-m0`；存 `--dump-config` 快照到 `assistant/baseline/`；跑一次现有 verify 记下绿色基线 | — | 快照有 183 条；verify 现状全绿 | 回到 tag |
| **M0.1 自包含宿主** | 新写 `assistant/host/launch.mjs`：解析 vendored dsh、建/复用 profile、叠加 patch、提取带 token 的 URL、端口/home 管理；`mypi.sh` 改调它 | `assistant/host/**`、`scripts/mypi.sh` | 干净 home 上 `mypi.sh web` 能起宿主并打印 URL；**不再引用** `scripts/dsh-launch.sh` | 保留旧脚本，切回一行 |
| **M0.2 摘 facade** | profile 只挂 `dsh-base` + `web-app` + 我们的插件；不再叠加 `dsh/profile/my-pi.patch.yml` | `assistant/host/**`、`plugin/mount.patch.yml` | `--dump-config` **无** `my-pi` 条目；工具面**无** `web_search`/`mypy_*` 等旧名；`mypi_note` 仍在 | 加回 patch |
| **M0.3 两条模型路由** | patch 增加 `llm-pi-ai.providers.local`；`/model` 或 `mypi model` 切换（注意 `selectModel` 会写回默认模型） | `assistant/profile/*.yml`、`plugin/**` | 在线一轮（mock 零调用）+ 本地一轮（mock 命中） | 去掉 provider 段 |
| **M0.4 验收扩展 + 守门** | verify 增加：无 facade、工具面清单、品牌（若已做）；约定守门加 import 预算（只允许 `entry.ts`、≤2 包、≤900 行） | `scripts/verify-m1.sh`、`scripts/check-conventions.sh` | 新断言全绿；故意引入一处越界 import 时守门能红 | 删断言 |
| **M0.5 裁体积**（可选） | 不挂 `office-to-pdf` + `client-ui-sidebar-documentpreview`；确认 `skill-office` 无依赖后，从 vendor 删 `libreoffice-kit-wasm`（**146 MB**） | profile、vendor 目录 | dump-config 无这些条目；页面仍可用；体积 523 → ~380 MB | 恢复 vendor |
| **M0.6 品牌**（风险最高，单独收口） | 若有配置项先改配置；否则写一个 client 插件替换 `brand-official` | `assistant/client/brand/**` | 页面标题/侧栏显示我们的名字 | 换回官方 brand |

**M0 执行结果（2026-10-18）**：

- M0.0 基线：tag `pre-m0`；`baseline/mounts-before.txt`（185 条，含 facade）；`baseline/verify-before.txt`；工具面快照 `baseline/tools-with-facade.txt`（80）。
- M0.1 自包含：`assistant/host/launch.mjs`（start/stop/status/url/path/profile；vendored 优先、建 profile、拷凭据 600、抓 token URL、pid 文件）；`mypi.sh` 改调它；**不再引用 `scripts/dsh-launch.sh`**。过渡开关 `--with-facade` 用于对照，M0.2 后默认不挂。
- M0.2 摘 facade：工具面 **80 → 27**；消失 53 个（`admin_*`/`autopilot_*`/`browser_*`/`ctx_*`/memory/mode/plan/tmux/voice/link 等），保留 DSH 原生（含 `web_search`、`subagent`、`goal/jobs`）+ `mypi_note`。
- M0.3 路由：`profile/local-provider.patch.yml`（从 spike 移入产品面）；`bin/model.mjs` + `mypi.sh model online|local`（`selectModel` 会写回 profile 默认模型，实测生效，落盘有秒级延迟）。
- M0.4 验收/守门：verify 新增第 ⑦ 步「断奶断言」（工具面上限 40、无旧前缀、`mypi_note` 在）；`check-conventions` M 段新增**接缝预算**（宿主 import 只允许 `plugin/entry.ts`；行数 ≤ 900，当前 567）。
- **未做**：M0.3b 本地压缩档位、M0.5 裁体积、M0.6 品牌、功能回填、TUI 更换、Windows。

**M1/M2 沿用第 10 节**；M0 完成后立刻做 M1（TUI 插件验证），因为它是"备用界面"的可行性前提。

## 13. 待确认

1. 本方案作为执行蓝本；
2. 执行顺序：M0.0 → M0.4 先做核心，**M0.5/M0.6 放到 M1 之后**（避免体积/品牌这类长尾拖住主线）；
3. 开工第一步 = M0.0 基线快照。
