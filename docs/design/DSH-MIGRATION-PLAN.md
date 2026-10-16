# DSH 换基座：执行计划（分支 `feat/base-switch-dsh`）

> 前置分析：[`BASE-SWITCH-DSH.md`](BASE-SWITCH-DSH.md)（可行性 + spike 实测）、
> [`DSH-HOOK-MAPPING.md`](DSH-HOOK-MAPPING.md)（18 个钩子的逐类映射）。
> 状态：**已开工**（2026-10-15，用户指示"继续后续的转移"）。本文是**执行**文档，
> 与上面两篇"评估"文档分工：评估回答"能不能换、代价在哪"，本文回答"**怎么换、换到哪一步算过**"。
>
> 纪律（沿用本项目）：**宁可显示缺口，也不显示虚假的绿色**；每条结论带可复跑命令或 `文件:行号`；
> 未验证的一律标 ✗。

---

> **收口与交接**：迁移已结项（阶段 P0–P6 全部完成）。"怎么复跑全部验证 / 部署形态 / 剩余缺口分诊 /
本次新增的经验陷阱"都整理在 [`DSH-MIGRATION-CLOSEOUT.md`](DSH-MIGRATION-CLOSEOUT.md)。

## 0. 策略：**外观层（façade）+ 适配层（adapter）**，features 不改

my-pi 的分层本来就为这件事准备好了（`custom/adapters/README.md`）：

```
features/**（223 个 TS，只认 adapters 的稳定接口）
        ↓
adapters/**（唯一接触底座的地方）
        ↓  pi 侧：@earendil-works/pi-coding-agent 的 ExtensionAPI
        ↓  DSH 侧：@deepseek-ai/cordis 的 Context（工具注册 / 事件 / 命令）
```

因此换底座**不需要改 features**，需要新写的是：

| 层 | 内容 | 落点 |
|---|---|---|
| **外观层** | 把 DSH 的 `Context` 包装成 features/adapters 认得的那张 pi 形状的 API（本仓实测只用到 **18 个成员**，见 §2.2） | `custom/adapters/dsh/facade.ts` |
| **映射层** | ① 18 个 pi 钩子事件 → DSH 事件（数据表 + 测试）② 工具定义 → `defineTool` 载荷 ③ 命令/快捷键 → DSH 服务 | `custom/adapters/dsh/{events,tool,commands}.ts` |
| **引导** | DSH 插件入口：`export function apply(ctx)` → `createDshExtensionApi(ctx)` → `bootstrap(api)`（**复用现有 `custom/bootstrap.ts`，一行不改**） | `custom/adapters/dsh/plugin.ts` |

**为什么这样做**：features 与 adapters 是"窄而深"的耦合（4 个原语），把耦合面挡在外观层，
才能做到"换平台不动业务代码"；这也是 D 块（基线重建）之外**唯一可控**的路径 ✓。

---

## 1. 本轮实测补充的契约事实（都带出处，纠正/收窄了评估阶段的估算）

