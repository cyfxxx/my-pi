# plan-mode — 计划模式

只读探索 + 任务面板：进入后禁用编辑/写入/bash（只读探索），用 `todo` 工具维护任务，TUI 显示进度面板。

## 注册面

- 工具：`todo <create|update|list|get|delete|clear>`
- 命令：`/plan <enter|exit|resume|todos|clear|help>`
- 快捷键：一条（见 `index.ts` 的 `registerShortcut`）
- 钩子：`session_start`、`session_shutdown`、`tool_call`（plan 模式下拦截写操作）

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令/快捷键/钩子；`formatContent` 输出 |
| `logic.ts` | 纯逻辑 barrel（re-export core + ui/view） |
| `core/` | 纯逻辑子包，见 [core/README.md](core/README.md) |
| `ui/` | TUI 子包（面板 + 视图/序列化），见 [ui/README.md](ui/README.md) |

## 状态与数据

- 任务状态以**进程内**为准（`core/store.ts` 的模块级 state，`getState`/`commitState`）；任务变化时经 `index.ts` 的 `syncPlanToFile` 落盘到 `<memoryDir>/plans/plan-<ts>/plan.md`（写盘由 `core/plans.ts` 承担），启动时由 `restoreStateFromPlans` 恢复最近的未完成计划（`cleanupOldPlans` 只留最近 20 份）。
- `ui/view.ts` 提供 `renderPlanFile`/`parsePlanFile` 序列化工具（供往返/持久化复用）。
- subagent 运行时若发现 `portable/memory/plans/<plan>/plan.md` 会作为「活跃计划」并入子代理提示词。

## 相关

- 被 `context/index.ts` 引用：`getTodos`（跨功能只走 `logic.ts`）。
