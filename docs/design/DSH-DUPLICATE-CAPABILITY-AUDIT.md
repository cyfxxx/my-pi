# DSH 同名冲突能力审计（`web_search` / `subagent` / `plan`）

**这份文档解决什么问题**：换基座时 my-pi 有 3 个名字与 DSH 原生撞车（工具 `web_search`、工具 `subagent`、
命令 `plan`）。"让位给 DSH 原生"到底会不会造成能力缺口，**必须可查**，不能靠印象——否则要么白丢能力，
要么把重复能力留在工具面上让模型两边挑。

**口径与证据**：

- DSH 侧版本 `0.2.0-rc.2`，路径相对 `node_modules/@deepseek-ai/`；my-pi 侧路径相对仓库根。
- 每条结论都带 `文件:行号`。**✗ 表示"未查到"**，并在 §5 列明检索面（不是"没有"，是"没找到"）。
- 冲突本身的处置（让位 / 改名 / 挂 per-agent）**尚未决定**，见 §6；本文只记录事实与后果。

---

## 1. `web_search`：DSH **覆盖不了**（真缺口）

| 能力 | my-pi | DSH 原生 | 结论 |
|---|---|---|---|
| 自托管后端 | 默认本地 SearXNG `http://127.0.0.1:8889`，可用 `SEARXNG_URL` / `PI_WEB_TOOLKIT_SEARXNG_URL` / settings.json 改（`custom/features/web-search/config.ts:11-13,39-46`） | 随包**只有** `deepseek-official`（`dsh-web-search-deepseek/lib/index.js:14,330`；全仓搜 `searxng` 零命中） | **DSH 没有** |
| 免 key 可用 | SearXNG 不可达时自动降级 **Bing 直搜**（`custom/features/web-search/index.ts:29-31`、`fetch.ts:10-31`）⇒ 全程不需要任何 API key | 缺凭证直接抛 `WEB_PROVIDER_CREDENTIAL_MISSING`（`dsh-web-search-deepseek/lib/index.js:204`），**无降级链** | **DSH 没有** |
| 模型可控条数 | `web_search(query, maxResults?)`（`index.ts:18-24`） | `queries: string[]`（必填）；条数上限 8、query 数上限 4 都是**部署侧配置**，模型改不了（`dsh-tool-web/lib/index.js:264-269,848-849`） | **能力反转**（DSH 多 query 并发/去重，但没有模型侧控制） |
| 抓取长度 | `fetch_url(url, max_length?)`（`index.ts:43-49`） | `web_fetch(url)`，**无** 长度参数（`dsh-tool-web/lib/index.js:736-743`；上限是部署配置 `:852`） | **my-pi 有、DSH 没有** |
| 时间范围 / 分页 | 逻辑层有（`search.ts:90-104`）但**未接到工具参数**（`index.ts:18-21,28`） | 未查到（schema 只有 `queries`） | 两边都没有（my-pi 是内部能力未暴露） |
| 多 query 并发合并 / URL 去重 | ✗ 无 | 有（`dsh-tool-web/README.md:58,110`） | DSH 更强 |
| 代理 | ✗ 无 | 进程级 env（`dsh-web-fetch-http/lib/index.js:4,501`、`dsh-http-proxy/lib/index.js:314-334`） | DSH 更强 |

⇒ **让位会丢**：无 key/自建后端搜索、模型可控的结果条数与抓取长度。
（`fetch_url` → `web_fetch` 属"改名 + 增强"，不算丢失。）

## 2. `subagent`：DSH **大体覆盖**，但 my-pi 有 5 项独有

