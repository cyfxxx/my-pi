# intervention — 干预捕获

用户中断（Esc 等）时快照上下文，并把随后的纠正意图关联回该次中断，用于反思与教训挖掘。

## 注册面

- 命令：`/intervention <recent|stats|help>`
- 钩子：`input`、`before_agent_start`、`tool_execution_start`、`agent_end`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册命令/钩子；状态跟踪与输出 |
| `logic.ts` | 纯逻辑：`buildRecord`、`extractAssistantTail`、`isAbortedEnd`、`linkCorrective`、`summarize`、JSONL 读写（`readLines`/`writeLines`/`appendRecord`） |

## 数据落点

- `portable/memory/interventions.jsonl`（`PI_INTERVENTIONS_FILE` 覆盖）。
- 采用「读全量 → 追加 → 原子整写」并设上限 `MAX_RECORDS`（与追加式日志语义不同，刻意为之）。

## 相关

- 数据被 `memory/mine` 的教训挖掘读取，以及 autopilot 度量读取（均按数据文件解耦）。
