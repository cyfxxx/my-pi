# DSH 换基座：钩子映射清单（my-pi `registerHook` → DSH 事件）

> 目的：把「**64 处钩子要人工映射**」这个最大不确定项，变成**可换算的输入**。
> 本文件**只做静态分析**（未运行任何东西），每条结论都带 `文件:行号`。
> 结论口径分三档：**①可映射**（有直接对应事件、能力等价，改动基本是换事件名 + 换接入方式）、
> **②需改语义**（有对应事件但阶段/粒度/能力不同，需改写处理器逻辑）、**③无对应**（在 DSH 的全部事件里找不到等价物）。

---

## 0. 一句话结论

- my-pi 实际有 **53 个** `registerHook` 特性调用点（另 2 处在适配器里），去重后 **18 个 distinct 事件**。
- DSH 侧有 **两套不同的事件面**：**105 个 cordis 事件**（`ctx.on('name', …)` 直接订阅）+ **59 个 `SessionEventMap` 会话日志事件类型**（只能经 `session/event` 观察、按 `event.type` 派发）。
- 映射结果：**①11 个 / ②7 个 / ③0 个**。
  ⇒ **没有任何一个 my-pi 事件在 DSH 里完全找不到影子**；风险不在「找不到」，而在**接入方式与粒度差异**（尤其会话生命周期与「输入/压缩前」这类干预点）。

---

## 1. 第一步：my-pi 的钩子归类（实测，非估算）

grep 命令（可复跑）：

    grep -rn "registerHook(" custom/ --include=*.ts | grep -v __tests__ | wc -l

结果：**55 个调用点**，其中 **53 个**在特性里、**2 个**在适配器 `custom/adapters/hook-adapter.ts:33` 与 `:50`（它是 `registerHook` 的实现本身，不是调用方）。
去重后 **18 个 distinct 事件**。完整调用点清单见 `/tmp/mypi-hooks.json`（本次分析产物）。

顺带实测的其它注册面计数（非测试）：

| 原语 | 计数 | 命令 |
|---|---|---|
| `registerHook` | **55**（53 特性 + 2 适配器） | `grep -rn "registerHook(" custom/ --include=*.ts \| grep -v __tests__` |
| `registerTool` | **61** | 同上，替换函数名 |
| `registerCommand` | **14** | 同上 |
| `registerShortcut` | **4** | 同上 |

> **修正一处旧数字**：`docs/design/BASE-SWITCH-DSH.md` 记的是 57/64/20/4。按「带左括号的调用点」口径实测是 **61/55/14/4**。
> 差异来源：不带括号的 `registerHook` 文本出现 **67 次**（含 `import`、类型引用、注释、适配器内部），旧的 64 很可能是某个中间口径。
> 本文件一律用「**带括号的调用点**」口径。

### 1.1 18 个 distinct 事件（按调用点数量降序）

| # | 事件名 | 调用点 | 使用它的特性 | 首个调用点 |
|---|---|---|---|---|
| 1 | `session_start` | 9 | autopilot, browser, context, memory, mode, plan-mode, subagent, voice | `custom/features/autopilot/index.ts:875` |
| 2 | `session_shutdown` | 6 | autopilot, browser, plan-mode, subagent, tmux, voice | `custom/features/autopilot/index.ts:1155` |
| 3 | `before_agent_start` | 6 | context, intervention, memory, mode | `custom/features/context/index.ts:441` |
| 4 | `turn_start` | 4 | autopilot, context, link, tmux | `custom/features/autopilot/index.ts:1064` |
| 5 | `agent_settled` | 4 | autopilot, context, link, tmux | `custom/features/autopilot/index.ts:1107` |
| 6 | `input` | 4 | autopilot, context, intervention, link | `custom/features/autopilot/index.ts:1148` |
| 7 | `tool_call` | 3 | autopilot, context, plan-mode | `custom/features/autopilot/index.ts:1075` |
| 8 | `tool_result` | 3 | autopilot, context, tmux | `custom/features/autopilot/index.ts:1083` |
| 9 | `turn_end` | 3 | autopilot, context | `custom/features/autopilot/index.ts:1100` |
| 10 | `session_compact` | 2 | context, memory | `custom/features/context/index.ts:1055` |
| 11 | `agent_end` | 2 | intervention, link | `custom/features/intervention/index.ts:99` |
| 12 | `thinking_level_select` | 1 | context | `custom/features/context/index.ts:354` |
| 13 | `context` | 1 | context | `custom/features/context/index.ts:638` |
| 14 | `session_before_compact` | 1 | context | `custom/features/context/index.ts:870` |
| 15 | `before_provider_request` | 1 | context | `custom/features/context/index.ts:931` |
| 16 | `message_update` | 1 | context | `custom/features/context/index.ts:959` |
| 17 | `tool_execution_start` | 1 | intervention | `custom/features/intervention/index.ts:61` |
| 18 | `message_end` | 1 | voice | `custom/features/voice/index.ts:376` |