| 能力 | my-pi | DSH 原生 | 结论 |
|---|---|---|---|
| 模式 | 单工具 `single` / `parallel` / `chain`（`{previous}` 串接）（`custom/features/subagent/index.ts:53-56,109,133-171`） | 参数只有 `prompt`(必填)/`description`/`provider`/`model`/`reasoning_effort`/`run_in_background`（`dsh-tool-subagent/lib/index.js:401-430`）；并行靠**多次调用**（`:576-580`） | **chain 丢失** |
| 隔离方式 | **子进程**（`index.ts:5`、`core/rpc-pool.ts:19,143-146,164`），且子代理是**完整 my-pi 实例** | **同进程** spawn / fork（`dsh-subagent-spawn-in-process/lib/index.js:34-36`、`dsh-subagent-in-process-driver/lib/index.js:180`） | 机制不同；DSH 的 fork 更轻 |
| fork 父上下文 | `context: 'fork'` 需要**会话文件**——DSH 上 `getSessionFile` 刻意不提供（`custom/adapters/dsh/hooks.ts:334`）⇒ **本来就已静默降级为 spawn** | fork 用父 log 到最后一个 `turn/end` 作种子（`dsh-subagent-fork-in-process/lib/index.js:6-9,44`） | **DSH 更强**（不依赖文件） |
| agent 定义来源 | 目录扫描 md + frontmatter（`core/agents.ts:4,92-103,178-183`），`agentScope: user/project` | YAML 组合配置（`dsh-tool-subagent/lib/index.js:252-270`、`dsh-base/cordis.patch.yml:370-388`） | **目录扫描丢失** |
| 逐任务 `cwd` | 有（`index.ts:62,142,157,171`） | ✗ 无该参数 | **丢失** |
| 中途投递 | 磁盘收件箱 CLI `node scripts/subagent-inbox.mjs post …`（`index.ts:124`、`core/inbox.ts:4-7,64-68`）⇒ **进程外**也能投 | 模型侧 `send_message`，语义明确（最近 step 边界 / 空闲起新 turn / 冷启动恢复，`dsh-subagent/lib/index.js:2883-2897`、`dsh-tool-subagent-control/lib/index.js:22-58`） | DSH 有等价（更规范），**缺进程外投递** |
| 取消 / 列出 | 有（脚本 + 工具） | `interrupt_agent` / `list_agents`（`dsh-tool-subagent-control/lib/index.js:61-92`、`lib/types/list-agents.js:50-57`） | DSH 等价或更强 |
| 并发上限 | 默认并发按机型；**Termux 降级 8→2**（`core/helpers.ts:9-12`） | `maxActiveSubagents` 默认 8、`maxDepth` 默认 1（`dsh-subagent/lib/index.js:2821-2823`） | **移动端降级丢失** |

⇒ **让位会丢**：chain、目录扫描式 agent 定义、逐任务 `cwd`、进程外投递、Termux 并发降级。
⇒ **明确不丢**（DSH 等价或更强）：fork 父上下文、steer/取消/列出、单次指定 model、深度与并发上限。

## 3. `plan`：DSH 只管"入口"，**完全不管强制**

| 能力 | my-pi | DSH 原生 | 结论 |
|---|---|---|---|
| **工具调用拦截（只读强制）** | `tool_call` 钩子**硬拦** `edit`/`write` 与非只读 `bash`（`custom/features/plan-mode/index.ts:352-365`、`core/readonly.ts:4-22`） | **不拦任何工具调用**——只有一段 system prompt 段（`dsh-plan-mode/lib/index.js:9-14,171-178`），其 README 明说"每个工具仍可调用…引导**而非**强制"（`dsh-plan-mode/README.zh.md:32,185`） | ★ **最实在的差异** |
| 模型自助进入 | `plan_enter` / `plan_exit` 工具（`index.ts:154-183`） | 模型只有 `exit_plan_mode`（`dsh-plan-mode/lib/index.js:231-238`）；进入只能用户 `/plan` | my-pi 有、DSH 没有 |
| 用户命令面 | `plan` 命令子命令 `enter/exit/resume/todos/plans/clear/help`（`index.ts:67-75,229-241`） | `/plan` 只接受 `[off\|message]`（`dsh-plan-mode/lib/index.js:185-188`） | my-pi 更全 |
| 计划任务状态机 + 落盘 | 任务状态机 + `plan-<ts>/plan.md` 落盘 + 重启恢复（`index.ts:99-116`、`core/plans.ts:6,51`） | 只存 mode 位（`dsh-plan-mode/lib/index.js:66-83`）；计划**正文只活在 `exit_plan_mode` 的调用参数里**，无 host 侧历史 API（`dsh-client-ui-plan/lib/client.js:240-262`） | **落盘与恢复丢失** |
| 审批 | `plan_exit` 弹选择器确认（`index.ts:170-183`） | `exit_plan_mode` **用户评审**后返回 `{approved:true}`（`dsh-plan-mode/lib/index.js:259-292`） | 等价（DSH 更规范） |
| 徽标 | overlay 徽标 | `PlanChip`（`dsh-client-ui-plan/lib/client.js:503-515`） | 等价 |
| 快捷键 `Ctrl+Alt+P` | 有（`index.ts:340-342`） | 未查到 | 客户端层差异 |

