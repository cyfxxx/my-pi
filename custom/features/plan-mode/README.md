# plan-mode — 计划模式

只读探索 + 任务面板：进入后在 `tool_call` 阶段拦截 edit/write，bash 只放行只读单命令（`isReadonlyBashCommand`），**不改工具集**（变更 selectedTools 会让整段前缀缓存失效），用 `todo` 工具维护任务，TUI 显示进度面板。

## 注册面

- 工具：`todo <create|update|list|get|delete|clear>`
- 命令：`/plan <enter|exit|resume|todos|clear|help>`
- 快捷键：一条（见 `index.ts` 的 `registerShortcut`）
- 钩子：`session_start`、`session_shutdown`、`tool_call`（plan 模式下拦截写操作）
- footer 标识：`ctx.ui.setStatus('badge:plan', '⏸ 计划模式')`（vendor 补丁 009 的 `badge:` 前缀约定 → 渲染在**第一行** `~/my-pi (main)` 旁；退出时传 `undefined` 清除）

## 常驻标识（为什么不是 notify）

进入计划模式会让 edit/write/非只读 bash 全部被拦截，用户必须随时知道自己在不在这个模式里。
此前只有一次性 `ctx.ui.notify`（提示一滚出屏幕就没有任何线索）和需要主动查询的 `/plan status`。
现在由 `applyPlanMode()` 统一同步 footer 标识——它是**唯一**的状态变更出口，所以 `/plan enter|exit`、
`Ctrl+Alt+P`、模型的 `plan_enter`/`plan_exit` 以及 `/plan resume` 都会自动联动，不会出现"改了一处漏一处"。

UI 上下文在 `session_start` 捕获一次（`captureUI`），命令/快捷键/工具里再抓一次作为兜底
（同一会话内 ui 对象稳定，重复赋值无副作用；非交互环境无 `setStatus`，静默跳过）。

> 为什么需要 vendor 补丁：footer 第一行是硬编码的 `pwd (branch) • sessionName`，扩展的
> `setStatus` 只能落到第三行状态行。补丁 009 把 `badge:` 前缀的状态改为渲染到第一行并高亮，
> 其余 key 行为不变。详见 [../../../patches/README.md](../../../patches/README.md)。

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