| # | 事实 | 出处（真实包，`@deepseek-ai/dsh-tools@0.2.0-rc.2`） | 对估算的影响 |
|---|---|---|---|
| 1 | `defineTool.parameters` 是**逐属性** schema（`{ type, description, enum?, … }`），不是 JSON Schema 根对象 | `lib/types/schema.d.ts:178-200`（`ParameterSchemaSpec` 的逐属性 spec） | ✓ 与本仓 `ToolParameter` **同构** ⇒ 参数映射是机械的 |
| 2 | `output` 必填：`{ schema: ValueSchemaSpec, render(args,value): ContentBlock[], presentationMeta? }` | 同上 `:186-196` | ✓✓ **可以通用合成**：canonical 取 `StringValueSchemaSpec`（`{type:'string'}`），`render` 返回 `[{type:'text',text:value}]` ⇒ 原估"57 个工具各写 schema+render"**降为 0**（想更精确的工具再逐个别精化）✓ |
| 3 | `execute(args, exec: ToolRunContext): Promise<canonical>`；`exec.signal` 是必需的调用方取消信号 | `lib/types/index.d.ts:305`、`ToolExecutionInput.signal`（同文件 `:255`） | ✓ 我们的 `ToolExecuteContext.signal` 有直接来源 |
| 4 | `ctx.tools.register(def)` 返回 **disposer**（`() => void`） | `lib/types/index.d.ts:636` | ✓ 比 pi 更干净：卸载/HMR 可精确撤销（pi 侧无 disposer） |
| 5 | `TextBlock = { type: 'text', text: string }` | `dsh-llm/lib/types/types.d.ts:46-49` | ✓ 与 pi 的内容块同形，`render` 不需要形状转换 |
| 6 | `tools/pre-execute` / `tools/execute` / `tools/post-execute` 都是 **waterfall**（`next()` 放行） | `dsh-tools/lib/types/index.d.ts:32-70` | ✓ 对应 pi 的 `tool_call` / `tool_result`（决策形状不同 ⇒ 逐处理器过一遍） |
| 7 | cordis 事件是**带引号的方法签名**（`interface Events`），`ctx.on('name', fn)` 直接订阅 | 同上 `:32-47` | ✓ 钩子接入方式确定：`ctx.on` |
| 8 | 安装面很小：`@deepseek-ai/dsh-tools` + `@deepseek-ai/cordis` = **22 包 / 12 MB / 25 秒**（npmmirror） | 本机实测（`npm install` 计时） | ✓ spike 可以**完全可复现**，不依赖机器上的 npx 缓存 |
| 9 | 裸 `Context` **没有** `ctx.tools`；加载 `@deepseek-ai/dsh-system-prompt` + `dsh-tools`（`ToolRuntime` 是 cordis `Service`，`static inject=['systemPrompt']`）后即就绪 | 本机实测（`ctx.plugin(SystemPrompt); ctx.plugin(ToolRuntime)` ⇒ `ctx.tools` 可用） | ✓ 最小 harness 成立，spike 可完全可复现 |
| 10 | ★ **外观层拿到的是 pi 形状**（`tool-adapter` 已经把内部定义编译成 TypeBox + 包了 execute） | 真实 spike 报错后定位：`tool "web_search" returned invalid output: value is not lossless JSON` | ✓✓ 第一版按"内部形状"解析是错的 ⇒ 已改成 pi 形状（详见 `custom/adapters/dsh/tool.ts` 文件头） |
| 11 | ★★ DSH 的 `tools/*` 事件是 **waterfall**：监听器返回 `undefined` 会**打挂调用** | 本机实测：`ctx.on('tools/pre-execute', () => undefined)` ⇒ `{isError:true, error:{message:"Cannot read properties of undefined (reading 'kind')"}}` | ✓✓ 裸挂 pi 处理器 = 静默全崩 ⇒ 桥接层必须"不干预就 `next()`"（已实现 + 单测钉住） |
| 12 | `tools/pre-execute` 的**参数改写被明确排除**（"arguments are already logged and presented"） | `dsh-tools/lib/types/index.d.ts` 的 `PreToolDecision` 注释 | ✗ pi 的"就地改 `event.input`"迁移后失效 ⇒ 桥接层检测并上报 |
| 13 | **映射表会漂移**：`session_before_switch`（2026-10-14 会话切换守卫新增）不在 2026-10-10 的 18 个普查里 | 真实 bootstrap 时适配层**当场抛错**并点名该事件 | ✓ 守门按设计生效（"宁可报错，不注册永不触发的钩子"）⇒ 已补为第 19 条（档位 ②，DSH 侧只能改到发起方那层）|
| 14 | schema 表达能力有限：无法精确映射的参数**不能丢** | `Union([String, Number])` 之类在我们的参数 DSL 里不该出现，但真实工具里存在 | ✓ 处置：降级为 `{type:'json'}` + 上报（丢参数会改签名 = 模型看不到入参，比类型放宽更危险）|
| 15 | 全量 bootstrap 在 DSH harness 下**可加载**（需把 pi 包 specifier 别名到 vendor/pi） | A9：**54 个工具、0 个特性失败** | ✓ 但"DSH-only 部署里没有 vendor/pi"仍是缺口 ✗ ⇒ 见 #16 |
| 16 | **`pi-shims/` 让"零 pi 依赖"也成立** | 两个 specifier 别名到本仓 shim 后：`import('@earendil-works/pi-tui')` 只导出 7 个符号、`pi-coding-agent` 只导出 2 个（实测）⇒ A9 仍 **54 工具 / 0 失败** | ✓✓ 别名机制可用 shim 承载；漂移由单测守着 |
| 17 | **打包产物**可行且足够小：只含本仓代码（712 KB），外部包全部 external | `scripts/dsh-build.sh` + `dsh/spike/smoke-built.mjs`（纯 node，无 tsx）⇒ 54 工具 / 0 失败 | ✓ 交付物形态确定 |
| 18 | **真实 launcher 的 profile 组合**：`id:` 形式是"覆盖已有条目"，**插入新插件要用 `insert:`** | 隔离 DSH_HOME 干跑：`- id: my-pi` ⇒ `patch: entry "my-pi" not found`；`- insert: [{id: my-pi, name: …}]` ⇒ 组合树出现 `file:///…/my-pi-plugin.mjs` | ✓✓ P5② 的落地方式确定；Host 启动仍未做 ✗ |
| 18-ac | ★★ **`commands.execute()` 一直是 ✗（"需要真 agent"）** ⇒ 14 处命令处理器只验到"注册进注册表 + `find()` 命中"（A10），没人证明宿主**真的会调用**我们的处理器 | spike 新增 **A22**：真实 `dsh-commands` + **真实 Session** + 最小 agent 对象，直接 `commands.execute(agent, "/spike-exec  甲 乙", [], signal)` | ✓✓ **真跑通过**：成功命令 ⇒ `kind=success`、处理器被调 1 次、`rawInput="  甲 乙"`（**前导空格保留**）、会话身份注入（`spike-cmd-exec`）；抛错 ⇒ `kind=error` 且文本含原因；未知命令 ⇒ `undefined`。★ 边界说清：这验的是"命令服务 + 真实会话"这条路径，**不是** loop 驱动的真 agent（那条仍需 Host/客户端） |
| 18-ab | ★ **`sendUserMessage` 的映射此前只到"方法被调用"，没有对着 DSH 实现核过**：适配层把 `deliverAs:"steer"` 映到 `agent.steer()`、其余映到 `agent.followup()`，但这两个方法在 DSH 侧到底把消息放进哪个收件箱、唤不唤醒，从未核实 | 读 DSH **实现**（`@deepseek-ai/dsh-agent-loop/lib/index.js:798-811`）：`send(message,target,wakeup)` → `inbox.splice(target, …)`；`followup(input)` = `send(input,"next-turn",true)`；`steer(input)` = `send(input,"next-step",true)` ⇒ **与适配层的映射一致**（指令里那句"agent-loop 提供这两个方法"也对上了：它们实现在 agent-loop 的驱动对象上，而不是 `dsh-agent` 包内）| ✓ **实现级核实通过**（三方拼证：① 单测/A15 证明适配层调哪个方法；② 上面这段实现证明方法→收件箱与唤醒；③ 真 Host 观察过 `agent/inbox/spliced target=next-turn`（#18-z））。★ 同时记下一处**我们没建模的语义**：`send()` 在"唤醒一个已被 abort 的 phase"时会把目标**改写成 `next-turn`**（`wakingAfterAbort`）⇒ 那种情况下 steer 会退化成 follow-up。✗ **仍未做**：真 agent（loop 跑起来）里"steer 在下一个 step 边界被消费"这一层 —— 试过在 spike 里单独建 root agent，但 loop 需要完整组合（模型路由等），报 `no agent factory registered (load an agent-loop plugin)` ⇒ 这条留给真 Host/交互客户端 |
| 18-aa | ★★ **打包产物原先不自包含**：`dsh/plugin/dist/my-pi-plugin.mjs` 仍 `import "@earendil-works/pi-coding-agent"`/`"pi-tui"`，而本地只是靠仓库根 `node_modules/@earendil-works/*` 软链到 `custom/adapters/dsh/pi-shims/` 才跑得起来；包清单是 `files: ["dist","README.md"]` ⇒ **shim 不在分发包里**，真部署要另写 profile 级 `pnpm.overrides`，而那条路从未在真 profile 跑过（长期登记 ✗）| 构建改用 esbuild `--alias:` 把这两个 specifier **改写成本仓 shim 的路径** ⇒ 它们不再是裸包名、被**打进产物**（本仓 TS 本就该进产物）；`scripts/dsh-build.sh` 头部策略说明同步改写 | ✓✓ **自包含实测**：产物里 `@earendil-works/*` 的 import = **0 条**（760K → 764K）；把仓库根的两个别名**搬走**（探针灵敏度已验：`import("@earendil-works/pi-coding-agent")` 报 `ERR_MODULE_NOT_FOUND`）后跑真 Host ⇒ 退出码 0、模块解析失败 **0** 条、注册汇总不变（`工具 53 / 命令 10 / 冲突 1 / 钩子 18`）⇒ **不再需要 profile 级 `pnpm.overrides`**（那条 ✗ 因此消失，而不是"被验证了"）。★ 顺带发现并修掉两处：① `scripts/dsh-package.sh` **自 2026-10-18 起静默失效**（独立安装目录里没有宿主包 ⇒ `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-tools`；它不在任何自动门禁里）⇒ 逐包补宿主包等价物，并把"产物不得含 `@earendil-works/*` import"的**零成本断言**加进构建冒烟，从此每次构建都查自包含性；② 修的过程中撞上 `ln -sfn` 的目录语义坑（目标是真的 scope 目录时链接被建到**里面**）⇒ 见 CODING-TRAPS #14 |
| 18-z | ★ **`input` 的 `streamingBehavior` 原先只能置空 + 上报**（真 Host 每次运行报 3 条）：pi 的 `input` 负载带这一维（steer=注入正在跑的这一步 / followUp=排到下一回合），而 DSH 的 `agent/pre-step` 负载**不含**它 ⇒ `intervention` 这类"记录 steer 文本"的处理器会**静默记空**（不是报错，是记录里少一栏）| 适配层从**会话日志**反查：`agent/inbox/spliced.target` 就是 `InboxTarget = 「next-turn」｜「next-step」`（`dsh-agent/lib/types/types.d.ts:31`）⇒ 按"进入本步的消息 id"映射（`next-step`=steer、`next-turn`=followUp）；查不到则**保持置空并上报**（不猜）。新增 `streamingBehaviorFromInboxTarget` + `HookBridgeContext.streamingBehaviorFor` | ✓✓ **真 Host 前后对比：该降级上报 3 条 → 0 条**（trace 可见 `agent/inbox/spliced target=next-turn 插入 1 条`，故本步输入被正确标成 followUp）；适配层单测 **123 项**（含"查不到不猜"与"next-turn 不得标成 steer"两条反向探针）；注册汇总仍 `工具 53 / 命令 10 / 冲突 1 / 钩子 18` |
| 18-y | ★★ **插件入口的 `config.facade` 被静默忽略**（"配置看起来生效、实际没生效"那类失效）：`dsh/plugin/entry.ts` 原先把 facade 选项**摊在顶层**（`...(config.facade ?? {})`），而 `MyPiDshConfig` 只认 `compileTool`/`facade`/`features` ⇒ 部署方在 profile 条目 `config.facade.*` 里写的任何东西都送不到外观层（只有 `compileTool` 侥幸命中）。2026-10-18 加 `commandNameMap` 时被 TS 当场拦下才发现 | 把 facade 选项**嵌进 `facade:`**（默认 `{ commandNameMap: { plan: 'mypi-plan' } }`，部署方展开在后可覆盖）；新增 spike **A21**：按**真实装载路径**（cordis loader + 第二参 `config`）装载产物，断言 `config.facade.commandNameMap` 真的生效（命令以指定名注册、原名不出现）| ✓ spike **21 通过 / 0 失败**（A21：`命令注册共 10 个 … 含 spike-plan=true｜含 plan=false`）；真 Host 用默认映射复跑：`命令 10 个（usage-diag, context, tools, memory, mode, mypi-plan, intervention, auto, schedule, daily）`、同名冲突 **1 个（工具:subagent）** |
| 18-x | ★★ **同名冲突的处置已决策并落地**（2026-10-18，用户确认）：`web_search` **改名 `searxng` 保留**、`subagent` **让位** DSH 原生、`plan` **让位命令但保留护栏与工具** | ① `custom/features/web-search/index.ts` 的 `name` 改 `searxng`（描述**不加长**以不抬声明面预算）；② 让位**不写死名单**——仍靠"宿主注册表抛同名错 ⇒ 就地跳过并点名上报"，这样宿主哪天不再提供同名工具时我们的注册会自动生效（不会因名单过期而静默少能力）；③ 代价逐条登记为 **DR-1…DR-7** | ✓ 同步改名：注册面基线、工具声明面基线（**25,761 → 25,758 B，降 3 B**）、spike A6/A7、两份产物冒烟、`check-seeds-headless.mjs`、`portable/agent/AGENTS.md`、3 个 searxng 相关脚本；spike **21 通过 / 0 失败**（A7 真跑：SearXNG 未起 ⇒ 自动降级 HTTP 直搜并返回结果）；决策与待重设计清单见 [`DSH-DUPLICATE-CAPABILITY-AUDIT.md`](DSH-DUPLICATE-CAPABILITY-AUDIT.md) §6/§7。**真 Host 复验（改名后）**：`工具 53 个、命令 10 个（…, mypi-plan, …）；同名冲突跳过 1 个（工具:subagent）；钩子 18 个`、`注册功能失败` 0 条；模型**真的调用了 `searxng`**（DSH 会话日志 `tool/call name=searxng arguments={"query":"deepseek harness","maxResults":5}`，结果内容即 my-pi 的 SearXNG 降级输出）⇒ 改名对模型可见且可执行；**`plan` 命令改为换名注册 `mypi-plan`**（不再让位，见 #18-y）⇒ DR-6/DR-7 已解决 |
| 18-w | ★★ **同名冲突的"能力覆盖度"必须可查**（3 个名字撞车：`web_search`/`subagent`/`plan`）："让位给 DSH 原生"是否造成能力缺口，靠印象判断两边都会出错（白丢能力 / 把重复能力留在工具面上让模型两边挑）| 新增 [`DSH-DUPLICATE-CAPABILITY-AUDIT.md`](DSH-DUPLICATE-CAPABILITY-AUDIT.md)：逐能力对照 my-pi 与 DSH 原生，每条带 `文件:行号`，并把"未查到"单列一节（附检索面）| ✓ 结论：**`web_search` 覆盖不了**（DSH 随包只有 DeepSeek 官方后端、缺凭证直接抛且无降级链 ⇒ 无 key/内网场景没有搜索；模型可控条数也没有）、**`subagent` 大体覆盖但 5 项独有**（chain、目录扫描式 agent 定义、逐任务 `cwd`、进程外投递 CLI、Termux 并发降级）、**`plan` 只管入口不管强制**（DSH 不拦任何工具调用，my-pi 的 `tool_call` 钩子硬拦 edit/write/非只读 bash）；★ 并澄清：让位只跳过 `plan` 命令，**护栏钩子与 `plan_enter`/`plan_exit` 不在冲突范围内 ⇒ 不会丢强制**；✗ 处置策略仍**待用户决策** |
| 18-v | ★★ **`turn_end` 的用量在真 Host 里静默丢失**（先有反向证据、再定位）：适配层按契约把 `assistant/message.usage` 攒起来补进 `turn/end`，但真跑后 pi 侧 `recordUsage` **没有落盘**。原因**不是**"事件没到"（`MY_PI_DSH_TRACE_EVENTS=1` 实测：`session/event` 全到，含 `assistant/message … usage=yes 入桶=yes`），而是两个自家 bug：① 一条 DSH `turn/end` 会触发**多条**桥接（本仓 3 个特性都注册 `turn_end`；外观层是"每个 pi 事件注册 ⇒ 一条独立订阅"），原先"取走即清桶"⇒ 只有**第一条**桥接拿到用量（实测 `用量补丁=yes` 后跟两条 `=no`），而恰好需要它的处理器不是第一条；② 只按回合号分桶 ⇒ 不同会话的回合 1 会串账 | 新增 `custom/adapters/dsh/usage-accumulator.ts`：按 **会话 id + 回合号** 分桶、回合内多 step **求和**（DSH 一个回合多个 step，真日志实测两条用量）、对外只给 `read`（**只读不销毁**，靠 LRU/`drop` 回收）；用量由**基础设施订阅**累积（不能挂 pi 的 `message_end`：那只有默认关闭的 voice 注册 ⇒ 没人注册就永远攒不到）；该回合没数据时返回 `undefined`（**不合成全 0**）；`cost` 显式标 `costUnavailable`（DSH `TokenUsage` 不含定价）| ✓✓ **真 Host 复验：三条桥接全部 `用量补丁=yes(calls=1)`，未被改动的特性写出 `{"input":213,"cacheRead":10368,"output":2,"total":10583}`**（`PI_USAGE_DIAG_FILE` 指向临时文件，不污染仓库记忆库；仓库侧 `.usage-diag.jsonl` 行数前后均为 1536）；spike 新增 **A20**（真实 `SessionStore` + 兄弟子 ctx + 注册**两条** `turn_end` ⇒ 每个都拿到同一份用量）⇒ **20 通过 / 0 失败**；适配层单测 ⇒ **112 项**；诊断开关 `MY_PI_DSH_TRACE_EVENTS=1` 保留（正是它把"没到 / 到了没识别 / 识别了没处理器"三者分开）|
| 18-u | ★★ **Host 级**真跑：**3 个特性与 DSH 原生同名** —— 工具 `web_search`（DSH 自带）、命令 `plan`（DSH 自带）、工具 `subagent`（DSH 自带）；**而原先的处置方式是错的**：`ctx.tools.register()` 抛出的"already registered" 冒泡上去被 `registerAll` 的"每特性 try/catch"接住 ⇒ **该特性排在后面的注册全部被跳过**（连带损失：`web-search` 丢了 `fetch_url`、`subagent` 与 `plan-mode` 各丢了钩子 —— 而 plan-mode 的只读护栏很可能就在钩子里，从工具数量上根本看不出来）| **已修（同名冲突就地隔离，2026-10-18）**：`facade.registerTool`/`registerCommand` 各自 try/catch，**只跳过冲突的那一个**并点名上报（`registerTool.duplicate:<名>`），其余注册照常继续；新增 `DshFacade.registrationSummary()`（成功工具/命令 + 冲突跳过项 + **钩子清单**）⇒ "到底少了什么"可**量**而不是靠读代码推 | ✓✓ **真 Host 复验：不再有 `⚠️ 注册功能失败`，汇总行 `工具 52 个、命令 9 个；同名冲突跳过 3 个（工具:web_search, 命令:plan, 工具:subagent）；钩子 18 个`**（54 − 2 个真冲突 = 52，`fetch_url` 已回来；18 个钩子里不含 `message_end` —— 那个只有默认关闭的 voice 注册，与预期一致）；spike A18/A19 走产物装载仍 0 激活错误 | ✓ **已决策（2026-10-18）**：`subagent` 让位、`plan` 命令让位（护栏与工具保留）、`web_search` 改名 `searxng` 保留 —— 见下面 #18-x 与 [`DSH-DUPLICATE-CAPABILITY-AUDIT.md`](DSH-DUPLICATE-CAPABILITY-AUDIT.md) §6 |
| 18-t | ★★★ **Host 级**真跑抓出**两个致命问题**（本地 19 项 spike 全绿也没抓到）：① **`inject` 约束**：cordis 里未 `inject` 就访问 `ctx.commands` 会**抛错**且插件**不激活**（`dsh: warning: 1 entry did not activate`）；② **工具定义必须编译**：`ctx.tools.register()` 要的是 `defineTool(options)` 的产物（spec → 模型侧 JSON Schema），我们直接注册原始 spec ⇒ 真实 provider 拒掉**每一个请求**：`Invalid schema for function 'admin_get_config': schema must be a JSON Schema of 'type: "object"', got 'type: null'` | ① 服务统一经新增的 `getDshService()`（先 `ctx.get()`、再属性读，两路都 try/catch）取；② 新增 `compileTool` 注入点（`DshFacadeOptions.compileTool`），由 `dsh/plugin/entry.ts` 注入 `defineTool`；缺编译器时**显式上报**（不静默注册坏定义）；`dsh-build.sh` 顺带把宿主包在仓库根建成本地别名（跑产物需要） | ✓ 修后：spike 新增 **A18**（走 cordis loader 装载产物 ⇒ 54 工具、0 激活错误）与 **A19**（`schemas()` 里 54 个工具的 `parameters.type` 全为 `object`，含 `admin_get_config`）⇒ **19 通过 / 0 失败**；单测 **86 项**；**复跑结果：退出码 0、插件日志 28 行、模型回了「收到」** ⇒ 端到端打通 ✓✓ | 
| 18-s | **流式增量桥必须翻译**：pi 的 `message_update` 处理器读 `assistantMessageEvent.{type,delta}`，而 DSH 的 `agent/assistant-stream` 给的是**有序帧** `{type,chunk:{type:"text-delta",…}}` ⇒ 不翻译就"看不到任何增量"（静默失效） | `hooks.ts` 新增 `translateStreamFrame`：`text-delta→text_delta`、`reasoning-delta→thinking_delta`、`tool-call-delta→toolcall_delta`、`block-start/end→*_start/*_end`；✗ 不可表达项**显式上报**（`partial` 帧里没有；usage/finish 无对应变体；toolcall_end 需要 pi 的 ToolCall 形状）；同时按契约**更正三条 note**：`message_end` 其实**可用**（`assistant/message` 的 data 含 `message`/`usage`，桥接层已摊平）、`turn_end` 的差异是字段名与内容（`turn` vs `turnIndex`、无 message/toolResults）⇒ 处理器应改从 `assistant/message` 累积用量 | ✓ spike **A17**（真实 cordis 派发 `chunk` 帧 ⇒ 处理器收到 `type=text_delta/delta="真实派发"`；`usage` 帧 ⇒ 不调处理器 + 上报）⇒ **17 通过 / 0 失败**；单测 +4 ⇒ **84 项**；✗ `partial`/usage/finish/toolcall_end 仍不可表达（已逐条上报） |
| 18-e | **命令契约与 pi 的差异只有三处**（`description` 必填 / `name` 小写无斜杠 / handler 必须返回 `CommandResult`） | spike A10（真实 `@deepseek-ai/dsh-commands`）：注册名 `spike-cmd`、`find()` 命中、`rawInput=" arg1"` 原文透传、会话身份 `s-9`、成功 `success`、抛错映射 `error` | ✓✓ 计划 §5 第 1 条（命令契约未读）消解；✗ `commands.execute()` 需真 agent、参数补全 DSH 没这个概念 |
| 18-q | **`sendMessage`/`sendUserMessage` 有真实落点，`appendEntry` 明确不做**（原先整组报 unsupported ✗ 太粗） | `@deepseek-ai/dsh-agent` 的 `Agent` 有 `followup(msg)`（普通后续回合）、`steer(msg)`（注入最近一步）、`send(msg,target,wakeup)`；`ctx.agents.currentInitiator()` + `agent/created`（契约负载 `{agent}`）可拿到当前 agent；`UserMessage` 形状 `{id,role:"user",content:[{type:"text",text}],source:{kind:"user"}}`（brand 运行时是恒等函数，实测 `MessageId("abc-123") === "abc-123"` ⇒ 产物仍**零 DSH import**）。`appendEntry` 走不通：DSH 的日志类型由 `SessionEventMap` **封闭声明**，运行时虽接受未知类型（实测 `append("my-pi/custom",…)` 成功并落 durable log），但会污染投影/不变式 ⇒ **不做静默写入**，要支持得先正式声明事件类型 | ✓ `deliverAs` 映射已实现（steer→steer、其余→followup）；spike **A15** 经**真实 cordis 派发** `agent/created` 验证接线：投递 2 次（followup,steer）、UserMessage 形状正确（**15 通过 / 0 失败**）；适配层单测 +4 ⇒ **73 项**；✗ 真实 agent 上的行为（回合怎么被唤醒/转向何时被消费）仍需 Host 级验证 |
| 18-p | **工具结果桥真跑**：pi 的 `tool_result` 处理器经 `tools/post-execute` 能否**替换模型看到的内容** | spike **A14**：注册探针工具 → 处理器返回 `{content:[{type:"text",text:"REPLACED"}]}` → 注册表返回的 `content` 真的变成 REPLACED ✓；★ 细节：**`value` 仍是 ORIGINAL**（`accept,content` 换的是块，不是 canonical 值） | ✓ 结论：`tool_result` 的替换语义在 DSH 上成立（模型看到的是新块）；✗ 若下游依赖 `value`，需要另行处理（已写进映射 note）；spike **14 通过 / 0 失败** |
| 18-o | ★★ **真 bug（spike A13 当场抓出）**：`session/event` 的真实签名是 **`(session, event)`**（scoped），事件在**第二参**；而外观层一直按 `args[0]` 取 `type` ⇒ **所有走 session-event 的 pi 事件从未被触发过**（`turn_start`/`turn_end`/`message_update`/`message_end`/`session_compact`/`session_before_compact`/`thinking_level_select` 等，占 19 个映射里的一大块）——而且是**静默**的（不报错、只是不触发） | 修：在参数里找"带字符串 `type`"的那一个；同时把日志事件的 `data` **摊平到顶层**（实测日志事件是 `{type,seq,time,data}`，而 pi 处理器习惯读 `event.turn`），并把 `type` 换成 **pi 的事件名**；保留原始 `data`/`seq`/`time` | ✓ spike 新增 **A13**：真实 `Session.append("turn/start")`/`("turn/end")` ⇒ 对应处理器各触发 1 次、回合号正确、**两个 type 不串台**（**13 通过 / 0 失败**）；适配层单测 +2（两参形态/过滤/type 改写/data 摊平、非本事件不触发）⇒ **69 项**；✗ 仍存**字段名差异**（`turn/end` 无 pi 的 `message`、`message_update` 的 `assistantMessageEvent` 形态不同）⇒ 已在映射里逐条标注，需字段翻译或改处理器 |
| 18-n | **两条 ① 评级的映射在细读后被降档**（"最干净的一处对应"其实是语义面不同）：`context`、`before_provider_request` | `context`：pi 拿到的是**消息转录**且可**替换**（`ContextEventResult {messages?}`，`types.ts:1443-1445`）；DSH 的 `system-prompt/assemble` 拿到的是**提示词分段/工具/变量** ⇒ 转录改写只有服务级去处（`ctx.toolResultPruner` / 替换 `CompactionEngine`），纯"补上下文"用 `ctx.systemPrompt.context()`；`before_provider_request`：pi 可**替换整个请求负载**（我们的暖前缀就是），而 DSH 的 `agent/request` 只能换**调用配置**，`llm/stream` 收到的 loop 请求**深度冻结**（契约原话 listeners "read it, never rewrite it"，`dsh-llm/lib/types/index.d.ts:33-44`）⇒ 暖前缀重放**没有对应** | ✓ 映射表改档（① 11→**9**、② 7→**10**；加权 ① 22 / ② 31 个调用点），两条标 `degraded` 并写明证据；spike 新增 **A12**：`ctx.systemPrompt.context()` 的注入在 `assembly.contexts` 与上下文快照里都可见、dispose 后消失（真实装配，**12 通过 / 0 失败**）；定级守门单测同步 ⇒ 适配层 **67 项**全绿；✗ 这两处的功能重设计（暖前缀、摘要去重/工具输出擦除）尚未做 |
| 18-m | **正式发布形态可验**：`npm pack` + 安装 + 从 node_modules 加载，而不是只靠相对路径引用 | `scripts/dsh-package.sh`：tgz 自检（只含 dist）→ 安装 → **部署侧 pi 别名** → 纯 node 加载已安装包 ⇒ **54 工具 / 0 特性失败 / `getAllTools()` 与注册数一致** | ✓✓ "正式发布"这条从"待做"变成"已验通"；★ 首次运行**真实暴露**了一条部署要求：不建 pi 别名会在加载期 `ERR_MODULE_NOT_FOUND: @earendil-works/pi-tui` （等价于 profile 的 pnpm overrides）；✗ profile 级 overrides 写法仍未在真实 profile 里跑过 |
| 18-l | **两个"unsupported"其实有落点**（此前只找了"列举 API"与"改名 API"的名字，没找服务）：`getActiveTools`/`getAllTools` → `ToolRuntime.schemas(scope?)`（`dsh-tools/lib/types/index.d.ts:225`）；`setSessionName` → `ctx.sessionTitle.rename(session, title)`（`dsh-session-title`，`SessionTitleService`） | ① 工具清单：两者都落到 `schemas()`（DSH 只有"可见面"一个清单），状态 degraded；② `setSessionName`：pi 只给标题、DSH 的 `rename` 要 **Session 对象** ⇒ 外观层订阅 `session/created` 跟踪当前会话，拿不到时（多会话）**不猜**，直接上报；服务缺失同样上报 | ✓ **运行时验证**：spike A9 全量 bootstrap 后 `getAllTools()` 列出 **54** 个（含 `web_search`）、`getActiveTools()` 同；适配层单测 **67 项**（新增 schemas 映射、schemas 缺失上报、rename 调用与缺失上报）；✗ `sendMessage`/`sendUserMessage`/`appendEntry` 仍无落点（DSH 没有"往会话塞消息"的插件 API）|
| 18-k | **`input` 的三种 decision 只有两种能在当前信息下正确实现**：pi 是 `{action:continue|transform|handled}`，DSH 是 `{kind:reject}|{kind:enter,messages}` | 已实现 `handled ⇒ reject`、`continue/undefined ⇒ next()`；`transform` **不实现**（要替换 `UserMessage` 的**不可变 content** 且保持稳定 `id`，需真 agent 验证不变量）⇒ 按不干预处理并**显式上报**（不静默改行为）；DSH 的 pre-step 负载没有 `streamingBehavior`（steer/followUp）⇒ 该字段置空并上报；新增 `inputTextFromPayload` 取最后一条含文本块的 user 消息文本 | ✓ 5 项单测（文本提取三态、handled⇒reject 且不调 next、continue/undefined⇒next、transform 上报且放行、streamingBehavior 上报）；适配层单测 **64 项**；spike A9 台账 **9 直接 / 9 降级 / 0 无等价**；✗ `reject` 之后消息是否回到收件箱未核实（需真 agent）|
| 18-j | **会话生命周期可在真实服务上跑通**（不必等 Host）：`dsh-session` 的 `SessionStore` 能挂在最小 harness 上，`Session.create(id)` → `store.enter(s)` → `store.announce(s)` 发 **`session/created`**、调用 enter 的 disposer 发 **`session/disposed`** （实测；`create()` 走 store 时也会自动 announce，二次 `announce()` 会抛 "already announced"） | 映射把 `session_start`/`session_shutdown` 的**首选落点改为会话级** （`session/created` / `session/disposed`，agent 级与归档级作备用）；新增 spike **A11** 走完整生命周期，断言两个处理器各触发 1 次且拿到**会话身份** `spike-session` | ✓✓ 会话生命周期（9+6 个调用点，映射文档里风险最高的一族）从"契约级"升级为**运行时已验证**；spike **11 通过 / 0 失败 / 0 跳过**；适配层单测 **59 项**（新增"原始 Session 负载"形状）；✗ 处理器的**业务语义**（资源启停是否与 DSH 的三种时机对齐）仍需逐条改造 |
| 18-i | **`agent_settled` / `agent_end` 不能直接在 `agent/status` 上裸挂**：DSH 的状态事件在 `running` 与 `idle` **两个方向**都发，而 pi 的这两个事件只在"静置"时该跑 | `hooks.ts` 新增 `payloadFilter`（不匹配时**只跳过 pi 处理器、`next()` 照调**）与 `idleOnly`（`status === "idle"` 才放行；**读不到 status 就失败开放** —— 宁可多跑一次，不静默少跑清理）；外观层对 `agent_settled`/`agent_end` 启用；两条映射标 `degraded` | ✓ 3 项新单测（过滤判定含失败开放、被过滤时仍调 next、经外观层验证 running 不触发 idle 触发）；适配层单测 **58 项**；spike A9 台账 **10 直接 / 8 降级 / 0 无等价** |
| 18-h | **`before_agent_start` 的"每回合一次"必须由桥接层保住**：pi 是每回合一次，DSH 的 `agent/pre-step` 是**每步一次**（一回合可多次模型请求） | `hooks.ts` 新增 `dedupeKey`（按 `turn` 去重，**只跳过 pi 处理器、`next()` 每次照调** —— 否则会打挂 waterfall）；外观层对 `before_agent_start` 启用它；映射表标 `degraded`（提示词装配类处理器若要每步都跑应改挂 `system-prompt/assemble`） | ✓ 3 项新单测：同回合只调一次但 next 每次都调、无回合号时**不去重**（宁可多跑不静默少跑）、经外观层验证且状态为 degraded；spike A9 台账变为 **12 直接 / 6 降级**（后续再加 agent/status 过滤与 input 决策 ⇒ **9/9**，见 #18-i/#18-k） |
| 18-g | **`thinking_level_select` 不是"无对应"**：应用点是 `agent/request`（替换冻结调用配置，配置含 `reasoningEffort?: ReasoningEffortId`，`dsh-llm/lib/types/call-config.d.ts:19`；模块注释原话 "request waterfalls replace them"），**触发点**仍无等价物（DSH 没有"档位选中"事件） | 实现级别→档位的**纯映射**（`custom/adapters/dsh/thinking-level.ts`）：精确/别名匹配 + **只降不升**（升档会让整段前缀缓存失效，与 pi 侧"缓存安全夹档"同目的）+ 认不出就失败并给原因；7 项单测覆盖别名、向下夹档、只有更高档位时失败、空输入；映射表新增 `status/degradedNote` 字段，把这条显式标为 **degraded**（否则外观层会因 `via: cordis` 报成 supported = 过度声称） | ✓ 单测 52 项全绿；spike A9 台账当时为 **13 直接 / 5 降级 / 0 无等价**（诚实计数；加 before_agent_start 去重与 agent/status 过滤后为 10/8，见 #18-h/#18-i）；✗ 真正替换配置需要模型路由（`LlmModelReasoningInfo.efforts`）⇒ 运行时未验 |
| 18-f | **工具面按特性对账**：DSH 全量 bootstrap 注册 **54** 个工具，而"源码里有 61 处 `registerTool`"是**静态 grep 的伪差** | 逐特性在 DSH 路径上单独注册并计数（真实 harness）⇒ 12 个特性合计 **59** 个工具定义：web-search 2 / context 3 / link 2 / memory 8 / plan-mode 4 / subagent 1 / tmux 6 / browser 18 / voice 3 / autopilot 12 / mode 0 / intervention 0。`full` 模式注册 54，差 **5** 个正是 `DEFAULT_OFF_FEATURES`（`mode/logic.ts:404`）里**按设计默认关闭**的 `voice`(3) 与 `link`(2)（voice 注册会拉起 whisper、link 会开入站远控通道）；静态 grep 的额外命中是 `tool-adapter.ts:203` 的**定义**、`:239` 的**唯一调用点**与 `dsh/tool.ts` 的两行**注释** | ✓ 差值 100% 对账到"按设计门控"，**没有静默缺失**；✗ 仍未在 `voice`/`link` **启用**的模式下跑过（需把它们显式列进某个模式的 `features`）|
| 18-d | **会话身份必须显式派生**：DSH 的 `SessionHeader` 只有 `id`/`createdAt`/`cwd`，**没有会话文件路径**（`dsh-session/lib/types/types.d.ts`）——而 pi 的处理器都从第二个参数取 `sessionManager.getSessionFile()` | `hooks.ts` 新增 `deriveSessionInfo`/`withSessionContext`，读三种真实负载形状（`session/created` 的 `{session}`、`agent/created` 的 `{agent.session}`、日志信封 `{header}`）；**不伪造 `getSessionFile()`**，只补 `getSessionId()`/`getSessionCwd()`；`mode` 的会话键收拢到新模块 `session-key.ts`（有路径用路径，否则 `dsh-session:<id>`），重启请求只在**确实是路径**时写 `targetSession` | ✓ 单测：三种负载形状 + 「读不出就原样返回、不编造」+ 经外观层端到端（`session_start` 处理器拿到 `sess-7`）；mode 既有 **98 项**测试无回归；✗ `--session <文件>` 这类**基于路径**的续接在 DSH 上没有对应物（要另设计） |
| 18-c | **压缩事件：观察可用、干预不可** ——`compaction/start` 是**会话日志事件**（`dsh-compaction` 的 `SessionEventMap`，`types.d.ts:21`），经 `session/event` 追加派发 | 真实 bootstrap：`session_before_compact` 从"服务替换（unsupported）"改为 `session/event` + `type==='compaction/start'` 派发；A9 的事件桥接台账实测（当时）**13 直接 / 5 降级 / 0 无等价**，其中 `session_before_compact=degraded`（后续加 `before_agent_start` 去重、thinking 档位、`agent/status` 过滤、`input` 决策后为 **9/9**，见 #18-g/#18-h/#18-i/#18-k） | ✓ 我们唯一那处是**观察型**（压缩前落快照+记账）⇒ 够用；✗ "取消压缩"仍不可（要换 `CompactionEngine` 服务）|
| 18-b | **注入面必须显式接线**：pi 的 `APPEND_SYSTEM.md` 在 DSH 上没有等价约定，只有 `SystemPrompt.section()` 服务 | 真实 harness：`section({name:'my-pi:append-system', order:2500, text, interpolate:false})` ⇒ `renderPrompt(assemble())` 含 1274 B 且**是渲染结果结尾**（0 字符在其后） | ✓✓ 不接这一步，那段指令在 DSH 上不会出现**且不报错**；现由 `dsh/baseline/system-prompt.json` 守漂移 |
| 19 | **DSH 侧工具声明面可以精确量出来**（模型实际看到的声明） | `dsh/spike/measure-surface.mjs`：`parameterSchemaSpecToJsonSchema(def.parameters)` + name/description ⇒ 54 工具合计 **25,761 B**；最大 `subagent=1860B`、`goal=1442B`、`schedule_task=1426B` | ✓ 与 pi 侧"中等工具 1.3–1.8 KB"的经验一致，可作新基线；✗ **口径不同**（pi 的 24,785 B 是整段前缀）⇒ 不做减法 |