★ **关键区分（别混为一谈）**：让位只跳过 `plan` **命令**。`plan_enter`/`plan_exit` 工具与那条
`tool_call` 护栏钩子**不在冲突里、照常注册**（真 Host 实测：18 个钩子里含 `tool_call`）⇒
**"让位"不会丢强制护栏**。真正的风险是**两个 plan 模式并存**：用户敲 `/plan` 进的是 DSH 的
**建议式**模式（无强制），可能误以为拿到了 my-pi 的只读保护。

## 4. 汇总：三块全部让位时会真正丢失什么

- **`web_search`**：① 无 key/自建 SearXNG 端点；② 免配置 Bing 降级；③ 模型可控 `maxResults`；④ `max_length`。
- **`subagent`**：① chain（`{previous}`）；② 目录扫描式 agent 定义；③ 逐任务 `cwd`；④ 进程外投递 CLI；⑤ Termux 并发降级。
- **`plan`**：① 用户命令面（`resume/todos/plans/clear`）；② 计划任务状态机与落盘恢复；③ 快捷键。
  （**① 工具级只读强制不算在内**——见 §3 的 ★。）

## 5. 明确的"未查到"清单（附检索面）

- DSH：搜索的**时间范围过滤 / 分页 / cookie**（检索面：`dsh-tool-web`、`dsh-web` 的 schema 与
  `dsh-web/lib/types/types.d.ts:14-24`；`dsh-web/README.zh.md:153` 自陈 recency/域名过滤/区域/搜索深度暂缓）；
- DSH：**SearXNG 或第二家搜索后端**（全仓 `searxng` 零命中；`subagents.registerProvider` 全仓只有两处）；
- DSH：subagent 的 **chain / 子进程 provider / `cwd` / 目录扫描定义 / 外部 CLI 投递**（检索面：
  `dsh-tool-subagent` 的参数 schema `:401-430`、`dsh-web-app/presets/cordis.patch.yml:102-117` 的
  `disabled: true` 两行且对应包不存在）；
- DSH：plan 的**工具调用拦截 / `plan_enter` 类工具 / `status`·`resume` 子命令 / 计划正文持久化与查询 API / 快捷键**
  （检索面：`dsh-plan-mode/lib/index.js` 全文仅 `:181`（命令）与 `:232`（`exit_plan_mode`）两处注册；
  `dsh-tool-plan-mode` **包不存在**；`dsh-client-shortcuts/lib/client.js` 无 `plan`）。

## 6. 决策（**2026-10-18 已定**）

