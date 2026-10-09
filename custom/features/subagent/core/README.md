# subagent/core — 角色、调度与运行

`subagent` 的纯逻辑子包（零 Pi 依赖）：角色发现、提示构建、并发调度、子进程运行。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `types.ts` | 类型定义 | 类型 |
| `agents.ts` | 角色 `.md` 解析与发现、列表 | `parseFrontmatter`、`discoverAgents` |
| `helpers.ts` | 并发上限/环境、提示构建、输出截断、风险分级 | `getMaxParallelTasks`、`getMaxConcurrency`、`resolveAgentTools`、`buildAgentPrompt`、`classifyTaskRisk`、`mapWithConcurrencyLimit`、`truncateBytesKeepHead`、`formatTokens`（再导出）、`calculateContextTokens`、`formatUsageStats`、`getFinalOutput`、`capPreviousOutput` |
| `runner.ts` | 子进程运行单个/批量 agent、临时提示文件 | `runSubprocessAgent`、`runSingleAgent` |
| `usage-log.ts` | 子代理用量落盘（`<memoryDir>/subagent/usage.jsonl`，因 `--no-extensions` 不进 diag/TUI）。记录除用量外还带**三个可观测字段**：`writeTools`（用过的文件编辑类工具名）、`writePaths`（改动过的文件路径）、`parentSession`（派它的父会话文件）——前两个服务于返工指标，第三个用于**精确归属**（否则并发会话改同一文件会被误算成返工）。提取口径：只认 `write/edit/edit_and_run`，**故意不含 `bash` 等 catch-all**（含进来会让字段恒为非空、信息量归零）⇒ 是「用过编辑类工具」的**下界** | `recordSubagentUsage`、`buildUsageRecord`、`subagentUsageFile`、`extractWriteTools`、`extractWritePaths`、`WRITE_TOOLS`、`WRITE_PATH_KEYS`、`WRITE_PATHS_MAX` |
| `pool-metrics.ts` | 常驻池的**复用度量**（P9，2026-10-08）：每次租借落一条 `<memoryDir>/logs/subagent-pool.jsonl`（`reused=false` 即**新起了一个进程**）；fail-open，写不进绝不影响执行 | `recordPoolLease`、`buildPoolLeaseRecord`、`subagentPoolLogFile` |
| `__tests__/wiring-args.test.ts`（守门） | **源码级参数转发守门**：断言 `runPooledAgent`/每个 `runSubprocessAgent` 调用处都带 `allowExtensions` 与 `parentSession`。起因是 2026-10-08 实测发现池化路径**漏传 `allowExtensions`** ⇒ 静默忽略 `extensions`；而两者都是**可选参数**，漏传 `tsc` 不报错、单测也看不见接线 | — |

## 约定

- 角色定义在 `portable/agent/agents/*.md`（frontmatter + 提示词）。
- 输出有字节上限并做头尾/并行截断（标记语义各自保留，不统一）。
- 并发上限按环境（Termux 更低）。

## 相关

- 渲染：[../ui/README.md](../ui/README.md)
- 上层：[../README.md](../README.md)