---

## 2. 迁移面（本仓实测口径）

### 2.1 四个原语与 DSH 的对应（登记表）

| pi 原语 | 本仓用量 | DSH 对应 | 档 |
|---|---|---|---|
| `registerTool` | **61** | `ctx.tools.register(defineTool({…}))` | ①（载荷合成见 §1#2） |
| `registerHook` | **55**（53 特性 + 2 适配器）/ 18 distinct | `ctx.on(cordis 事件)` 或 `session/event` 派发 | ①11 / ②7 / ③0（逐类见 `DSH-HOOK-MAPPING.md` §3） |
| `registerCommand` | **14** | `@deepseek-ai/dsh-commands`（契约**未读** ✗ ⇒ 本轮按"服务存在、形状待读"处理） | ② |
| `registerShortcut` | **4** | `dsh-client-shortcuts`（**客户端层**，内核无） | ②（属另一层，可能"不迁移"） |

### 2.2 外观层必须实现的 pi 面（**实测**：adapters 只碰这 18 个成员）

```
on(5)  registerTool  registerCommand  registerShortcut  registerMessageRenderer
registerFlag  getFlag  getActiveTools  setActiveTools  getAllTools
getThinkingLevel  setThinkingLevel  sendMessage  sendUserMessage  appendEntry  setSessionName
```

