# DSH 换基座：执行计划（分支 `feat/base-switch-dsh`）

> 前置分析：[`BASE-SWITCH-DSH.md`](BASE-SWITCH-DSH.md)（可行性 + spike 实测）、
> [`DSH-HOOK-MAPPING.md`](DSH-HOOK-MAPPING.md)（18 个钩子的逐类映射）。
> 状态：**已开工**（2026-10-15，用户指示"继续后续的转移"）。本文是**执行**文档，
> 与上面两篇"评估"文档分工：评估回答"能不能换、代价在哪"，本文回答"**怎么换、换到哪一步算过**"。
>
> 纪律（沿用本项目）：**宁可显示缺口，也不显示虚假的绿色**；每条结论带可复跑命令或 `文件:行号`；
> 未验证的一律标 ✗。

---

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
| **P1 映射层** | `custom/adapters/dsh/{events,tool,hooks}.ts` | `npx vitest run custom/adapters/dsh` 全绿；18 个事件 100% 有档位 | ✓ **26/26 单测通过** |
| **P2 外观层** | `custom/adapters/dsh/facade.ts` | 单测：注册工具、`on` 桥接、waterfall 纪律、unsupported 显式上报 | ✓ |
| **P3 真实 spike** | `dsh/spike/**` + `scripts/dsh-spike.sh` | 脚本跑通真实 `@deepseek-ai/*`：注册的工具**被真实注册表调用**、事件**真触发**、拦截**真生效** | ✓ **8/8 通过**（真实包 `0.2.0-rc.2` + cordis 4.0.4） |
| **P4 一个特性端到端** | 真实特性 `custom/features/web-search` 经 `tool-adapter` → 外观层 → DSH 注册表 | spike 里 `web_search` **真实执行并返回 36 条结果** | ✓（选它的原因：唯一不 import pi 运行时包的特性） |
| **P5 引导与配置** | ① pi 包 **shim**（`custom/adapters/dsh/pi-shims/`，35 条单测含漂移守门）② **插件产物 + profile 接线**（`dsh/plugin`、`dsh/profile`、`scripts/dsh-build.sh`、`scripts/dsh-smoke-profile.sh`） | ①✓ 零 pi 依赖下 A9 仍 54 工具 / 0 失败；②✓ **真实 launcher 已接受插件进 profile**（隔离 DSH_HOME 的 `--dump-config` 干跑：基线条目 96 → 出现 `id: my-pi`）；**Host 级启动仍待做** ✗ | **①②完成 / Host 待做** |
| **P6 守门重建（D 块）** | ① 工具声明面基线 ② **注入面基线**（`dsh/baseline/system-prompt.json`）③ 场景测试 ④ **补丁账处置表**（§4.2） | ①✓ 54 工具 / **25,761 B**（反证：篡改工具字节 ⇒ 点名 `web_search 999→270`）；②✓ **注入面接线 + 基线**：`APPEND_SYSTEM.md` 注册为 DSH 提示段（order=2500，实测是渲染结果**结尾**），基线哈希 `renderPrompt(assemble())`（反证：改源文件 ⇒ exit 1，点名渲染 sha / 源文件 / 段内容三条漂移；复原 ⇒ exit 0）；④✓ **补丁账收敛为 0 个需移植**（§4.2：001/002 不需要、003–009 属客户端插件、010 已核对 DSH 无 `/share` `/bug`、011 无对应实现但留下 deferred 工具发现机制的待查 ✗）；③待做 ✗ | **①②④完成 / ③待做** |

> P5 的完整 Host 在本机内存（约 1.8–2.5 GB 可用）与"不要打扰正在跑的 GUI"两条约束下**不轻率执行** ✗；
> 先做 P3/P4 的**契约级真实运行**（真包、真注册表、真事件），把"能不能搬"钉死，再决定 Host 级验证的时机。

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

1. `@deepseek-ai/dsh-commands` 的命令契约**未读** ⇒ `registerCommand`（14 处）能否干净映射待验；
2. 快捷键在**内核无对应**（属客户端层）⇒ 4 处可能需要"不迁移"或改用 DSH 客户端方案；
3. 事件 `@mode` 注解的**实际驱动方**未逐个回源确认（映射表按注解口径）；
4. ~~`session/event` 观察是"提交后"⇒ 需要决策的钩子（如 `input` 改写）只能用**步级瀑布**（`agent/pre-step`）~~
   **契约级已确证（2026-10-15）**：`agent/pre-step` 是 waterfall，判定形状
   `PreStepDecision = {kind:'reject'} | {kind:'enter', messages: UserMessage[], startsRequestSeries?: true}`
   （`dsh-agent/lib/types/runtime-types.d.ts:92-99`，事件签名 `:304`）⇒ pi 的 `input` **可以**翻译为
   "替换进入该 step 的消息数组"；✗ 仍未做**运行时**验证（需要 agent + LLM，属 Host 级，见 P5②）；
5. 完整 profile / Host 级运行**未做**（内存与"别打扰 GUI"两条约束）⇒ P4 的端到端目前是**契约级**；
6. DSH 是 `0.2.0-rc.2`（RC）⇒ 接口可能变动；本轮把用到的形状**固化成本地最小类型声明**（`custom/adapters/dsh/types.ts`），
   从而"RC 变了"只需改一处，而不是散落到 223 个文件。
