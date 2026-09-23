# mode — 模式（启动档位）

模式决定**注册哪些自定义功能**、思考档位、人设追加与长期记忆命名空间。因 pi 在启动时
注册工具、无法运行时卸载，功能/人设/命名空间的变更需重启生效；思考档位可即时切换。

## 模式

| 名称 | 来源 | 功能 | 说明 |
|------|------|------|------|
| `full` | 代码锁定 | 全部 12 个 | 开发项目 |
| `minimal` | 代码锁定 | 无（仅内置工具 + `/mode`） | 测试/修复 |
| `roleplay` | `modes.json` | `web-search`、`memory`（隔离命名空间 `roleplay`） | 日常交流角色扮演 |

`full`/`minimal` 由 `FIXED_MODES`（`logic.ts`）定义，`modes.json` 无法覆盖；文件只存自定义模式。

## 注册面

- 命令：`/mode <list|help|模式名>`
- 钩子：`session_start`（非 full 时提示当前模式）

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册命令/钩子；切换与提示 |
| `logic.ts` | 模式定义/读写/归一化、`resolveEffectiveMode`、`isFeatureEnabled`、`applyModeRuntime` |

## 配置与落点

| 路径 | 内容 |
|------|------|
| `portable/agent/modes.json` | `current` + 自定义模式（如 roleplay） |
| `portable/agent/modes/<name>.md` | 人设文件（`appendPrompt`，经 `pi --append-system-prompt` 注入） |

环境变量：`PI_AGENT_MODE`（覆盖当前模式）、`PI_MEMORY_NAMESPACE`（记忆命名空间，由启动器注入）。

## 生效链路

1. `bootstrap.ts` 读 `resolveEffectiveMode()`，按 `isFeatureEnabled` 过滤 `FEATURES` 后注册（`mode` 恒注册）。
2. `scripts/pi-supervisor.sh` 每轮启动前解析 `modes.json`：设 `PI_MEMORY_NAMESPACE`、按 `appendPrompt` 追加人设。
3. `memory` 功能的 `store/io.ts` 的 `dataDir()` 追加命名空间 → 隔离长期记忆。
