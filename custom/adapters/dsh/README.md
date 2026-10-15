# custom/adapters/dsh — DSH 底座适配层

把 my-pi 的 **223 个特性**接到 [DSH（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 上，
**feature 一行不改**：外观层（`facade.ts`）把 DSH 的 `Context` 包装成 pi 形状的 `ExtensionAPI`，
`custom/bootstrap.ts` 因此可以直接 `bootstrap(facade.api)`。

## 文件

| 文件 | 职责 | 关键点 |
|---|---|---|
| `types.ts` | DSH 契约的**本地最小快照** | 不 import `@deepseek-ai/*`（RC 变动只改一处）；每条声明带出处 `文件:行号` |
| `events.ts` | 18 个 pi 钩子 → DSH 事件的**数据化映射** | 档位 ①11 / ②7 / ③0（与 `DSH-HOOK-MAPPING.md` §3.1 一致，单测钉住） |
| `tool.ts` | **pi 形状** `ToolDefinition` → DSH `defineTool` 载荷 | 参数 JSON Schema → 逐属性 spec；**output 通用合成**（canonical=string） |
| `hooks.ts` | pi 处理器 → DSH waterfall 监听器 | **必须调 `next()`**；`{block:true}` → `{kind:'deny'}`；无等价物显式上报 |
| `facade.ts` | DSH `Context` → pi 形状 API（18 个成员） | `surfaceReport()` 如实列出 `supported/degraded/unsupported` |
| `plugin.ts` | cordis 插件入口 `apply(ctx, config)` | 特性列表**由调用方传入**（见下） |
| `pi-shims/` | **pi 包 specifier 的等价实现**（让 DSH 侧零 pi 依赖也能加载） | 见 [pi-shims/README.md](pi-shims/README.md) |
| `__tests__/` | 35 条纯逻辑单测 | 不需要装 DSH 包即可跑 |

## 运行期调用链（实测走过的路径）

```
features/**  ──registerTool(pi, internalDef)──▶  custom/adapters/tool-adapter.ts（编译成 TypeBox + 包 execute）
                                                        │  pi 形状
                                                        ▼
                                        custom/adapters/dsh/facade.ts（本层：pi 形状 → DSH 载荷）
                                                        │
                                                        ▼
                                          ctx.tools.register(defineTool({…}))
```

### ★ 两个容易搞混的"工具定义"（迁移中真实踩到 ✗✓）

- **内部形状**（`tool-adapter.ts` 的 `ToolDefinition`）：`parameters: Record<string, ToolParameter>`、
  `execute(args, ctx) => Promise<string>`。
- **pi 形状**（`@earendil-works/pi-coding-agent` 的 `ToolDefinition`）：`parameters` 是 **TypeBox/JSON Schema 对象**、
  `execute(toolCallId, params, signal, onUpdate, piCtx) => { content, details }`。

外观层坐在 **pi 原来的位置**上 ⇒ 它拿到的是 **pi 形状**。第一版按内部形状解析，
把 TypeBox 根 schema 的 `type/properties/required/additionalProperties` 当成四个参数，
真实 spike 立刻报 `tool "web_search" returned invalid output: value is not lossless JSON`。
⇒ 现在 `tool.ts` 明确以 pi 形状为输入，并在文件头写清了这条。

## 未迁移 / 无等价物（**显式**，不静默）

| pi 面 | DSH 侧 | 处置 |
|---|---|---|
| `sendMessage` / `sendUserMessage` / `appendEntry` | 内核无"往会话里塞消息"的等价 API | 上报 unsupported（客户端 bundle 可能需要） |
| `setSessionName` | ★ 有落点：`ctx.sessionTitle.rename(session, title)`（`dsh-session-title`） | **已映射**（degraded）：会话对象由 `session/created` 跟踪；服务缺失/拿不到会话对象时**显式上报**（多会话不猜） |
| `registerShortcut` / `registerMessageRenderer` / `registerFlag` | 内核无 | 上报 |
| `getThinkingLevel` / `setThinkingLevel` | **没有同名 API**，但请求配置里有 `reasoningEffort` | API 上报 unsupported；**档位本身可表达**：`agent/request` 替换冻结配置 + `thinking-level.ts` 的纯映射（见下）|
| `getActiveTools` / `getAllTools` | ★ 有落点：`ToolRuntime.schemas()`（`dsh-tools:225`） | **已映射**（degraded）：DSH 只有"可见面"一个清单（没有全部 vs 激活两个）⇒ 两者同源；`setActiveTools` 仍降级映射到 `ctx.tools.restrict` |
| `session_before_compact` | **会话日志事件** `compaction/start`（可观察、**不可否决**） | 走 `session/event` + `type` 过滤（状态 `degraded`）；要"取消压缩"须替换 `CompactionEngine` 服务 ✗ |
| 会话身份（`ctx.sessionManager.getSessionFile()`） | 会话是**存储模型**：`SessionHeader` 只有 `id`/`createdAt`/`cwd`，无文件路径 | `deriveSessionInfo`/`withSessionContext` 合成 `getSessionId()`/`getSessionCwd()`；**不伪造文件路径**；`mode` 用 `session-key.ts` 统一取键（见下） |
| `tool_call` 里**就地改参数**、`terminate` | DSH 明确排除参数改写 | 检测到即上报（`hooks.ts`） |
| pi 的 TUI 渲染（`renderCall`/`renderResult`、pi-tui 组件） | 无 | 上报；DSH 表现层走 `output.render`/`presentationMeta` |
| `ui-adapter.ts` / `session-adapter.ts` 的 **pi 运行时 import** | DSH 部署里没有 pi 包 | **已用 `pi-shims/` 解决** ✓：把两个 specifier 别名到本仓 shim（惰性 TUI 组件 + 会话枚举降级，均显式上报）。漂移由 `__tests__/pi-shims.test.ts` 守着（新增 pi 运行期符号而忘补 shim ⇒ 测试红）|

## 怎么跑（可复跑证据）

```bash
bash scripts/dsh-spike.sh            # 装 DSH 包（dsh/spike/node_modules，gitignored）→ 跑真实 spike
bash scripts/dsh-spike.sh --no-install
```

spike 的 13 条检查（A1–A13）覆盖：真实服务启动、工具注册、真实执行、观察者钩子不打断流水线、
**拦截钩子真的拦住**、真实特性注册与执行、负向（未登记事件抛错）、**全量 bootstrap**（真实 `custom/bootstrap.ts` 的 12 个特性）、
**pi 形状命令 → 真实命令服务**（A10）、**会话生命周期真跑**（A11）、**动态上下文落点**（A12）、**会话事件桥**（A13）。
实测结果：**13 通过 / 0 失败 / 0 跳过**（A7 真实 `web_search` 打出 27–37 条结果；
A9 在**别名到本仓 shim**（即零 pi 依赖）下注册 **54 个工具、0 个特性失败**，并打印钩子桥接台账
**7 直接 / 11 降级 / 0 无等价**；A10 用真实 `@deepseek-ai/dsh-commands` 验通 `find()` 命中、
`rawInput` 原文透传、会话身份注入与抛错映射）。

### pi 包别名（A9 的前提，也是 P5 的机制验证）

`ui-adapter.ts` / `session-adapter.ts` **运行时** import `@earendil-works/pi-tui` 与 `pi-coding-agent`；
DSH-only 部署里没有这些包 ⇒ 必须把它们**别名**到等价实现（shim）或保留 vendor/pi。
`scripts/dsh-spike.sh` 现场演示了这件事：把这两个（以及 `pi-ai`/`pi-agent-core`）specifier 软链到
`node_modules/@earendil-works/*` → `vendor/pi/packages/*`，A9 即可全量加载。
**缺口 ✗**：真正的 DSH 部署不能依赖 vendor/pi；shim（惰性 TUI 组件 + 会话枚举降级）尚未实现。

## 相关

- 迁移执行计划：[`docs/design/DSH-MIGRATION-PLAN.md`](../../../docs/design/DSH-MIGRATION-PLAN.md)
- 可行性评估（含 spike 原始输出）：[`docs/design/BASE-SWITCH-DSH.md`](../../../docs/design/BASE-SWITCH-DSH.md)
- 钩子逐类映射：[`docs/design/DSH-HOOK-MAPPING.md`](../../../docs/design/DSH-HOOK-MAPPING.md)
- 底座无关的分层约定：[`../README.md`](../README.md)

### 会话身份（2026-10-16）

DSH 的 `SessionHeader` 只有 `id`/`createdAt`/`cwd`，**没有会话文件路径**，而 pi 的处理器习惯
`ctx.sessionManager.getSessionFile()`。适配层的处置：

- `hooks.ts` 的 `deriveSessionInfo`/`withSessionContext` 从 `session/created`（`{session}`）、
  `agent/created`（`{agent.session}`）与日志信封（`{header}`）读身份，合成 `getSessionId()`/`getSessionCwd()`；
- **绝不伪造 `getSessionFile()`**（伪造会让上层把键当路径用，例如写进重启请求的 `targetSession`）；
- `custom/features/mode/session-key.ts` 统一"会话稳定键"：有路径用路径，否则 `dsh-session:<id>`，
  并给出 `isSessionPath()` 供"必须真路径"的场景（重启请求）判断。

### 工具面按特性对账（2026-10-16 实测）

在真实 harness 上**逐特性**注册并计数（`dsh/spike/` 的一次性探针脚本，结论入 `DSH-MIGRATION-PLAN.md` 实测 #18-f）：

| 特性 | DSH 侧工具数 | 工具名 |
|---|---|---|
| web-search | 2 | `web_search` `fetch_url` |
| context | 3 | `edit_and_run` `session_title` `thinking_level` |
| memory | 8 | `memory_store/search/stats/forget` + `ctx_note/list/snap/exec` |
| plan-mode | 4 | `ask_user` `plan_enter` `plan_exit` `todo` |
| subagent | 1 | `subagent` |
| tmux | 6 | `tmux_run/status/read/send/stop/wait` |
| browser | 18 | `browser_navigate/screenshot/click/type/scroll/extract/evaluate/…` |
| autopilot | 12 | `admin_*` 8 + `goal` `schedule_task` `autopilot_policy` `autopilot_status` |
| link（默认关闭） | 2 | `link_send` `link_status` |
| voice（默认关闭） | 3 | `voice_record` `voice_speak` `voice_transcribe` |
| mode / intervention | 0 | 只注册钩子与命令 |
| **合计** | **59** | `full` 模式实际注册 **54**（`voice`+`link` 属 `DEFAULT_OFF_FEATURES`，见 `mode/logic.ts:404`）|

⇒ "源码里 61 处 `registerTool`" 是**静态 grep 的伪差**：其中 2 处是 `tool-adapter.ts` 的定义与调用点、
2 处是 `dsh/tool.ts` 的注释。**运行时以本表为准（59 定义 / 54 生效）**。

### thinking 档位 → `reasoningEffort`（2026-10-16）

pi 的 `thinking_level_select` 是"**选中档位时**"触发、处理器做**缓存安全夹档**；DSH **没有**这个事件 ✗，
但**应用点**存在：请求的冻结配置含 `reasoningEffort?: ReasoningEffortId`
（`dsh-llm/lib/types/call-config.d.ts:19`，模块注释 "request waterfalls replace them"）⇒ `agent/request`（waterfall）可替换它。

⇒ 正确移植形态是把夹档逻辑**搬到请求点**（每请求幂等）。本目录已提供可单测的纯映射
`thinking-level.ts`：`mapThinkingLevelToEffort(level, efforts)` 做精确/别名匹配，
**只降不升**（升档会让整段前缀缓存失效），认不出序或只有更高档位时**失败并给原因**（不猜）。
✗ 真正改配置需要模型路由（`LlmModelReasoningInfo.efforts`）⇒ 运行时未验；映射表把该事件显式标为 `degraded`。

### `before_agent_start`：每步 → 每回合一次（2026-10-16）

pi 的 `before_agent_start` 是**每回合一次**；DSH 的对应点 `agent/pre-step` 是**每步一次**
（一回合里可能有多次模型请求，负载形如 `{agent, messages, turn, step, signal}`）。
桥接层用 `dedupeKey` 按 `turn` 去重 —— **只跳过 pi 处理器，`next()` 每次都照调**
（waterfall 的 next 漏调会打挂调用链，这是本项目实测过的坑）。
负载没有回合号时**不去重**：宁可多跑一次，也不静默少跑。
该事件在 `surfaceReport()` 里是 `degraded`：提示词装配类处理器若要每步都跑，应改挂 `system-prompt/assemble`。

### `agent_settled` / `agent_end`：只在 `idle` 方向触发（2026-10-16）

DSH 的 `agent/status` 在 `running` 与 `idle` **两个方向**都发，而 pi 的 `agent_settled`/`agent_end`
只在"静置"时该跑 ⇒ 裸挂会让处理器在每个回合**开始时**也跑一遍（症状：重复记账/重复清理，且不报错）。
桥接层的 `payloadFilter` 按 `status === 'idle'` 放行；**读不到 `status` 时失败开放**
（宁可多跑一次，也不因为"认不出形状"而静默少跑一次清理）。被过滤时 `next()` **仍然照调**。

### 会话生命周期（2026-10-17 运行时已验证）

`dsh-session` 的 `SessionStore` 可以挂在最小 harness 上（服务名 **`ctx.sessions`**）：
`Session.create(id)` → `store.enter(s)`（拿到 detach disposer）→ `store.announce(s)` 发 **`session/created`**；
调用 disposer 发 **`session/disposed`**。两者的负载都是 **Session 对象本身**
（`{id, header:{version,id,createdAt,cwd?,isSeeded}}`），不是 `{session}` 包裹 ——
`deriveSessionInfo` 的第三种形状（`{header}`）正好覆盖它。

因此 `session_start` / `session_shutdown` 的**首选落点改为会话级**
（`session/created` / `session/disposed`；agent 级与 `workspace/session-stop` 作为各自时机的补充），
并由 spike **A11** 在真实服务上验证：两个处理器各触发 1 次、都拿到会话身份 ✓。

### `input`：handled ⇒ reject；transform 暂不实现（2026-10-17）

pi 的 `input` 处理器返回 `{action:'continue'|'transform'|'handled'}`，DSH 的 `agent/pre-step`
是 waterfall、判定为 `{kind:'reject'} | {kind:'enter', messages}`。当前实现：

| pi | DSH | 状态 |
|---|---|---|
| `{action:'handled'}` | `{kind:'reject'}` | ✓ 已实现（**并上报**"reject 后消息是否回到收件箱未核实"）|
| `{action:'continue'}` / `undefined` | `next()`（不干预）| ✓ |
| `{action:'transform'}` | — | ✗ **不实现**：要替换 `UserMessage` 的**不可变 content** 并保持稳定 `id`，需真 agent 验证不变量 ⇒ 按不干预处理并**显式上报**（不静默改行为）|

另：DSH 的 pre-step 负载**没有** `streamingBehavior`（steer/followUp）⇒ 该字段置空并上报；
`inputTextFromPayload` 取最后一条含文本块的 user 消息文本供处理器读 `event.text`。

### `context` / `before_provider_request`：两条 ① 评级被降档（2026-10-17）

细读契约后发现两处"最干净的对应"其实是**语义面不同**，已在映射表降为 ② 并标 `degraded`：

- **`context`**：pi 拿到的是**消息转录**且可**替换它**（`ContextEventResult {messages?}`，`types.ts:1443-1445`）；
  DSH 的 `system-prompt/assemble` 拿到的是**提示词分段/工具/变量**。转录改写只有**服务级**去处：
  `ctx.toolResultPruner`（压缩前必跑，适合"工具输出分层擦除"）与替换 `CompactionEngine`（适合"摘要去重"）；
  纯"补一段上下文"用 **`ctx.systemPrompt.context()`**（spike **A12** 实测：注入在 `assembly.contexts`
  与上下文快照里都可见，dispose 后消失）。
- **`before_provider_request`**：pi 这条能**替换整个请求负载**（我们的暖前缀处理器就返回 `{messages, tools}` 新 payload）；
  DSH 的 `agent/request` 只能换**调用配置**，而 `llm/stream` 收到的 loop 请求**深度冻结** —— 契约原话
  listeners "read it, never rewrite it"（可重建性不变量，`dsh-llm/lib/types/index.d.ts:33-44`）
  ⇒ 暖前缀"重放已记录 payload"在 DSH 上**没有对应** ✗。

### 会话事件桥：真实签名是 `(session, event)`（2026-10-17 修）

★ 修前这里有个**静默真 bug**：`session/event` 的签名是 `(session, event)`（scoped），事件在**第二参**，
而外观层按 `args[0].type` 过滤 ⇒ **所有走 `session-event` 的 pi 事件从未被触发**（多类事件、不报错）。
现在：在参数里找带字符串 `type` 的那个；把日志事件的 `data` **摊平到顶层**
（实测日志事件是 `{type,seq,time,data}`，pi 处理器习惯读 `event.turn`）；`type` 换成 **pi 的事件名**；
原始 `data`/`seq`/`time` 保留。spike **A13** 用真实 `Session.append()` 验证（各触发 1 次、type 不串台）。

✗ 仍有**字段名差异**（不是触发问题）：`turn/end` 的 data 只有 `{turn,reason}`（pi 读 `event.message`）、
`message_update` 的 pi 字段是 `assistantMessageEvent` 而 DSH 是**有序帧** ⇒ 这类要字段翻译或改处理器，
已在映射表逐条标注。
