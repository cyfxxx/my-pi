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
| `__tests__/` | 26 条纯逻辑单测 | 不需要装 DSH 包即可跑 |

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
| `session_before_compact` | **服务替换**（`ctx.compaction`）而非事件 | 上报 unsupported，交由使用方替换服务 |
| `tool_call` 里**就地改参数**、`terminate` | DSH 明确排除参数改写 | 检测到即上报（`hooks.ts`） |
| pi 的 TUI 渲染（`renderCall`/`renderResult`、pi-tui 组件） | 无 | 上报；DSH 表现层走 `output.render`/`presentationMeta` |
| `ui-adapter.ts` / `session-adapter.ts` 的 **pi 运行时 import** | DSH 部署里没有 pi 包 | **尚未解决** ✗：它们静态 import `@earendil-works/pi-tui` 与 `SessionManager` ⇒ 目前只能加载不依赖它们的功能（如 `web-search`）。下一步要么注入 UI 原语，要么在 DSH profile 里提供这些包名的 shim（见计划 P5） |

## 怎么跑（可复跑证据）

```bash
bash scripts/dsh-spike.sh            # 装 DSH 包（dsh/spike/node_modules，gitignored）→ 跑真实 spike
bash scripts/dsh-spike.sh --no-install
```

spike 的 8 条检查（A1–A8）覆盖：真实服务启动、工具注册、真实执行、观察者钩子不打断流水线、
**拦截钩子真的拦住**、真实特性注册与执行、负向（未登记事件抛错）。
实测结果：**8 通过 / 0 失败**（其中 A7 是真实 `web_search` 打出 36 条结果）。

## 相关

- 迁移执行计划：[`docs/design/DSH-MIGRATION-PLAN.md`](../../../docs/design/DSH-MIGRATION-PLAN.md)
- 可行性评估（含 spike 原始输出）：[`docs/design/BASE-SWITCH-DSH.md`](../../../docs/design/BASE-SWITCH-DSH.md)
- 钩子逐类映射：[`docs/design/DSH-HOOK-MAPPING.md`](../../../docs/design/DSH-HOOK-MAPPING.md)
- 底座无关的分层约定：[`../README.md`](../README.md)