pi 侧的可用面：`vendor/pi/packages/coding-agent/src/core/extensions/types.ts:1366` 的 `ExtensionEvent` 联合共 **36** 项
（`ProjectTrustEvent` … `InputEvent` 等）。即 my-pi 用了其中 **18** 类。

---

## 2. 第二步：DSH 实际声明的事件（附行号）

DSH 装在 `/root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/`（**不在 my-pi 的 `node_modules`**）。

### 2.1 第一套：cordis 事件（可直接 `ctx.on(名字, …)`）—— **105 个**

声明形态是**带引号的方法签名**（不是属性类型），例如：

    declare module '@deepseek-ai/cordis' {
        interface Events {
            /** … @mode waterfall */
            'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>;
        }
    }

出处：`@deepseek-ai/dsh-tools/lib/types/index.d.ts:47`（`tools/pre-execute`）。
提取口径：扫全部 `.ts` 与 `.d.ts` 里 `interface *Events*` 块内的**引号键**（方法或属性），得 **105** 个 distinct 名字，
覆盖 **41 个命名空间**（`agent` 12、`internal` 9、`cordis` 6、`tools` 6、`workflow` 6、`api-session` 5、`loader` 5、`session` 4、`slash` 4、`subagent` 4 …）。
本文件相关子集（**均有 @mode 注解**，该注解决定能否拦截）：

| 事件 | @mode | 出处 | 语义要点（原文摘） |
|---|---|---|---|
| `tools/pre-execute` | waterfall | `dsh-tools/lib/types/index.d.ts:47` | 分发前 allow/deny/cancel/ask；`next()` 即放行 |
| `tools/execute` | waterfall | 同上 `:58` | 分发期环绕瀑布（超时/重试/指标），只能改 `exec.signal` |
| `tools/post-execute` | waterfall | 同上 `:70` | 对归一化结果 accept/replace/enrich/block |
| `tools/result` | emit | 同上 `:92` | 观察已冻结的最终结果 |
| `agent/created` | serial | `dsh-agent/lib/types/runtime-types.d.ts:227` | agent 进入后、创建落定前的逐个初始化；**抛错会让创建失败** |
| `agent/disposed` | emit | 同上 `:240` | agent 离开注册表（驱动静默、作用域注销之后） |
| `agent/status` | emit | 同上 `:252` | 状态在 `idle` ⇄ `running`；`idle` 指没有驱动在排队或在跑 |
| `agent/pre-step` | waterfall | 同上 `:304` | **可否决该 step、或替换进入它的 messages** |
| `agent/request` | waterfall | 同上 `:327` | 替换冻结的调用配置（可在系统提示词前改） |
| `agent/request-error` | waterfall | 同上 `:348` | 一次模型请求失败后决定 retry 或终止 |
| `agent/assistant-stream` | emit | 同上 `:366` | 助手流式分片（有序帧） |
| `agent/turn-stopping` | serial | 同上 `:387` | 回合即将关闭；**监听者可 steer 让机器再读 inbox 继续跑** |
| `agent/inbox/inserted` | emit | 同上 `:263` | 一条消息进入活动 inbox |
| `session/created` | emit | `dsh-session/lib/types/index.d.ts:42` | 会话发布时的创建公告（同步抛错可否决并回滚） |
| `session/disposed` | emit | 同上 `:52` | 会话离开存储（含回滚），仅对已公告者发 |
| `session/event` | emit | 同上 `:64` | **提交后的追加流**（fire-and-forget 观察） |
| `session/flush` | parallel | 同上 `:73` | 并行持久化检查点（无否决） |
| `system-prompt/assemble` | waterfall | `dsh-system-prompt/lib/types/index.d.ts:27` | 对装配后的 sections/contexts/tools/variables 做瀑布，**返回值即权威** |
| `compaction/summary-error` | waterfall | `dsh-compaction/lib/types/index.d.ts:85` | 摘要请求失败后的恢复点（返回 true 表示已推进） |
| `llm/stream` | waterfall | `dsh-llm/lib/types/index.d.ts:45` | 每次流式模型调用外的瀑布（可短路并自己产 chunk） |
| `subagent/start` / `subagent/end` | emit | `dsh-subagent/lib/types/index.d.ts:89` / `:98` | 已发布子代理的建立/落定（成对） |
| `workspace/session-stop` | parallel | `dsh-workspace/lib/types/index.d.ts:110` | 因归档而停止某会话的运行中工作 |

