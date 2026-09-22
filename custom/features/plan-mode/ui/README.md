# plan-mode/ui — 视图与面板

`plan-mode` 的 UI 子包。`view.ts` 为纯逻辑（零 Pi）；`overlay.ts` 经 `adapters/ui-adapter` 使用 pi-tui。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `view.ts` | 纯逻辑视图/序列化：状态标签与标记、行格式化、plan 文件序列化 | `STATUS_LABEL`、`formatStatusLabel`、`statusMarker`、`formatCommandTaskLine`、`formatPlanMessageLine`、`formatListLine`、`formatGetLines`、`renderPlanFile`、`parsePlanFile` |
| `overlay.ts` | `TodoOverlay`：经 `ctx.ui.setWidget` 注册 aboveEditor 任务面板 | `TodoOverlay` |

## 约定

- 面板宽度处理用 pi-tui 的 `truncateToWidth`/`visibleWidth`（ANSI/CJK 感知），**不能**用 `core/text` 的字符截断替代。
- 状态标记统一由 `statusMarker` 产出（消息与面板一致）。

## 相关

- 状态/选择器：[../core/README.md](../core/README.md)
- 上层：[../README.md](../README.md)