| 能力 | 决策 | 落地 | 依据 |
|---|---|---|---|
| `web_search` | **保留 my-pi 版，改名 `searxng`** | `custom/features/web-search/index.ts` 的 `name`；注册面基线（`scripts/registration-baseline.json`）、工具声明面基线、spike A6/A7、产物冒烟、`scripts/check-seeds-headless.mjs`、`portable/agent/AGENTS.md` 与 3 个脚本里的工具名同步改名。**真 Host 复验**：`tool/call name=searxng arguments={"query":"deepseek harness","maxResults":5}`（DSH 会话日志），结果内容即本工具的降级输出 ⇒ 模型可见且可执行；冲突从 3 个降为 2 个 | §1：DSH 覆盖不了"无 key / 自建后端 / 模型可控条数" |
| `subagent` | **让位 DSH 原生** | 不写死让位名单：仍靠"宿主注册表抛同名错 ⇒ 就地跳过并点名上报"这条机制（**万一宿主不再提供，我们的注册自动生效**，不会因名单过期而静默少能力）；my-pi 独有的 5 项见 §7 | §2：fork/steer/取消/列出等价或更强；my-pi 那套是跨运行时 spawn pi 且 fork 已降级 |
| `plan` | **DSH 的 `/plan` 管入口 + 保留 my-pi 的护栏与工具 + 命令换名注册** | `plan_enter`/`plan_exit` 与 `tool_call` 只读护栏**不在冲突范围**、照常注册；命令**不再让位**而是由适配层**换名注册为 `mypi-plan`**（`DshFacadeOptions.commandNameMap`，见下）⇒ 子命令面与 `clear`/`resume` 的落盘/续跑路径都保住（DR-6/DR-7 因此**已解决**）。**真 Host 复验**：`命令 10 个（…, mypi-plan, …）`、同名冲突从 2 个降为 **1 个** | §3：强制语义是最实在的能力，且它不在冲突范围内 |

**命令名重映射（为什么只给命令做）**：工具名对**模型**可见，改名会改变模型行为 ⇒ 工具冲突只能
"让位"或在 feature 侧改名（并重过声明面基线）；命令名是**用户敲的**，换名只影响输入习惯、不改变能力
⇒ 可以在适配层解决。实现是 `DshFacadeOptions.commandNameMap`（默认 `{ plan: 'mypi-plan' }` 在
`dsh/plugin/entry.ts` 注入，部署方可用 `config.facade.commandNameMap` 覆盖），合法性由宿主校验
（`dsh-commands`：`/^[a-z][a-z0-9_-]*$/`）。**顺带修掉一个静默失效**：入口原先把 facade 选项摊在
**顶层**（`...(config.facade ?? {})`），而 `MyPiDshConfig` 只认 `compileTool`/`facade`/`features`
⇒ profile 里写的 `config.facade.*` 会被**静默忽略**；现已嵌进 `facade:` 并加 spike **A21** 守门
（按真实装载路径断言 `config.facade.commandNameMap` 生效）。

**命令名重映射（为什么只给命令做）**：工具名对**模型**可见，改名会改变模型行为 ⇒ 工具冲突只能"让位"
或在 feature 侧改名（并重过声明面基线）；命令名是**用户敲的**，换名只影响输入习惯、不改变能力 ⇒ 可以在
适配层解决。实现 = `DshFacadeOptions.commandNameMap`（默认 `{ plan: 'mypi-plan' }` 在 `dsh/plugin/entry.ts`
注入，部署方可用 `config.facade.commandNameMap` 覆盖），合法性交给宿主校验（`dsh-commands`：
`/^[a-z][a-z0-9_-]*$/`）。**顺带修掉一个静默失效**：入口原先把 facade 选项摊在**顶层**
（`...(config.facade ?? {})`），而 `MyPiDshConfig` 只认 `compileTool`/`facade`/`features` ⇒ profile 里写的
`config.facade.*` 会被**静默忽略**；现已嵌进 `facade:`，并加 spike **A21** 按真实装载路径守门。

**改名的两点刻意取舍**：

- **描述不加长**：`searxng` 的 `description` 保持原文（`搜索网络并返回结果列表`）⇒ 工具声明面总字节
  **25,761 → 25,758 B（降 3 B）**，没有抬被守门盯着的预算（纪律："不擅自抬预算"）。
  后端细节写在仓库的 `portable/agent/AGENTS.md`，不占每次请求都要付的声明面。
