# subagent/ui — 结果渲染

`subagent` 的 UI 子包，经 `adapters/ui-adapter` 使用 pi-tui（`Container`/`Text`/`Markdown`）。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `rendering.ts` | 工具调用/结果渲染（单任务/链式/并行）、用量聚合 | `getDisplayItems`、`formatToolCall`、`renderSingleResult`、`renderChainResult`、`renderParallelResult` |

## 约定

- 主题经 `ThemeLike` 结构类型（`fg`/`bold`），由 `index.ts` 传入的 Pi 主题对象满足。
- 折叠展示条目数、分隔线等展示细节在此层，保持纯逻辑层的 `helpers.ts` 不接触渲染。
