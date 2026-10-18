# 模式（mode）对照：原项目 `/mode` vs DSH 原生

> 结论：**DSH 的 agent preset 能替代原项目 mode 的核心**（"这个会话挂哪些能力"），
> 且因为是"会话创建时选"，天然不需要原项目那套"重启 + 续接"。
> 但原项目 mode 的另外三件事——思考档位、人设、记忆命名空间——在 DSH 里**不在同一个开关上**，需要各自落位。

## 1. 原项目 mode 是什么（`custom/features/mode`）

- **会话作用域**的启动档位：新会话用 `modes.json` 的 `default`，续接会话用该会话上次记录的模式；
- 决定：注册哪些功能（工具集）、思考档位、人设追加、长期记忆命名空间；
- 因为 pi 在启动时注册工具、运行中不能卸载，`/mode` 会**自动提交重启并续接会话**；
- 内置 `full`/`minimal`，自定义 `roleplay`/`lean`；`voice`/`link` 默认关。

## 2. DSH 有什么

| 能力 | DSH 对应 | 粒度 | 备注 |
|---|---|---|---|
| 会话挂哪些插件/工具 | **`dsh-agent-preset`（+ registry）** | **会话创建时选择**，定义可热改（影响之后新建的 Agent） | 我们已用：`MYPI_AGENT_PRESET=local`（瘦身档） |
| 计划模式 | `dsh-plan-mode` | 会话内开关 | 与 mode 正交 |
| 思考档位 | 模型选择器里的 reasoning effort | 每次模型调用 | 不是"模式"的一部分 |
| 人设 | `dsh-persona`（`personaPrefix`/`suffix`） | profile / 组合层 | 可按 preset 的插件行配置 |
| 记忆命名空间 | **无原生**；我们用 `MYPI_MEMORY_FILE` / `environments` 模拟 | 进程/条目 | 见 §4 |

## 3. 映射建议

| 原 mode | DSH 落法 | 状态 |
|---|---|---|
| `full`（全部功能） | 标准 preset（默认） | ✅ 现成 |
| `lean`（去 browser/voice/link/autopilot） | 我们已写的 `local` preset（fs/bash/web + compaction） | ✅ 已在用（`MYPI_LEAN_TOOLS=1`） |
| `minimal`（只有内置工具） | 空 preset（只留内置工具，不挂自定义插件） | 待写（5 行 YAML） |
| `roleplay`（web-search + memory，隔离记忆） | 自建 preset：`tool-web` + 记忆插件 + 独立 `MYPI_MEMORY_FILE` | 待写（需要给插件加一个"记忆库路径"配置项） |

**切换方式**：原项目是"`/mode` → 重启 → 续接"；DSH 是"**新建会话时选 preset**"。
如果确实要"同一会话中途换档"，DSH 没有这条路（工具集在 Agent 生命周期内固定），
但可以用"新会话 + 把旧会话摘要带过去"（我们的会话摘要正好能承担这个角色）。

## 4. 记忆命名空间

- 插件在 `apply()` 时读 `MYPI_MEMORY_FILE`（进程级），所以**不同 preset 想用不同记忆库，目前只能靠不同进程/home**；
- 想做到"每个会话/模式一个命名空间"，需要给插件加一个 `memoryFile` **配置项**（preset 的插件行可以直接配），
  并在 `storeEntry` 里带上命名空间标签。这是个小改动（约 30 行），等 `roleplay` 真要用时再做。

## 5. 结论

- **能替代**：mode 的核心（能力集）→ DSH preset，而且更干净（不用重启、不用续接）；
- **不能一对一替代**：思考档位/人设/记忆命名空间，它们在 DSH 里是别的开关；
- **建议**：把"模式"这个词从 DSH 侧收进文档（叫 preset），
  需要 `minimal`/`roleplay` 时按 §3 补两个 preset，而不是复刻原项目的 mode 机制。
