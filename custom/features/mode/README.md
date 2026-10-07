# mode — 模式（启动档位，**会话作用域**）

模式决定**注册哪些自定义功能**、思考档位、人设追加与长期记忆命名空间。因 pi 在启动时注册工具、
运行中无法卸载，功能/人设/命名空间的变更**需要重启**——`/mode <name>` 会自动提交重启请求并
续接当前会话（不是让你手动重启）；思考档位可即时切换。

**模式是会话的属性，不是本机的全局选择**（2026-10-06 起）：

| 场景 | 生效模式 |
|------|----------|
| 新会话（直接启动 / `/new`） | `modes.json` 的 `default` |
| 续接已有会话（`--session` / `-c` / `-r` / 进程内切换） | 该会话上次记录的模式；没有记录就是 `default` |
| `/mode <name>` | 只写**当前会话**的记录并重启续接，不影响其它会话 |

## 模式

| 名称 | 来源 | 功能 | 说明 |
|------|------|------|------|
| `full` | 代码锁定 | 全部 12 个 | 开发项目 |
| `minimal` | 代码锁定 | 无（仅内置工具 + `/mode`） | 测试/修复 |
| `roleplay` | `modes.json` | `web-search`、`memory`（隔离命名空间 `roleplay`） | 日常交流角色扮演 |
| `lean` | `modes.json` | `web-search`、`context`、`memory`、`plan-mode`、`intervention`、`subagent`、`tmux` | 成本敏感会话：去掉 `browser`/`voice`/`link`/`autopilot` 四组工具 |

`lean` 的依据（2026-10-01 实测，守门 `context/__tests__/tools-payload.test.ts`）：本仓库 12 个功能注册
**62 个工具、合计 28.5 KB**（请求里 `toolsBytes` 62.4 KB，其余约 33 KB 是 pi 内置工具）——
其中 `autopilot` 6.4 KB、`browser` 6.3 KB、`voice` 1.0 KB、`link` 0.8 KB。**端到端实测**（真实无头请求）：`toolsBytes` 63 268 → **38 430 B（−39%）**。模式白名单在**启动期**过滤功能，
未注册即 0 字节，且整个会话内工具数组不变（缓存安全；见 `DECISIONS.md` 的"不做热重载"与
"不要会话中途改工具集"）。

`full`/`minimal` 由 `FIXED_MODES`（`logic.ts`）定义，`modes.json` 无法覆盖；文件只存自定义模式。

## 注册面

- 命令：`/mode <list|help|模式名>`
- 钩子：`session_start`（按**本会话**应有的模式做一致性校验，不一致就自愈重启；非 full 时提示当前模式；
  若本次启动正是为模式切换而重启的，则按新模式注入一条模型侧通知——见下文"切换后的注入通知"）

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册命令/钩子；切换、自动重启请求、按会话的一致性校验与自愈、消费并注入切换通知 |
| `logic.ts` | 模式定义/读写/归一化、`resolveEffectiveMode`/`resolveStartupMode`、会话记录表、`isFeatureEnabled`、`applyModeRuntime`、`formatModeSwitchNotice` |

## 数据：配置、会话记录、进程来源**三者分开**

| 路径 | 内容 | 入库 |
|------|------|------|
| `portable/agent/modes.json` | `default` + 自定义模式定义（配置） | 是（`.gitignore` 用 `!portable/agent/modes.json` 放行） |
| `portable/agent/modes-sessions.json` | `{ "<会话文件绝对路径>": { mode, updatedAt } }`（会话的运行时选择） | 否（被 `portable/agent/*` 忽略） |
| `portable/agent/mode-restart-guard.json` | 自愈重启的防环标记：`{ "<会话>::<模式>": ts }`（多键；同一键在窗口内只自动重启一次） | 否 |
| `portable/agent/modes/<name>.md` | 人设文件（`appendPrompt`，经 `pi --append-system-prompt` 注入） | 是 |
| `portable/agent/modes/assets/<name>/` | 人设配套的图片资产（目前只有 roleplay：6 张形象参考图 + `README.md` 清单，人设里按需 `read`） | 是（`!portable/agent/modes/**` 放行；引用/孤儿/体积由 `check-conventions.sh` E 节守门） |
| 环境变量 | `PI_AGENT_MODE`+`PI_AGENT_MODE_SOURCE`（外部硬覆盖）、`PI_SESSION_MODE`（启动器按会话解析的**软**来源）、`PI_MEMORY_NAMESPACE`（记忆命名空间，由启动器注入） | — |

