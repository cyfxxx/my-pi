# custom/adapters — 适配器层

**唯一允许 runtime import `@earendil-works/*`（Pi 包）的地方**。
上游 Pi API 变更只需改本层；feature 通过这里暴露的稳定接口接触 Pi，从而与上游解耦。

## 文件

| 文件 | 封装的 Pi API | 主要导出 |
|------|---------------|----------|
| `hook-adapter.ts` | 生命周期钩子 | `HookEvent`（由 Pi `ExtensionEvent['type']` 派生）、`HookContext`、`HookHandler`、`registerHook`、`registerHooks` |
| `tool-adapter.ts` | 工具注册 | `ToolParameter`、`ToolExecuteContext`、`ToolDefinition`、`registerTool` |
| `ui-adapter.ts` | 命令 / 快捷键 / 渲染器 / 状态 | `registerCommand`、`registerShortcut`、`registerMessageRenderer`、`sendMessage`、`sendUserMessage`、`appendEntry`、`getActiveTools`、`setActiveTools`、`getAllToolNames`、`getFlag`、`registerFlag`、`getThinkingLevel`、`setThinkingLevel`、`getMarkdownTheme`、`PiApi`，以及 pi-tui 组件 `Key/Container/Markdown/Spacer/Text/truncateToWidth/visibleWidth` |
| `session-adapter.ts` | 会话枚举 | `SessionRow`、`listSessions`、`resolveSession` |

## 关键约定

- `HookEvent` 从 Pi 类型派生而非手写清单：无效事件名（如历史上误用的 `before_tool_call`）会在 `tsc` 阶段报错。
- 工具参数用简化的 `ToolParameter` 描述，由 `tool-adapter` 编译成合法 TypeBox schema。
- `ToolExecuteContext` 是 `ExtensionContext` 的稳定子集（`hasUI` / `confirm` / `notify` / `shutdown` 等），供 `index.ts` 使用。
- `logic.ts` 及 feature 内部模块**不得** import 本层；跨层只用顶层 `import type`（编译期擦除）。

## 校验

`bash scripts/check-isolation.sh` 检查 4：`adapters/` 之外不得 runtime import Pi 包（`import type` 允许）。

## 相关

- 底座：[../core/README.md](../core/README.md)
- 功能层：[../features/README.md](../features/README.md)