### 2.2 第二套：`SessionEventMap` 会话日志事件类型 —— **59 个**

出处：`@deepseek-ai/dsh-agent/lib/types/types.d.ts:86`（`interface SessionEventMap`）。
**注意：这不是可 `ctx.on` 的钩子**，而是**写进会话日志的事件类型**；要观察得订阅 `session/event` 再按 `event.type` 派发（提交后、不可拦截）。
与 my-pi 相关的一批：`turn/start`、`turn/end`、`step/start`、`step/end`、`tool/call`、`tool/result`、`assistant/message`、`assistant/attempt`、
`user/message`、`system/message`、`developer/message`、`model/selection`、`plan/mode`、`sandbox/mode`、`permission/preset`、
`compaction/start`、`compaction/summary`、`compaction/end`、`compaction/prune`、`hook/invoked`、`hook/result`、`subagent/*`、`request/header`、`request/context`。

> 佐证：`dsh-compaction/lib/types/invariant.js:77` 等处按 `event.type === 'compaction/start'` 分支，说明这些名字是**日志事件类型**。

### 2.3 顺带澄清一个容易走错的包

`@deepseek-ai/dsh-hook-protocol` **不是**"插件钩子 API"，而是**外部命令钩子桥**：
`HookDialect = 'claude-code' | 'codex'`（`dsh-hook-protocol/lib/types/types.d.ts:46`）、
钩子配置形如 `{ type: 'command', command, timeout? }`（同文件 `:48`）、
事件名走外部方言（`runner.d.ts:37` 举例 `'PreToolUse'`）。
它自己的注释写明：`types.d.ts:43` —— "A native plugin at the interception points is not a bridge"。
⇒ **原生插件（my-pi 的移植形态）该用的是 2.1 的 cordis 事件**；`dsh-hooks-claude-code` / `dsh-hooks-codex` 是它的两个方言实现。

---

## 3. 第三步：逐类映射（18 个 my-pi 事件）

