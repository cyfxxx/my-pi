# subagent — 子代理

把任务委派给专门 agent（可并行/串行链），隔离上下文、复用角色定义。

## 上下文模式：spawn / fork

`subagent` 的 `context` 参数决定子代理的起点（默认 `spawn`）：

| 模式 | 子进程参数 | 含义 | 何时用 |
|------|-----------|------|--------|
| `spawn` | `--no-session` | 空上下文，只有 system + 工具声明 + 任务 | 默认；任务自包含、不需要父会话 |
| `fork` | `--fork <父会话文件>` | 继承父会话历史（pi 新建 fork 会话） | 需要父上下文的**短任务**，且**紧接**父会话请求时 |

fork 的成本逻辑：父会话刚发过请求时，那段前缀在 provider 侧是**暖的**，子代理首请求按 cacheRead
计价（约为全价的 1/50）——所以"既拿到上下文又便宜"；反之若缓存已冷，就要为整段历史付全价。
因此它是**显式 opt-in**，不是默认。拿不到 `ctx.sessionFile`（headless/无会话）时静默退回 spawn。

对齐 DSH 的 fork/spawn 之分（见 `docs/development/DSH-RUNTIME-AUDIT.md`）。

## 注册面

- 工具：`subagent`
- 钩子：`session_start`

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具；`renderCall`/`renderResult` 渲染；本地 provider 判定 |
| `logic.ts` | 纯逻辑 barrel |
| `core/` | 纯逻辑子包（角色发现/提示构建/并发调度/子进程运行），见 [core/README.md](core/README.md) |
| `ui/` | 渲染子包（`rendering.ts`），见 [ui/README.md](ui/README.md) |

## 数据与配置

- 角色定义：`portable/agent/agents/*.md`（frontmatter + 提示词，随仓库分发）。
- 活跃计划：`portable/memory/plans/<plan>/plan.md`（若存在则并入提示词）。
- settings.json：仅在拿不到会话实时 provider 时回退读取，判断是否本地模型（`currentProviderIsLocal`）。

## 模型选择

子代理模型优先级（高 → 低），由 `core/runner.ts` 的 `resolveModelId` 解析：

1. 调用级 `model`（工具参数 `model`，或 tasks/chain 每项的 `model`）——主模型可为子任务挑模型；
2. agent `.md` frontmatter 的 `model:`——角色固定；
3. 主会话实时模型 `ctx.model`（`provider/id`）——**默认继承**，无则不传；
4. 都不满足时不传 `--model`，子进程用 settings.json 默认（`freellmapi/auto`）。

`tool-adapter` 从 Pi `ExtensionContext` 提取 `model`/`cwd` 注入 `ToolExecuteContext`；并发上限按会话实时 provider 判定是否本地。

## 并发与安全

- 并发上限按环境区分（Termux 更低）：`MAX_PARALLEL_TASKS`/`MAX_CONCURRENCY`/`TERMUX_*`，由 `getMaxParallelTasks`/`getMaxConcurrency` 解析。
- 只读工具白名单 `READONLY_ALLOWED_TOOLS` 与风险分级 `classifyTaskRisk`/`riskToolRestrictions`。
- 子代理输出有上限（`PER_TASK_OUTPUT_CAP`/`PREVIOUS_OUTPUT_CAP_BYTES`）并做头尾截断。

## 相关

- 角色目录：[../../../portable/agent/agents/](../../../portable/agent/agents/)