计数命令：`grep -rhoE '\b(pi|api)\.[a-zA-Z_][a-zA-Z0-9_]*' custom/adapters/*.ts | sort | uniq -c | sort -rn`

**没有等价物的成员必须"显式报告"，不得静默空转** ✗ —— 本项目既有教训：
静默降级 = 行为悄悄变了（`BASE-SWITCH-DSH.md` §6.4）。外观层对每个成员登记
`supported | degraded | unsupported`，`unsupported` 走统一上报（默认 `console.warn` + 计入审计）。

---

## 3. 阶段与验收（每阶段都要有可复跑证据）

| 阶段 | 交付 | 验收（可复跑） | 状态 |
|---|---|---|---|
| **P0 计划** | 本文 + 分支 | 分支存在、main 未动 | ✓ |
| **P1 映射层** | `custom/adapters/dsh/{events,tool,hooks}.ts` | `npx vitest run custom/adapters/dsh` 全绿；19 个事件 100% 有档位（①9/②10/③0） | ✓ **适配层单测 123 项通过**（含映射表完整性、工具载荷、waterfall 纪律、用量桥、命令换名、streamingBehavior 派生等反向探针） |
| **P2 外观层** | `custom/adapters/dsh/facade.ts` | 单测：注册工具、`on` 桥接、waterfall 纪律、unsupported 显式上报 | ✓ |
| **P3 真实 spike** | `dsh/spike/**` + `scripts/dsh-spike.sh` | 真实 `@deepseek-ai/*`（`0.2.0-rc.2` + cordis 4.0.4）：注册的工具**被真实注册表调用**、事件**真触发**、拦截**真生效**、产物**按 loader 装载**、`commands.execute()` **真调用我们的处理器** | ✓ **22/22 通过**（A1–A22） |
| **P4 一个特性端到端** | 真实特性 `custom/features/web-search` 经 `tool-adapter` → 外观层 → DSH 注册表 | spike A6/A7 里 `searxng`（2026-10-18 由 `web_search` 改名）**真实执行并返回结果**（SearXNG 未起时自动降级 HTTP 直搜） | ✓（选它的原因：唯一不 import pi 运行时包的特性） |
| **P5 引导与配置** | ① pi 包 **shim** ② 插件产物 + profile 接线 ③ **正式发布形态**（`dsh-package.sh`）④ **Host 级真跑** | ①✓ 零 pi 依赖下 A9 仍 54 工具 / 0 失败（且 2026-10-18 起 shim **打进产物** ⇒ 不再需要部署侧别名）；②✓ 真实 launcher 接受插件进 profile；③✓ 安装后的包实测 **54 工具 / 0 失败**；④✓✓ **Host 级已跑通**（四类路径 + 三个场景，见下） | **①②③④全部完成** |
| **P6 守门重建（D 块）** | ① 工具声明面基线 ② **注入面基线** ③ **场景测试（3 个）** ④ 补丁账处置表；★ ①②并入 `check-conventions.sh` **J 段**，另加 **K 段**（`dsh/plugin` 类型检查）与 **L 段**（Markdown 表体） | ①✓ 54 工具 / **25,758 B**（反证：篡改字节 ⇒ 点名漂移）；②✓ `APPEND_SYSTEM.md` 注册为 DSH 提示段（order=2500），基线哈希 `renderPrompt(assemble())`（反证：改源文件 ⇒ exit 1 点名三条漂移；复原 ⇒ exit 0）；③✓ **3/3 已重写并跑通**：两实例隔离（各自会话/用量互不串、仓库默认台账未变、A 答「甲」B 答「乙」）、会话续接（两轮 sessionId 相同、会话目录数不变、插件在位、答出第一轮让它记的词）、模式启动期（同一插件 `工具 53/命令 10` vs `PI_AGENT_MODE=minimal` `工具 0/命令 1`）；④✓ 补丁账收敛为 **0 个需移植**（011 留下 deferred 工具发现的待查 ✗） | **①②③④全部完成** |