| # | my-pi 事件 | 档 | DSH 对应 | 一行理由 |
|---|---|---|---|---|
| 1 | `session_start` | **②** | `agent/created`（serial, `dsh-agent:227`）；旁证 `session/created`（emit, `dsh-session:42`） | 粒度从「会话」变成「agent」，且 resume 语义要重查；`agent/created` 还能否决创建，需确认原处理器不做假设 |
| 2 | `session_shutdown` | **②** | `agent/disposed`（emit, `:240`）、`session/disposed`（emit, `:52`）、`workspace/session-stop`（parallel, `dsh-workspace:110`） | pi 是"会话被替换时"的一次性清理通知；DSH 拆成 agent 级/存储级/归档级三种时机，顺序与"能否 veto"都不同 |
| 3 | `before_agent_start` | **②** | `agent/pre-step`（waterfall, `:304`）、`system-prompt/assemble`（waterfall, `dsh-system-prompt:27`） | pi 是"agent 启动前一次"；DSH 对应点是**每步**（`pre-step`）或**提示词装配**，需改成幂等/每步语义 |
| 4 | `turn_start` | **①** | `turn/start`（SessionEventMap, `dsh-agent/types.d.ts:86`） | 能力都是"观察回合开始"；接入方式要从直接订阅改为订阅 `session/event` 再按 `event.type` 派发 |
| 5 | `turn_end` | **①** | `turn/end`（同上）；更强的是 `agent/turn-stopping`（serial, `:387`） | 观察点存在；若需要"能否让回合继续"，DSH 的 `turn-stopping` 比 pi 更强（可 steer 继续），按需选一个 |
| 6 | `agent_settled` | **①** | `agent/status`（emit, `:252`，进入 `idle`） | DSH 把「settled」表达为状态翻到 `idle`（无驱动在排队/在跑），语义等价、形态不同 |
| 7 | `agent_end` | **②** | `agent/turn-stopping`（serial, `:387`）、`agent/status`（emit, `:252`） | pi 的 `agent_end` 是"整段 agent 结束"；DSH 这一层是**回合级**，需要把处理器从"结束一次"改成"每回合判条件" |
| 8 | `input` | **②** | `agent/pre-step`（waterfall, `:304`，可替换进入 step 的 messages）、`agent/inbox/inserted`（emit, `:263`） | pi 的 `input` 能改写用户输入；DSH 的对应干预点在"步"这一层（inbox 只是观察），改写对象从"输入"变成"进入 step 的消息数组" |
| 9 | `tool_call` | **①** | `tools/pre-execute`（waterfall, `dsh-tools:47`） | 两者都是分发前的闸门，能力等价乃至更强（DSH 多了 cancel/ask）；改动基本是换事件名 + 换 decision 形状 |
| 10 | `tool_result` | **①** | `tools/post-execute`（waterfall, `:70`）；只观察用 `tools/result`（emit, `:92`） | 两者都能 accept/replace/enrich/block 工具结果；差别只在 decision 形状与错误路径的表达 |
| 11 | `tool_execution_start` | **①** | `tools/execute`（waterfall, `:58`） | 阶段相同（分发前），DSH 版本是环绕瀑布、能力是超集（超时/重试/指标） |
| 12 | `session_compact` | **①** | `compaction/end`（SessionEventMap） | "压缩完成"有直接对应类型；接入同样走 `session/event` |
| 13 | `session_before_compact` | **②** | 只找到 `compaction/summary-error`（waterfall, `dsh-compaction:85`）与 `compaction/start`（日志类型） | "压缩前可改写"这一干预点在已扫到的 DSH 事件里**没有等价瀑布**；`summary-error` 只覆盖失败恢复 |
| 14 | `thinking_level_select` | **②** | `model/selection`（SessionEventMap）；**未找到** thinking-level 专属事件 | 只能拿到"模型选择"，拿不到"思考级别选择"本身；需确认处理器是否真的依赖级别语义 |
| 15 | `context` | **①** | `system-prompt/assemble`（waterfall, `dsh-system-prompt:27`） | 两者都允许**权威地改写**上下文/提示词装配结果，是最干净的一处对应 |
| 16 | `before_provider_request` | **①** | `agent/request`（waterfall, `dsh-agent:327`）；需要包流时用 `llm/stream`（waterfall, `dsh-llm:45`） | 都能在请求发出前替换调用配置；DSH 另有更强的流级瀑布可短路 |
| 17 | `message_update` | **①** | `agent/assistant-stream`（emit, `:366`） | 两者都是助手流式增量；DSH 明确是"有序帧 + 结束帧"的形态 |
| 18 | `message_end` | **①** | `assistant/message`（SessionEventMap）；或 `agent/assistant-stream` 的终结帧 | "一条助手消息定稿"有对应（日志类型），接入走 `session/event` |

### 3.1 三档汇总