**为什么配置与会话记录要分开**（这不是洁癖，是一次实测故障的根因）：`current` 曾经写在入库的 `modes.json` 里。
后果是——一次 `/mode roleplay` 只是把入库文件改脏，随后任何 git 操作（`checkout` / `stash` /
`restore` / `pull`，包括另一台设备拉下来的版本）都会把它**静默退回 `full`**，用户看到的现象就是
"切了模式、重启后没生效"。

**并发写者**：`modes-sessions.json` 与 `mode-restart-guard.json` 都是"读 → 改 → 写"，而多实例并存是
实测过的（同一天出现过两个 supervisor 同时跑）。两份文件共用一把跨进程文件锁
（`portable/agent/.mode-store.lock`，`core/file-lock.ts`），防环标记也从**单槽** `{key, ts}` 改成
**多键** `{ "<会话>::<模式>": ts }`——单槽时代 B 会话一写就把 A 的标记顶掉，两边的自愈会互相放行、
来回重启（旧格式读进来仍生效，下次写入即迁移）。

**为什么用旁路表而不是 `appendEntry`**（pi 官方的"扩展按会话持久化状态"通道，`plan-mode` 在用）：
pi 的新会话文件**在首条 user/assistant 消息之前不落盘**（`SessionManager._persist` 的
`_hasConversation` 门控），而"刚开一个空会话就 `/mode` 然后自动重启"正是要覆盖的场景——
那种情况下条目只在内存里，重启即丢。旁路表与会话文件解耦，空会话也可靠。

**为什么键是会话文件路径而不是 sessionId**：空会话重启时 pi 会以 `--session <不存在的路径>`
在同路径创建一个**新 id** 的会话（实测），只有路径稳定。代价是会话被移动/改名后记录不再匹配 →
回落 default（可接受：那本来就是一个"新会话"）。

迁移：`modes-state.json`（上一版的全局 `current`）**不再是模式来源**，文件可以留着不管
（gitignored）。新会话一律取 `modes.json` 的 `default`；想让新会话默认用别的档，改
`modes.json` 的 `default` 即可。

## 生效链路

1. `scripts/lib-mode.sh` 的 `mode_resolve <agentDir> [会话文件]`：外部 `PI_AGENT_MODE` 优先 →
   会话记录 → `modes.json` 的 `default`；产出 `MODE_NAME`/`MODE_NS`/`MODE_APPEND_ABS`，
   supervisor / `dev.sh` 据此设置 `PI_MEMORY_NAMESPACE`、`--append-system-prompt`，
   并导出 `PI_SESSION_MODE`。会话文件来自 `mode_session_arg`（只认 `--session <绝对路径>`）。
2. `bootstrap.ts` 调 `resolveStartupMode()`：`PI_AGENT_MODE`（硬覆盖）> `PI_SESSION_MODE`（软来源）
   > `default`，按 `isFeatureEnabled` 过滤 `FEATURES` 后注册（`mode` 恒注册，否则极简模式无法切回），
   并把解析结果与来源（`env`/`file`）写回进程环境。
3. `memory` 功能 `store/io.ts` 的 `dataDir()` 追加命名空间 → 隔离长期记忆。
4. supervisor 每轮启动前重解析（`apply_mode "$@" "${EXTRA_ARGS[@]}"`），因此 `/mode` 后的自动重启
   一定带上新模式的参数。

**bash 为什么只认精确路径**：`--session` 还接受会话 id / 部分 uuid / `-c` / `-r`（选择器），
那套查找是 pi 的语义；在 bash 里复制一份必然与上游漂移。所以 bash 解析不出来就回落 `default`，
由 pi 侧 `session_start` 检测到"本会话应有的模式 ≠ 本进程模式"后自动重启一次（带 `--session`
精确路径）收敛。headless（`-p`/RPC）不重启，只打 `console.warn`，避免打断非交互运行。

## 切换语义：`/mode <name>`

- **只改思考档位**（功能集/人设/命名空间都没变）→ 立即生效，**不重启**（记录照样写入）。
- **功能集或人设/命名空间变化** → 先确认会话空闲（`ctx.isIdle()`），再写**本会话**的记录，
  然后走**既有**的 admin restart 通道（`writeRestartRequest('restart', { targetSession, notice:'mode',
  mode, from })` + `ctx.shutdown()`），由 `scripts/pi-supervisor.sh` 用 `--session` 精确续接当前会话。
  回来后 supervisor 已按该会话重新注入人设与命名空间，bootstrap 也按新模式过滤了功能。
- **响应进行中**（`isIdle()` 为 false）→ 拒绝切换并提示等本轮结束后重跑。**什么都不落盘**：
  否则会出现"配置已改、进程没重启"的半切换状态，比不切更难排查（pi 自己的 `/reload` 也有
  同样的保护）。
