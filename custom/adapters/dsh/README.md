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
| `getThinkingLevel` / `setThinkingLevel` | 无 thinking-level 概念 | 上报（DSH 的思考级别是适配器配置） |
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

spike 的 9 条检查（A1–A9）覆盖：真实服务启动、工具注册、真实执行、观察者钩子不打断流水线、
**拦截钩子真的拦住**、真实特性注册与执行、负向（未登记事件抛错）、**全量 bootstrap**（真实 `custom/bootstrap.ts` 的 12 个特性）。
实测结果：**9 通过 / 0 失败 / 0 跳过**（A7 真实 `web_search` 打出 34–36 条结果；
A9 在**别名到本仓 shim**（即零 pi 依赖）的情况下注册 **54 个工具、0 个特性失败**）。

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