| 档 | 数量 | 事件 |
|---|---|---|
| **① 可映射** | **11** | `turn_start`、`turn_end`、`agent_settled`、`tool_call`、`tool_result`、`tool_execution_start`、`session_compact`、`context`、`before_provider_request`、`message_update`、`message_end` |
| **② 需改语义** | **7** | `session_start`、`session_shutdown`、`before_agent_start`、`agent_end`、`input`、`session_before_compact`、`thinking_level_select` |
| **③ 无对应** | **0** | — |

按**调用点数**加权（更能反映改造量）：① 覆盖 3+3+4+3+3+1+2+1+1+1+1 = **23 个调用点**；
② 覆盖 9+6+6+2+4+1+1 = **29 个调用点**；③ 0 个。
⇒ **超过一半的调用点（29/53）落在"需改语义"那一档**，且集中在**会话生命周期**与**输入/压缩干预**这两族。

### 3.2 换基座时风险最高的三类（按理由排序）

1. **会话生命周期三件套**（`session_start` 9 处、`session_shutdown` 6 处、`before_agent_start` 6 处 = **21 个调用点**）：
   粒度从"会话"变"agent/步"，`session_shutdown` 还多了归档停止这条独立路径；本项目在这几处做的是**资源启停与状态落盘**（子代理池、tmux、计划模式、autopilot 调度器、记忆），错配会造成**静默不启动或静默不清理**。
2. **输入与压缩前的干预点**（`input` 4 处、`session_before_compact` 1 处）：
   DSH 侧的对应点是"步"级或只有失败恢复瀑布，**没有等价的"输入改写/压缩前改写"闸门**；这类差异不会报错，只会**行为悄悄变了**。
3. **工具结果与请求的 decision 形状**（`tool_call` 3、`tool_result` 3、`before_provider_request` 1、`tool_execution_start` 1 = 8 处）：
   事件级可对应（①），但 pi 的"改参数/改结果"与 DSH 的 `PreToolDecision` / 归一化结果对象**形状不同**，属于每个处理器都要过一遍的机械改造。

---

## 4. 未核实项（必读，明确列出）

1. **自动化任务（autopilot）的 21 个调用点是本清单里最难的一块**：它注册 `session_start`/`session_shutdown`/`turn_*`/`tool_*`/`input`/`agent_settled` 共 7 类，
   我只核到"事件级有对应"，**没有核对**它每个处理器依赖的 `ctx` 能力在 DSH 里是否存在（例如调度器受 `hasUI` 门控这一条在 DSH 里对应什么）。
2. **`session_before_compact` 的"压缩前干预"是否真的缺失**：我只扫了已声明的事件（105 + 59）。
   **未核实** `dsh-compaction` 是否还有别名的、或非事件形式的介入点。这是本清单里**最可能被推翻的一条**。
3. **`thinking_level_select`**：已确认没有 thinking-level 名字的事件；**未核实** `model/selection` 的负载是否携带思考级别。
4. **`SessionEventMap` 的观察时序**：文档说 `session/event` 是"提交后"的追加流。
   **未核实**：对 `turn/start`、`tool/call` 这类类型的观察是否会**晚于**实际动作到无法做决策的程度。
5. **各 `@mode` 的实际驱动方**：`@mode` 是文档注解，我**没有**逐个回源码确认 dispatcher 真的按该模式调用。
6. **只扫了已安装的 `lib/`**：DSH 是 `0.2.0-rc.2`，事件面可能随版本变化；本清单是**该版本**的快照。
7. **未运行任何东西**：全部结论来自静态读取；没有任何行为验证（无实测）。

---

## 5. 复跑命令（供核对）

    # my-pi 侧
    grep -rn "registerHook(" custom/ --include=*.ts | grep -v __tests__ | wc -l
    # DSH 侧（注意路径不在 my-pi 的 node_modules）
    DSH=/root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai
    grep -rn "interface Events" $DSH/ | wc -l
    grep -rn "'tools/pre-execute'" $DSH/dsh-tools/lib/types/index.d.ts

本次分析产物（临时）：`/tmp/mypi-hooks.json`（53 个调用点）、`/tmp/dsh-events.json`（105 个 cordis 事件）、
`/tmp/dsh-eventmap.json`（59 个会话日志类型）。