> ✅ **2026-10-18 更新**：P5 的完整 Host 验证**已获用户授权并跑通**（隔离 `DSH_HOME`、不动 `~/.dsh`、
> 不动正在跑的 GUI；凭据只临时拷一份 600、退出即删），已覆盖四类路径：插件加载/钩子触发、工具调用
> （`memory_stats`、改名后的 `searxng`）、回合用量落盘、注册汇总；判据与开关见 `dsh/README.md` 的
> "Host 级验证"一节。原先"内存与别打扰 GUI 两条约束下不轻率执行"的记录**已过期**，保留于此仅为说明当时取舍。

---

## 4. D 块（最容易被低估）：基线必须重建的清单

换底座后，**旧的绿色不能继承**。逐项处置（本轮只登记，做到哪算哪）：

| 基线 | 现在依赖 | DSH 侧处置 |
|---|---|---|
| 注入面前缀指纹（`check-injection-surface.sh`） | pi 的系统提示词装配结果 | 用 `system-prompt/assemble` 瀑布取装配结果重算基线 |
| 工具面字节预算（`custom/features/context/budget/*`） | pi 的工具声明格式 | 用 DSH 的 `ToolSchema` 重算；`deferLoading` 对应我们的 `deferred` |
| 会话切换/两实例隔离/模式切换场景（`scripts/test-scenario-*.mjs`） | 真跑 pi + supervisor | DSH 侧 Host/Session 语义不同 ⇒ **重写**（`agent/created`、`session/disposed`） |
| 补丁可应用性（`check-patches-behavior.mjs`） | 11 个 pi 补丁 | 补丁目标是 pi 的 TUI ⇒ 多数**不迁移**，改为"DSH 侧不需要"的书面结论 |
| 便携运行时（`PORTABLE-LINUX.md`） | 与底座无关 | **可直接复用**（Node/CPython/服务都进仓库 ✓） |

