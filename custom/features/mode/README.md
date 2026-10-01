# mode — 模式（启动档位）

模式决定**注册哪些自定义功能**、思考档位、人设追加与长期记忆命名空间。因 pi 在启动时注册工具、
运行中无法卸载，功能/人设/命名空间的变更**需要重启**——`/mode <name>` 会自动提交重启请求并
续接当前会话（不是让你手动重启）；思考档位可即时切换。

## 模式

| 名称 | 来源 | 功能 | 说明 |
|------|------|------|------|
| `full` | 代码锁定 | 全部 12 个 | 开发项目 |
| `minimal` | 代码锁定 | 无（仅内置工具 + `/mode`） | 测试/修复 |
| `roleplay` | `modes.json` | `web-search`、`memory`（隔离命名空间 `roleplay`） | 日常交流角色扮演 |
| `lean` | `modes.json` | `web-search`、`context`、`memory`、`plan-mode`、`intervention`、`subagent`、`tmux` | 成本敏感会话：去掉 `browser`/`voice`/`link`/`autopilot` 四组工具 |

`lean` 的依据（2026-10-01 实测，守门 `context/__tests__/tools-payload.test.ts`）：本仓库 12 个功能注册
**62 个工具、合计 28.5 KB**（请求里 `toolsBytes` 62.4 KB，其余约 33 KB 是 pi 内置工具）——
其中 `autopilot` 6.4 KB、`browser` 6.3 KB、`voice` 1.0 KB、`link` 0.8 KB。模式白名单在**启动期**过滤功能，
未注册即 0 字节，且整个会话内工具数组不变（缓存安全；见 `DECISIONS.md` 的"不做热重载"与
"不要会话中途改工具集"）。

`full`/`minimal` 由 `FIXED_MODES`（`logic.ts`）定义，`modes.json` 无法覆盖；文件只存自定义模式。

## 注册面

- 命令：`/mode <list|help|模式名>`
- 钩子：`session_start`（启动一致性校验 + 非 full 时提示当前模式）

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册命令/钩子；切换、自动重启请求、一致性校验 |
| `logic.ts` | 模式定义/读写/归一化、`resolveEffectiveMode`、`isFeatureEnabled`、`applyModeRuntime` |

## 数据：配置与运行时状态**分开**

| 路径 | 内容 | 入库 |
|------|------|------|
| `portable/agent/modes.json` | `default` + 自定义模式定义（配置） | 是（`.gitignore` 用 `!portable/agent/modes.json` 放行） |
| `portable/agent/modes-state.json` | `current`（当前模式，运行时状态） | 否（被 `portable/agent/*` 忽略） |
| `portable/agent/modes/<name>.md` | 人设文件（`appendPrompt`，经 `pi --append-system-prompt` 注入） | 是 |

**为什么要分开**（这不是洁癖，是一次实测故障的根因）：`current` 曾经写在入库的 `modes.json` 里。
后果是——一次 `/mode roleplay` 只是把入库文件改脏，随后任何 git 操作（`checkout` / `stash` /
`restore` / `pull`，包括另一台设备拉下来的版本）都会把它**静默退回 `full`**，用户看到的现象就是
"切了模式、重启后没生效"。分开后：切模式不再让工作区变脏，git 操作也不可能再回退它。

迁移兼容：`modes.json` 里若仍有遗留的 `current` 字段，仍会被识别（`normalizeModesFile` 处理），
但新写入一律落到 `modes-state.json`。

环境变量：`PI_AGENT_MODE`（外部覆盖当前模式）、`PI_AGENT_MODE_SOURCE`（`env`/`file`，由
`bootstrap.ts` 记录来源）、`PI_MEMORY_NAMESPACE`（记忆命名空间，由启动器注入）。

## 生效链路

1. `bootstrap.ts` 读 `resolveEffectiveMode()`，按 `isFeatureEnabled` 过滤 `FEATURES` 后注册
   （`mode` 恒注册，否则极简模式无法切回），并把模式来源写进 `PI_AGENT_MODE_SOURCE`。