- **重启请求写盘失败** → **不退出进程**，改为红色告警并让用户手动重启。否则用户看到的是
  "进程没了、模式也没换、还没有重启"——与"通知消费吞掉 action"那次故障同一种症状（静默退出）。
- **会话不落盘**（`--no-session` / 内存会话）→ 没有按会话记录的落点，只切换思考档位并说明限制，
  不写任何状态、不重启。
- 切换提示里会列出"哪些配置需要重启"，并明确说明正在自动重启。

## 切换后的注入通知（模型侧）

进程重启后**历史还在，但模型不知道自己在哪个档位**。所以切换通知必须注入，而且必须满足三条：

1. **由新模式进程注入**。写入端（旧进程）只写请求，不写通知：旧进程仍是旧功能集/旧人设，
   在那里注入等于"用旧档位的嘴说新档位的话"，角色扮演下还会在错误的人设里落一条记录。
   注入走 `deliverAs: 'nextTurn'` 的 **零成本通道**：不触发回合、不写会话文件，等下一次
   真正要跑时与用户消息一起作为上下文出现（旧行为是 `sendUserMessage` → 每次切模式都白跑
   一个模型回合；判据见 `custom/core/restart-intent.ts`，切模式恒为 `intent: 'none'`）。
2. **内容是模式信息，不是进程内部状态**。`formatModeSwitchNotice` 输出
   `[模式] 已切换：full → roleplay` + 定位 + 启用功能 + 思考档位/人设/记忆命名空间，
   并显式要求"不要向用户复述本条提示，也不要提及模式切换或进程重启"（人设模式不破戏）。
   内部措辞（"按会话模式自愈：进程原为 full"）与会话文件路径只进 `state.json` 供排查，
   **不进模型上下文**。
3. **没注册 autopilot 的模式里由 mode 兜底消费"通用"重启日志**（roleplay/lean/minimal）：
   通用重启通知/续跑原本挂在 autopilot 的 `session_start` 上，而这些模式不注册 autopilot →
   崩溃恢复写的日志**没人消费**：既没有通知、也不会续跑，而且完全静默（2026-10-06 场景实测）。
   mode 是唯一恒注册的功能，所以在"本模式未启用 autopilot"时由它代劳（文案与通道选择仍在
   `custom/core/restart-intent.ts`，两处共用同一份判据）。
4. **一次切换只注入一次**：通知借 `restartLog` 传递、消费即清（只清 `restartLog`），
   并带 10 分钟 TTL——那次重启没落成（请求被吞、用户手工换会话、崩溃恢复续了别的会话）时
   直接丢弃，不让模型看到一条"已切换"的过期断言。

归属用 `restartLog.notice = 'mode'` 标记：autopilot 见到它就**不注入也不消费**自己的通用
「系统已重启」通知（`isModeOwnedNotice`），把这条日志原样留给 mode 的 `session_start`。

**归属判据**（两个消费端共用 `custom/core/restart-intent.ts`）：
1. `logWrittenAfterStart()` —— 只消费**写在本进程启动之前**的日志。日志的合法消费者必然启动得比它晚
   （旧进程写、supervisor 重拉、新进程消费）；写在启动之后的日志属于**下一个**进程。少了这条时，
   外部写入端（看门狗/故障转移/另一实例/测试）在进程启动过程中写下的请求会被"即将被重启的那个进程"
   吃掉并注入到它自己（马上要死的）会话里 → 新进程无续跑可注入；同源形态还会抹掉刚写下的 `action`
   （消费端是整文件读-改-写）→ supervisor 读空 action 直接退出（2026-10-07 实修，见 `DECISIONS.md`）。
2. `logTargetsOtherSession()` —— `targetSession` 对不上的通知不消费（别的会话/实例的重启，留给它自己的
   进程）；这条此前只写在 mode 侧，现已补到两个消费端。

> 这条链路有过两个真实故障：2026-10-06「旧进程写请求后，autopilot 的通知消费顺手把 `action` 清成
> `none`，supervisor 不重启而是直接退出」；2026-10-07「启动过程中写入的日志被即将重启的进程消费，
> 重拉起来的新进程续跑静默丢失」。根因与修法都记在 [`DECISIONS.md`](../../../DECISIONS.md)。

## 启动一致性校验与自愈（防"静默不生效"）

`session_start` 时比对两个值：**本会话应有的模式**（会话记录，没有记录就是 `default`）与本进程
实际注册的模式（`register()` 时解析的 `activeMode`）。不一致就自动重启一次并按会话精确续接；
**同一（会话, 模式）在 120s 内只尝试一次**（`mode-restart-guard.json`），第二次仍不一致则改为
告警并给出 `/mode <name>` 修复命令——防"解决不了就无限重启"。