### 3.1 覆盖度总表（2026-10-17 收口快照）

一句话：**核心面已全部有落点或"有理由的不支持"**；剩下的是 **Host 级验证**、**客户端层能力**与**两处功能重设计**。

| 面 | 规模 | 状态 | 证据（可复跑） | 剩余 ✗ |
|---|---|---|---|---|
| **工具** | 59 定义 / `full` 生效 54 | ✓ 全部注册进真实注册表并可执行；**真 Host 里成功注册 53 个**（`subagent` 让位宿主同名工具，已点名跳过；`web_search` 已改名 `searxng` 不再冲突 —— 见 #18-x） | spike A2/A3/A9、`dsh-baseline --tools`（25,758 B）、真 Host 注册汇总行 | 依赖 `voice`/`link` 的模式需显式启用；让位代价见审计 §7（DR-1…DR-7） |
| **钩子（事件）** | 19 个事件（①9 / ②10 / ③0） | ✓ 映射齐；桥接台账 **7 支持 / 11 降级 / 0 无等价**；**真 Host 里实测 18 个钩子订阅成功**（`MY_PI_DSH_TRACE_EVENTS=1` 的注册汇总行点名列出） | spike A4/A5（pre-execute 观察+拦截）、**A13**（session/event 真跑）、**A14**（post-execute 替换）、A11（会话生命周期）、**A20**（回合用量桥）、A9 台账、真 Host 注册汇总 | ~~`turn_end` 处理器改从 `assistant/message` 累积用量~~ **已做**（适配层累积，见 #18-v + spike A20；真 Host 已复验落盘）；仍剩：两处功能重设计（暖前缀、转录改写）；`partial`/usage/finish 帧不可表达（已上报） |
| **命令** | 14 处 | ✓ 契约已读 + 映射已实现（名称规范化/必填 description/`CommandResult`/**同名换名注册**）；真 Host 注册 **10 个**（含换名的 `mypi-plan`） | spike **A10**（真实 `dsh-commands`：find 命中、rawInput 透传、抛错映射）、**A21**（配置通路 + 换名注册）、真 Host 注册汇总 | 参数补全无对应 ✗；`commands.execute()` 需真 agent |
| **快捷键** | 4 处 | ✗ 不支持（属**客户端层**） | 映射文档 §7.2（客户端 UI 服务） | 要等价能力得写 DSH 客户端插件 |
| **消息渲染器** | — | ✗ 不支持（同上，且与 `sendMessage` 的 customType 同族） | 同上 | 同上 |
| **消息投递** | 3 处 | ✓/部分：`sendUserMessage` → `followup`/`steer`；`sendMessage` 只投文本并上报丢失字段；`appendEntry` **显式不做** | spike **A15**（真实 cordis 派发 `agent/created` ⇒ 投递 2 次、UserMessage 形状正确） | 真实 agent 上的唤醒/转向语义；`appendEntry` 需先声明日志类型 |
| **会话身份** | 9+6 处（生命周期） | ✓ 身份由 `session/created` 跟踪；键收拢到 `session-key.ts` | spike **A11**（`Session.create→enter→announce` 与 disposer ⇒ 两个处理器各 1 次、身份一致） | `--session <文件>` 式续接无对应 |
| **会话枚举** | `session-adapter` | ✗ 当前走 pi shim（返回空表） | `SessionStore.list()` / `ctx.sessionQuery` **存在**（已读契约） | **可做**：换成 `ctx.sessions.list()`（下一轮候选） |
| **thinking 档位** | 1 处 | 部分：级别→档位**纯映射**已实现（只降不升） | 单测 7 项；`agent/request` + `reasoningEffort`（`call-config.d.ts:19`） | 真正替换配置需模型路由 |
| **注入面（系统提示词）** | 1 | ✓ `APPEND_SYSTEM.md` 注册为提示段（order 2500，实测在末尾） | 基线 `dsh/baseline/system-prompt.json` + 反证（改源文件 ⇒ exit 1）；`check-conventions` J 段 | — |
| **工具面基线** | 1 | ✓ 54 工具 / **25,758 B** / sha256（改名 `searxng` 后**降** 3 B，未抬预算） | `dsh/baseline/tool-surface.json` + 反证；J 段守门 | — |
| **补丁账** | 11 | ✓ 收敛为 **0 个需移植**（§4.2） | 逐条依据 | `010`/`011` 的检索面未穷尽 |
| **打包/接线** | 1 | ✓ 产物 + profile 组合 + 正式安装；**产物自包含**（pi 包 specifier 已打进产物 ⇒ 不再依赖 profile 别名） | `dsh-build`/`dsh-smoke-profile`/`dsh-package`；A9 全量；**实测 #18-aa**（搬走仓库根别名后真 Host 仍退出码 0、0 条解析失败） | ~~profile 级 `pnpm.overrides` 未在真 profile 跑过~~ **已不需要**（产物自带 shim） |
| **场景测试** | 3 场景 | **3/3 已重建**（均为 DSH 版重写）：两实例隔离 ✓、会话续接 ✓、模式（启动期）✓ | `MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-isolation.sh`（两实例并发、各自会话/用量互不串、仓库默认台账未变、无脏目录、A 答「甲」B 答「乙」）；`MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-session-resume.sh`（两轮 sessionId 相同、会话目录数不变、插件在位、第二轮答出第一轮让它记的词）；`MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-mode.sh`（同插件：默认 `工具 53/命令 10` vs `PI_AGENT_MODE=minimal` `工具 0/命令 1`） | pi 式"运行中热切换 + 自动重启续接"在 DSH 无落点（要靠客户端/Host 重做）；pi 式"切换前否决"同样无落点 —— 均已如实记录，非待办 |
| **Host 级启动** | — | ✓✓ **已跑通**（修完 inject + defineTool 编译后复跑：**退出码 0**、插件日志 28 行、钩子在真 Host 里触发、模型真的回了「收到」）；**工具调用路径也已跑通**（prompt 强制调 `memory_stats` ⇒ DSH 会话日志记到 `tool/call name=memory_stats`、`tool/result` 内容正是 my-pi 的输出，模型据此作答）；**改名后的 `searxng` 也在真 Host 里跑通**（`tool/call name=searxng arguments={"query":"deepseek harness","maxResults":5}`，结果内容即 my-pi 的 SearXNG 降级输出，模型还如实转述了"本地 SearXNG 不可用、结果来自降级 HTTP 搜索"）；**回合用量路径也已跑通**（见 #18-v：桥接三条全拿到用量、未被改动的特性真的落盘）；**注册汇总**：`工具 53 个、命令 9 个；同名冲突跳过 2 个（命令:plan, 工具:subagent）；钩子 18 个`、`⚠️ 注册功能失败` **0 条** | `MY_PI_HOST_SMOKE=1 bash scripts/dsh-host-smoke.sh`（默认 SKIP，需显式 opt-in；凭据只临时拷一份 600 且退出即删）；`MY_PI_HOST_PROMPT=…` 可换 prompt、`MY_PI_DSH_TRACE_EVENTS=1` 看会话事件、`PI_USAGE_DIAG_FILE=` 改用量落盘位置；日志 `/tmp/dsh-host-run.log` | ✗ 3 个特性与 DSH 原生同名（见 #18-u）需产品决策；profile 级 `pnpm.overrides` 仍未用 |

### 4.1 已重建（本轮）

| 基线 | 产物 | 生成 / 守门命令 | 反证（证明守门真的会咬） |
|---|---|---|---|
| 工具声明面 | `dsh/baseline/tool-surface.json`（54 工具 / 25,761 B） | `bash scripts/dsh-baseline.sh --tools [--update]` | 篡改基线里 `web_search` 字节数 ⇒ `--check` exit 1 并点名 `合计字节 25762 → 25761`、`web_search 999→270` |
| 注入面 | `dsh/baseline/system-prompt.json`（1324 B / 4 段） | `bash scripts/dsh-baseline.sh --prompt [--update]` | 改一行 `portable/agent/APPEND_SYSTEM.md` ⇒ exit 1 并点名"渲染 sha / 源文件 / 段内容"三条；`git checkout` 复原 ⇒ exit 0 |

### 4.2 补丁账 → DSH 处置（P6 ④，2026-10-15）

pi 侧的 11 个补丁是"底座替换"的账；换到 DSH 后**没有"能不能 apply"的问题**（我们不 patch DSH），
真正的问题是**每一条能力在新底座上还需不需要**。逐条结论（依据都写出来）：

| 补丁 | 作用 | DSH 侧处置 | 依据 |
|---|---|---|---|
| 001 branding | `package.json` 品牌 | **不需要** | 不 vendor pi；品牌落在 DSH 插件名 `my-pi`（`dsh/plugin/entry.ts` 导出 `name='my-pi'`） |
| 002 local-pi-mods | vendor/pi 源码与文档改动 | **不需要（对 DSH 运行时）** | DSH 路径不加载 `vendor/pi`；该目录留给 **pi 底座**（main 分支 + `tsconfig` 类型映射）继续用 |
| 003 tab-completion | pi TUI 编辑器补全 | **不迁移** ✗ | 表现层属于客户端；DSH 的 TUI/Web 是它自己的组件，要等价能力得写 **DSH 客户端插件** |
| 004–009 footer（6 条） | pi TUI footer（速度/成本/缓存/重排/badge） | **不迁移** ✗ | 同上；我们的适配层刻意只做 `output.render` + 降级上报，不碰表现层 |
| 010 disable `/share` `/bug` | 私人助手不外发会话 | **无需对应补丁（已核对）** | `grep -rlE "'(share|bug)'" @deepseek-ai/*/lib/types/*.d.ts` = **0 命中** ⇒ DSH 未注册这两个命令。✗ 未穷尽：未扫运行时 bundle，也未扫"本项目 profile 未安装"的插件；若将来启用相关插件需复核 |
| 011 tool-search CJK 分词 | pi 的 `tool_search` 对中文 query 检索不到 deferred 工具（分词只认 `a-z0-9`，CJK 全丢） | **无对象可移植** | 已安装的 `@deepseek-ai/*` 里没有 `tool_search` 实现（类型声明里 `grep tool_search` 仅命中 `dsh-llm-pi-ai` 的 catalog）；`dsh-tools` 只有 `deferLoading?: true` 声明（`schema.d.ts:194-195`）。⚠️ **未解问题** ✗：DSH 上"deferred 工具如何被模型发现"尚未查清 —— 若它用的是某个检索器，必须复核其 CJK 行为（这正是 011 的教训） |

**结论**：补丁账在 DSH 上**收敛为 0 个需要移植的补丁**，但留下两个显式待办 ✗：
(1) 表现层等价能力（003–009）若要保留，属于 DSH 客户端插件范畴，不在本次迁移范围；
(2) `010`/`011` 的结论建立在**类型声明 + 已安装包**的检索面上，未覆盖运行时 bundle 与未安装插件。

---

## 5. 未核实（✗，本轮开工时如实登记）

1. ~~`@deepseek-ai/dsh-commands` 的命令契约**未读**~~ **已补读并实测（2026-10-16）**：
   `ctx.commands.register({name, description, input?, recordInput?, handler})`；handler 收
   `{commandId, agent, rawInput, attachments, signal}` 且**必须返回** `{kind:'success',text?}|{kind:'error',text}`
   （`dsh-commands/lib/types/index.d.ts:38-56`、`types.d.ts:20-41`）。与 pi 的三处差异都已在
   `facade.ts` 抹平并上报：① `description` 在 DSH **必填**（缺省用命令名兜底）；② `name` 必须**小写无斜杠**
   （规范化并上报）；③ 返回值形态（pi 返回 void → `CommandResult`，抛错映射为 `{kind:'error'}`）。
   另外 pi 的 `getArgumentCompletions` 在 DSH **无对应**（`input` 只有 `hint`/`attachments`）✗。
   实测：spike **A10** 用真实命令服务验通（`find()` 命中、`rawInput` 原文透传、会话身份注入、抛错映射）；
   ~~✗ `commands.execute(agent, line, …)` 需要真 agent，未验~~ **已验（2026-10-18，spike A22）**：
   真实命令服务 + 真实 Session + 最小 agent 对象下真的调用了我们的处理器（`rawInput` 前导空格保留、
   会话身份注入、抛错 ⇒ `{kind:'error'}`、未知命令 ⇒ `undefined`）；✗ 仅"loop 驱动的真 agent"那层仍留待 Host/客户端；
2. 快捷键在**内核无对应**（属客户端层）⇒ 4 处可能需要"不迁移"或改用 DSH 客户端方案；
3. 事件 `@mode` 注解的**实际驱动方**未逐个回源确认（映射表按注解口径）；
4. ~~`session/event` 观察是"提交后"⇒ 需要决策的钩子（如 `input` 改写）只能用**步级瀑布**（`agent/pre-step`）~~
   **契约级已确证（2026-10-15）**：`agent/pre-step` 是 waterfall，判定形状
   `PreStepDecision = {kind:'reject'} | {kind:'enter', messages: UserMessage[], startsRequestSeries?: true}`
   （`dsh-agent/lib/types/runtime-types.d.ts:92-99`，事件签名 `:304`）⇒ pi 的 `input` **可以**翻译为
   "替换进入该 step 的消息数组"；✗ 仍未做**运行时**验证（需要 agent + LLM）—— 但按 §5.5 的补测，
   该路径目前**没有活消费者**（4 个 `input` 处理器全是观察者）⇒ 记为潜伏能力；
5. ~~完整 profile / Host 级运行**未做**~~ **已做（2026-10-18，获用户显式授权）**：真 profile + 真模型跑通四类路径 ——
   ① 插件加载与钩子触发（退出码 0、插件日志 28 行、模型回「收到」）；② **工具调用**（强制调 `memory_stats` ⇒
   会话日志记到 `tool/call name=memory_stats`，`tool/result` 内容正是 my-pi 的输出）；③ **回合用量**（见 #18-v，
   未被改动的特性真的落盘）；④ **诊断可观测**（`MY_PI_DSH_TRACE_EVENTS=1` 能把"事件没到 / 到了没识别 /
   识别了没处理器"分开）。仍 ✗：`input.transform` 的运行时语义（`{kind:'reject'}` 是否重排消息）——
   **2026-10-18 补测：这属于"潜伏能力"而不是现实缺口**：本仓 4 个 `input` 处理器
   （autopilot/context/intervention/link）**全部只观察、没有任何一个返回改写**（`grep -n "event: 'input'" -A 25`
   逐个看过）⇒ 该映射在 DSH 上目前**没有活的消费者**；哪天有 feature 开始返回改写，才需要真 agent 验证；
   ~~`commands.execute()`~~ **已验（实测 #18-ac，spike A22）**、~~`sendUserMessage` 的唤醒/转向语义~~ **已做到实现级核实**
   （实测 #18-ab；仅"loop 跑起来后 steer 在 step 边界被消费"这层仍 ✗，需真 Host/客户端）、
   ~~P6③ 三个场景测试~~ **已全部重写并跑通（3/3）**。
   另一处如实登记的缺口：合成用量的 `cost` 是占位 0（DSH `TokenUsage` **不含定价**，已标 `costUnavailable`）——
   当前**没有任何 feature 读 `usage.cost`**（已 grep 确认），故无现实影响，但将来要算钱得另找定价源；
6. DSH 是 `0.2.0-rc.2`（RC）⇒ 接口可能变动；本轮把用到的形状**固化成本地最小类型声明**（`custom/adapters/dsh/types.ts`），
   从而"RC 变了"只需改一处，而不是散落到 223 个文件；
7. 三块同名冲突能力的**对照审计**（含"未查到"清单与检索面）见
   [`DSH-DUPLICATE-CAPABILITY-AUDIT.md`](DSH-DUPLICATE-CAPABILITY-AUDIT.md)；**处置策略已决策并落地**
   （实测 #18-x：改名 `searxng` / `subagent` 让位 / `plan` 让位命令但保留护栏），
   让位代价逐条登记在该文档 **§7**：**DR-1…DR-5（subagent 的 chain/目录扫描式 agent 定义/逐任务 `cwd`/
   进程外投递/Termux 并发降级）属"待重设计"**（需要你先定方向），**DR-6/DR-7 已解决**（命令换名 `mypi-plan`）。