- **残留影响（如实登记，逐文件处置）**：`packs/` 里还有 4 处提到 `web_search`，两个底座的后果**不同**：
  | 文件 | 归属 | 处置 | 后果 |
  |---|---|---|---|
  | `packs/README.md:61` | **本仓自己维护**的 packs 索引 | ✅ 已改为 `searxng` | — |
  | `packs/reverse-skill/RULES_zh.md:409` | vendored 上游 | 保留（"如 `web_search`、Perplexity、Tavily 等"是**泛指联网搜索能力**的举例，不是绑定某个工具） | 无 |
  | `packs/books/SKILL.md:3` | vendored 上游 | 保留 | 在 **pi** 底座上该指令指向已不存在的工具（模型会白试一次）；在 **DSH** 底座上落到宿主的 `web_search`（DeepSeek 后端，需凭据） |
  | `packs/gamedev/references/webgame-autopilot.md:8` | vendored 上游 | 保留 | 同上 |
  为什么不改 vendored 三个：`packs/` 是**上游技能包**（有各自的同步与链接/结构守门），
  本地改名不该制造与上游的漂移；代价是**已知且已登记**的两处陈旧指令。
  检索面：`grep -rn "web_search" packs/`。

## 7. 待重设计项（登记，**不静默丢**）

让位/改名的代价逐条登记如下。每项都是"my-pi 有、宿主没有"，需要重设计才能回到 DSH 上。

