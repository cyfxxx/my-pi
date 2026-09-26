# plan-mode/core — 状态与选择器

`plan-mode` 的纯逻辑子包（零 Pi 依赖）：任务状态机、进程内存储、计划落盘/磁盘恢复、只读判定、选择器。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `state.ts` | 任务/状态类型与合法转移 | `EMPTY_STATE`、`VALID_TRANSITIONS`、`isTransitionValid`、`applyTaskMutation` |
| `store.ts` | 进程内状态存储（模块级） | `getTodos`、`getState`、`replaceState`、`commitState`、`resetState`、`getNextId` |
| `plans.ts` | 计划落盘与磁盘恢复（plan.md 渲染/解析/清理） | `renderPlanFile`、`parsePlanFile`、`writePlanFile`、`restoreStateFromPlans`、`cleanupOldPlans`、`listPlans` |
| `readonly.ts` | 判断 bash 命令是否只读（plan 模式下放行） | `isReadonlyBashCommand` |
| `selectors.ts` | 视图选择器 | `selectVisibleTasks`、`selectTasksByStatus`、`selectTodoCounts`、`selectHasActive`、`selectOverlayLayout` |

## 约定

- 状态以进程内为准（`store.ts`），任务变化时由 `plans.ts` 落盘到 `<memoryDir>/plans/plan-<ts>/plan.md`、启动时恢复；`ui/view.ts` 提供序列化工具供往返复用。
- 被 `context/index.ts` 通过 `getTodos` 读取（跨功能只走 `logic.ts`）。

## 相关

- 视图：[../ui/README.md](../ui/README.md)
- 上层：[../README.md](../README.md)
