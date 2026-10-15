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
| `sendMessage` / `sendUserMessage` / `appendEntry` / `setSessionName` | 内核无等价服务 | 上报 unsupported（客户端 bundle 可能需要） |
| `registerShortcut` / `registerMessageRenderer` / `registerFlag` | 内核无 | 上报 |
| `getThinkingLevel` / `setThinkingLevel` | **没有同名 API**，但请求配置里有 `reasoningEffort` | API 上报 unsupported；**档位本身可表达**：`agent/request` 替换冻结配置 + `thinking-level.ts` 的纯映射（见下）|
| `getActiveTools` / `getAllTools` | 无公开列举 API | 上报；`setActiveTools` 降级映射到 `ctx.tools.restrict` |
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

spike 的 10 条检查（A1–A10）覆盖：真实服务启动、工具注册、真实执行、观察者钩子不打断流水线、
**拦截钩子真的拦住**、真实特性注册与执行、负向（未登记事件抛错）、**全量 bootstrap**（真实 `custom/bootstrap.ts` 的 12 个特性）、
**pi 形状命令 → 真实命令服务**（A10）。
实测结果：**10 通过 / 0 失败 / 0 跳过**（A7 真实 `web_search` 打出 27–37 条结果；
A9 在**别名到本仓 shim**（即零 pi 依赖）下注册 **54 个工具、0 个特性失败**，并打印钩子桥接台账
**12 直接 / 6 降级 / 0 无等价**；A10 用真实 `@deepseek-ai/dsh-commands` 验通 `find()` 命中、
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
