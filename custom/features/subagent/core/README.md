# subagent/core — 角色、调度与运行

`subagent` 的纯逻辑子包（零 Pi 依赖）：角色发现、提示构建、并发调度、子进程运行。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `types.ts` | 类型定义 | 类型 |
| `agents.ts` | 角色 `.md` 解析与发现、列表 | `parseFrontmatter`、`discoverAgents`、`formatAgentList` |
| `helpers.ts` | 并发上限/环境、提示构建、输出截断、风险分级 | `getMaxParallelTasks`、`getMaxConcurrency`、`resolveAgentTools`、`buildAgentPrompt`、`classifyTaskRisk`、`riskToolRestrictions`、`mapWithConcurrencyLimit`、`truncateBytesKeepHead`、`formatTokens`（再导出）、`calculateContextTokens`、`formatUsageStats`、`getFinalOutput`、`capPreviousOutput` |
| `runner.ts` | 子进程运行单个/批量 agent、临时提示文件 | `runSubprocessAgent`、`runSingleAgent` |

## 约定

- 角色定义在 `portable/agent/agents/*.md`（frontmatter + 提示词）。
- 输出有字节上限并做头尾/并行截断（标记语义各自保留，不统一）。
- 并发上限按环境（Termux 更低）。

## 相关

- 渲染：[../ui/README.md](../ui/README.md)
- 上层：[../README.md](../README.md)