| ID | 项 | 来源 | 状态 | 现状与备注 |
|---|---|---|---|---|
| DR-6 | `plan` 命令面（`resume`/`todos`/`plans`/`clear`/`help`） | §3 | ✅ **已解决**（2026-10-18，`mypi-plan`） | 适配层命令名重映射；真 Host 实测注册为 `mypi-plan`、命令数 9→10 |
| DR-7 | 计划任务状态机 + `plan-<ts>/plan.md` 落盘/恢复 | §3 | ✅ **已解决（命令侧）** | 命令恢复 ⇒ `clear`/`plans`/`resume` 路径回来；`todo` 工具驱动的落盘与重启 `restoreStateFromPlans` 本就不依赖命令 |
| DR-1 | `subagent` 的 `chain` 模式（`{previous}` 串接） | §2 | ✅ **不需要移植**（宿主有更通用的等价） | 宿主自带 `workflow` 工具：模型写一段 JS **扇出**多个 subagent（支持 phases / 结构化结果 / 前后台），且它在 headless profile 里**是启用状态**（`tool-workflow` + `workflow-ptc`，`dsh-tool-workflow/README.zh.md`）⇒ my-pi 的"顺序链 + `{previous}` 占位"被其覆盖；差别只在用法取向（宿主建议"一两项委派用普通 subagent 调用"，即小规模编排不做成一次工具调用）。**真 Host 实测**：会话日志里模型可见的工具清单含 `memory_stats, searxng, subagent, workflow` ⇒ 该能力在真链上确实可用，不是"配置文件里有"而已 |
| DR-2 | 目录扫描式 agent 定义（md + frontmatter，scout/worker/reviewer） | §2 | 🟡 **已实现为可选能力（默认关闭）** | 宿主支持**每实例 persona/工具权限**的 subagent 工具实例（`toolName` 每实例须不同），`AgentPresetRegistry.register()` 也能编程注册预设；**可行的恢复路径**：我们的插件在装载时扫描 agent 目录，为每个具名 agent 用宿主配置加载一个 `dsh-tool-subagent` 实例（`toolName: <agent 名>` + persona + 工具权限）⇒ 这样"这次委派给谁"由**工具名**承载，顺带解决 DR-4 的映射键。**为什么默认不做**：① 每个 agent 都会变成一个**模型可见工具** ⇒ 工具面/成本上升（本项目对工具面有预算纪律，宿主也刻意保持精简）；② 会改变用户可见的模型行为。⇒ 记为**可选部署特性**（需要时按上述路径实现，走显式配置开关），不在默认面里加 |
| DR-3 | 逐任务 `cwd` | §2 | ⏳ 待重设计（宿主缺参数） | 已核实：宿主 `subagent` 工具参数只有 `prompt/description/provider/model/reasoning_effort/run_in_background`，无 `cwd`；替代是任务里显式 `cd` |
| DR-4 | 进程外投递 CLI（`scripts/subagent-inbox.mjs`） | §2 | ⏳ 待重设计（**与 DR-2 同一个依赖**） | 查清了三条路：① 宿主**进程内**其实有可编程投递 API（`ctx.subagents.sendMessage(sender, targetId, content, {signal})`，仅限**直接父子**、`sender` 必须是**那个活的 Agent**）⇒ 插件侧做"文件收件箱 → 投递"的桥**技术上可行**；② 但投递需要把 my-pi 的 `<agent 名>.inbox.jsonl` 映射到**具体子会话 id**，而宿主只用 "sessionId + 自由文本 description" 标识子代理、**没有"具名 agent"这一维度** ⇒ 映射不可靠（这**正是 DR-2 缺的同一个东西**）；③ 出宿主进程的路只有"客户端-宿主"API（`typertGateway` + Client `ctx.remote`），但 **headless profile 里只有 gateway 服务、没有入站传输层**（该 profile 的插件清单里没有任何 server/socket/stdio 传输；GUI 那套在 web profile 里）⇒ 无头部署下没有可连的入站通道。**结论：先补"具名委派"这一维度（= DR-2），DR-4 才能可靠落地** |
| DR-5 | Termux 并发降级（8→2） | §2 | 🟡 **部分恢复**（2026-10-16） | 契约核实：宿主的 `maxActiveSubagents` 是 `Volatile<number>`，接口**只有 `get()`**（"value is updated only by its owning runtime"）⇒ **插件无权改**。于是改为"**读出来 + 移动端超限时明确报警 + 给部署层覆盖片段**"（`custom/adapters/dsh/subagent-capacity.ts`，spike **A23** + 单测 6 项；片段写在 `dsh/profile/my-pi.patch.yml` 注释里，由部署方显式启用）；✗ 运行期自动压到 2 在 DSH 上**做不到**。**真 Host 实测**：桌面 ⇒ `[my-pi-dsh] subagent 并发：宿主并发上限 = 8（非移动端，保持宿主默认）`；`TERMUX_VERSION=1` ⇒ 打出**警告**并附 `- id: subagent / config: {maxActiveSubagents: 2, maxDepth: 1}` 片段，两次都退出码 0 |

**另记一处当前的可用性瑕疵**（不是让位造成）：my-pi 的只读护栏在拒绝时提示"使用 `/plan exit` 退出"
（`custom/features/plan-mode/index.ts` 的 block reason）。在 pi 底座上这句是对的（`/plan exit` 就是 my-pi 的命令）；
在 DSH 上 my-pi 的命令已换名为 **`/mypi-plan`**（`/plan` 是宿主的建议式计划模式）⇒ 这句提示**指错**，
正确写法是 `/mypi-plan exit`。模型仍可用 `plan_exit` 工具退出，故只记为瑕疵、未改 feature 文案
（改它会同时改变 pi 侧行为；要修得在 feature 里做成可配置的文案）。

## 相关

- 冲突本身与隔离修复：[`DSH-MIGRATION-PLAN.md`](DSH-MIGRATION-PLAN.md) 实测 #18-u、#18-v；决策记录 #18-x
- 事件级对应：[`DSH-HOOK-MAPPING.md`](DSH-HOOK-MAPPING.md)
- 事故复盘（同名冲突冒泡连带丢注册）：[`../BUG-REPLAYS.md`](../BUG-REPLAYS.md) #41
