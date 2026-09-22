# context — Token 优化中枢

钩子型扩展：围绕「缓存友好」做上下文预算、剪枝、压缩去重、工具分层、thinking 档位与任务记账。
是 12 个功能里钩子最多、预算子系统最大的一个。

## 注册面

- 工具：`enable_tool`、`thinking_level`
- 命令：`/context <usage|report|help>`、`/tools <list|enable <组>|help>`
- 钩子：`session_start`、`before_agent_start`、`context`、`tool_call`、`tool_result`、`turn_end`、`session_compact`、`agent_settled`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令/钩子；编排各预算模块 |
| `logic.ts` | 纯逻辑 barrel + 注入文本常量（`extractUserRequest`/`hasInProgressTask`/`EFFICIENCY_ADVICE`） |
| `usage-stats.ts` | 工具调用用量/缓存命中 JSONL 记账与汇总 |
| `budget/` | 预算子包，见 [budget/README.md](budget/README.md) |

## 数据落点（`portable/memory/`，可环境变量覆盖）

| 文件 | 内容 | 覆盖变量 |
|------|------|----------|
| `context/usage.jsonl` | 工具调用用量/缓存（轮转 4MB） | `PI_USAGE_FILE` |
| `task-records.jsonl` | 每轮任务结构记录（供 task-summarizer） | `PI_TASK_RECORD_FILE` |
| `logs/level-changes.jsonl` | thinking 档位变更审计 | `PI_LEVEL_CHANGE_FILE` |
| `logs/prune-refs/` | 工具输出擦除溯源 ref | `PI_PRUNE_REFS_DIR` |
| `checkpoints/` | 压缩前快照 | `PI_COMPACT_SNAPSHOT_DIR` |
| `tool-outputs/` | 工具输出归档 | `PI_OUTPUT_ARCHIVE_DIR` |
| `tmux-registry.json` | 只读，用于背景任务判定 | `PI_TMUX_REGISTRY` |

## 关键环境变量

`PI_CONTEXT_THINKING_AUTO=off`（关自动切档）、`PI_CONTEXT_TASK_GATE`、`PI_CONTEXT_WINDOW_FALLBACK`、`PI_DISABLE_LEVEL_AUDIT`、`PI_DISABLE_PRUNE_DUMP`、`PI_DISABLE_TASK_RECORD`、`PI_CONTEXT_RATIO_TEST`、`PI_SESSION_ID`。

## 缓存纪律

注入文本保持稳定前缀，**禁止注入精确 token 数值**（小数变动会破坏前缀缓存）；因此压缩/压力提示使用静态文本。

## 相关

- 预算子包：[budget/README.md](budget/README.md)
- 只读依赖 `plan-mode/logic` 的 `getTodos`（跨功能引用走 logic barrel）与 `memory/recall` 反向依赖本功能的 `logic`。