它覆盖的正是这几类**静默**状态：配置被 git 操作回退、多设备覆盖、手工改了配置却没重启，
以及 bash 解析不出会话的启动形态（`-c` / `-r` / 部分 uuid）。`PI_AGENT_MODE_SOURCE=env`
（外部硬覆盖）时跳过——那是用户/测试的显式强制，不是异常；`PI_SESSION_MODE`（软来源）**不跳过**，
因为 bash 也可能解析错。

## 为什么不做热重载（结论与依据）

pi 的 `/reload` 会重跑扩展工厂：`session.reload()` → `resourceLoader.reload()` →
`clearExtensionCache()`（`core/extensions/loader.ts`）→ `bootstrap.ts` 重新执行，
所以**功能白名单这一层是可热切的**（前提是 `resolveEffectiveMode` 能区分"外部注入"与
"bootstrap 回写"的 `PI_AGENT_MODE`，这正是 `PI_AGENT_MODE_SOURCE` 的作用；否则 reload 时读到旧值，
永远切不动）。会话替换（`/new`、`/resume`、fork）同样会重跑工厂——这一点已实测确认。

但仍然选择重启，理由：

1. **人设是 CLI 启动参数**（`--append-system-prompt`），运行时改不了；扩展 API 只有只读的
   `getSystemPrompt()` / `getSystemPromptOptions()`。要热切必须改用 `context_with_system` /
   `before_agent_start` 事件自行接管 system prompt，属于额外改造（且 roleplay 这类模式不注册
   `context` 功能，人设得挂在恒注册的 `mode` 上）。
2. **记忆命名空间不该在会话中途变**：同一会话前半段写 `full`、后半段写 `roleplay`，而历史里已注入的
   记忆块仍属旧命名空间，破坏记忆治理（VISION §5）与执行-知识分离（§3.4）的一致性。
   （注：会话作用域化之后，命名空间在一次会话内是**稳定**的，除非用户主动 `/mode` 切换——那时
   无论重启还是 reload 都会换命名空间，重启在这一点上不比 reload 差。）
3. **热重载在缓存上没有收益**：模式切换必然改变工具数组，无论重启还是 reload，下一轮请求的整段
   前缀都要按全价重算（见 `portable/agent/AGENTS.md` 的"前缀缓存是第一成本杠杆"）。reload 省的
   只是"进程/pty/scrollback 重建"那点体验成本，却要额外处理"半切换"状态与
   `session_start(reason: reload)` 下各钩子的幂等性。

因此：**重启是模式的正确语义**（模式 = 启动档位，一次重启让功能/人设/命名空间同时且一致地生效）。
`PI_AGENT_MODE_SOURCE` / `PI_SESSION_MODE` 已为将来真要做的热重载留好路口。

### 要做到"免重启"（方案 P）：已评估，**暂不实施**（2026-10-06）

P = 打补丁让扩展在**工厂期**就知道本次加载哪个会话，于是功能集天然按会话，`/new`、`/resume`、
`/reload` 都不再需要重启。但**人设是 CLI 参数、命名空间是 bash 注入的 env**，所以：

- **只打补丁（P₀）不能做**：会造成"功能已是 roleplay、人设还是 full"这类新半切换，比现在更糟；
- **P₀+**（补丁 + "人设/命名空间会过期才重启"）：能让 full/lean/minimal 之间与 `-c`/`-r` 免重启，
  是将来若要动手的第一步；
- **P+**（补丁 + 人设与命名空间 TS 化 + `/mode` 走 `ctx.reload()`）：收益完整。

**对价（本机实测）**：一次进程重启 ≈40s，同进程热重载 ≈1s；前缀重放两档都省不掉。
**代价与触发条件**（补丁栈、env 静默失真面、13 KB 人设搬进 `before_agent_start` 的 last-wins +
整段替换语义、预算要新开档位、丢掉"扩展挂了人设仍在"、命名空间需在工厂期设置、bash 侧解析作废、
热切换的工具集中途变化与新通知、验证基建）逐条记在 [`DECISIONS.md` 的同名条目](../../../DECISIONS.md)。

**将来动手的入口**：`resolveEffectiveMode()` 只插入"会话记录"这一层（`getSessionMode`/`setSessionMode`
已就绪）；人设注入改走 `before_agent_start`（务必读 `event.systemPrompt` 再追加）；命名空间改由
bootstrap 在工厂期设置。迁移零成本——`modes-sessions.json` 的键与语义不变。

## 相关

- 启动装配：[../../../scripts/lib-mode.sh](../../../scripts/lib-mode.sh)、[../../../scripts/pi-supervisor.sh](../../../scripts/pi-supervisor.sh)、[../../bootstrap.ts](../../bootstrap.ts)
- 记忆隔离：[../memory/README.md](../memory/README.md)