2. `scripts/lib-mode.sh`（被 `pi-supervisor.sh` 与 `dev.sh` **共用**）解析同一组文件：
   设 `PI_MEMORY_NAMESPACE`、产出 `--append-system-prompt <agentDir>/<appendPrompt>`。
3. `memory` 功能 `store/io.ts` 的 `dataDir()` 追加命名空间 → 隔离长期记忆。
4. supervisor 每轮启动前重解析（`apply_mode`），因此 `/mode` 后的自动重启一定带上新模式的参数。

## 切换语义：`/mode <name>`

- **只改思考档位**（功能集/人设/命名空间都没变）→ 立即生效，**不重启**。
- **功能集或人设/命名空间变化** → 先确认会话空闲（`ctx.isIdle()`），再写 `modes-state.json`，
  然后走**既有**的 admin restart 通道（`writeRestartRequest('restart', { targetSession })` +
  `ctx.shutdown()`），由 `scripts/pi-supervisor.sh` 用 `--session` 精确续接当前会话。回来后
  supervisor 已重新注入人设与命名空间，bootstrap 也按新模式过滤了功能。
- **响应进行中**（`isIdle()` 为 false）→ 拒绝切换并提示等本轮结束后重跑。**什么都不落盘**：
  否则会出现"配置已改、进程没重启"的半切换状态，比不切更难排查（pi 自己的 `/reload` 也有
  同样的保护）。
- 切换提示里会列出"哪些配置需要重启"，并明确说明正在自动重启。

## 启动一致性校验（防"静默不生效"）

`session_start` 时比对两个值：磁盘上持久化的模式（`getCurrentMode()`）与本进程实际注册的模式
（`register()` 时解析的 `activeMode`）。不一致就发 `warning` 并给出修复命令。它覆盖的正是
"切了模式、重启后没生效"这一类**静默**状态：配置被 git 操作回退、多设备覆盖、手工改了配置却没重启。
`PI_AGENT_MODE_SOURCE=env` 时跳过（外部强制覆盖，不是异常）。

## 为什么不做热重载（结论与依据）

pi 的 `/reload` 会重跑扩展工厂：`session.reload()` → `resourceLoader.reload()` →
`clearExtensionCache()`（`core/extensions/loader.ts:131-141`）→ `bootstrap.ts` 重新执行，
所以**功能白名单这一层是可热切的**（前提是 `resolveEffectiveMode` 能区分"外部注入"与
"bootstrap 回写"的 `PI_AGENT_MODE`，这正是 `PI_AGENT_MODE_SOURCE` 的作用；否则 reload 时读到旧值，
永远切不动）。

但仍然选择重启，理由：

1. **人设是 CLI 启动参数**（`--append-system-prompt`），运行时改不了；扩展 API 只有只读的
   `getSystemPrompt()` / `getSystemPromptOptions()`。要热切必须改用 `context_with_system` 事件
   （每次请求前接管含 system 的完整消息数组）自行拼装 system prompt，属于额外改造。
2. **记忆命名空间不该热切**：同一会话前半段写 `full`、后半段写 `roleplay`，而历史里已注入的
   记忆块仍属旧命名空间，破坏记忆治理（VISION §5）与执行-知识分离（§3.4）的一致性。
3. **热重载在缓存上没有收益**：模式切换必然改变工具数组，无论重启还是 reload，下一轮请求的整段
   前缀都要按全价重算（见 `portable/agent/AGENTS.md` 的"前缀缓存是第一成本杠杆"）。reload 省的
   只是"进程/pty/scrollback 重建"那点体验成本，却要额外处理"半切换"状态与
   `session_start(reason: reload)` 下各钩子的幂等性。

因此：**重启是模式的正确语义**（模式 = 启动档位，一次重启让功能/人设/命名空间同时且一致地生效）。
`PI_AGENT_MODE_SOURCE` 已为将来真要做的热重载留好路口。

## 相关

- 启动装配：[../../../scripts/lib-mode.sh](../../../scripts/lib-mode.sh)、[../../../scripts/pi-supervisor.sh](../../../scripts/pi-supervisor.sh)、[../../bootstrap.ts](../../bootstrap.ts)
- 记忆隔离：[../memory/README.md](../memory/README.md)
