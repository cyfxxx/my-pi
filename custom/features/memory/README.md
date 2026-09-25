# memory — 跨会话持久记忆

跨会话记忆库：存储 → 检索（BM25 + MMR + 会话轮转）→ 注入 → 治理（合并/淘汰/升格）→ 教训挖掘。

## 注册面

- 工具：`memory_store`、`memory_search`、`memory_recall`、`memory_stats`、`memory_forget`
- 命令：`/memory <search|stats|summary|lifecycle|mine [--ingest]|prune|cleanup|help>`
- 钩子：`session_start`、`before_agent_start`、`context`、`session_compact`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令/钩子；工具输出格式化 |
| `logic.ts` | 纯逻辑 barrel |
| `env.ts` | 运行环境识别与可见性过滤（`ENVIRONMENTS`/`detectEnvironment`/`isEnvVisible`） |
| `store/` | 记忆存储子包，见 [store/README.md](store/README.md) |
| `recall/` | 检索与注入子包，见 [recall/README.md](recall/README.md) |
| `mine/` | 治理与教训挖掘子包，见 [mine/README.md](mine/README.md) |

## 数据落点（`portable/memory/`）

| 文件 | 内容 | 覆盖变量 |
|------|------|----------|
| `entries.json` | 记忆条目 | `PI_MEMORY_DIR` |
| `summaries.json` | 会话摘要 | — |
| `notes.json` | TTL 笔记 | — |
| `memory-search.jsonl` | 检索台账（轮转 4MB） | `PI_MEMORY_TRACE_FILE` |
| `interventions.jsonl` | 只读，教训挖掘来源 | `PI_INTERVENTIONS_FILE` |

## 关键环境变量

`PI_MEMORY_DIR`（数据根）、`PI_MEMORY_ENV`（本机环境标签）、`PI_MEMORY_INJECT_TOKENS`（注入预算 token）。

## 依赖

- `recall/inject.ts` 反向依赖 `context/logic` 的 `estimateTokens`/`truncateByTokens`（跨功能只走 logic barrel）。

## 相关

- 检索/注入：[recall/README.md](recall/README.md)
- 治理/挖掘：[mine/README.md](mine/README.md)
- headless 入口（定时任务无扩展工具/命令）：`scripts/memory-store.mjs`（入库）、`scripts/memory-lifecycle.mjs`（生命周期报告），均须经 `bash scripts/run-ts.sh` 运行
