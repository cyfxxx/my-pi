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

> **复核轮已执行（2026-10-11，同日第二次核对，见第 6 节）**：第 4 节原第 2 条「DSH 没有压缩前干预闸门」**已被推翻**。
> DSH 确实具备压缩前介入能力，形态是「**替换 `CompactionEngine` 服务**」＋「`compaction/summary-error` 瀑布（失败路径）」＋「配置化策略」，
> 而不是 pi 那种「每次压缩前的回调闸门」。第 3 节第 13 行与第 3.2 节第 2 类的措辞已就地更正（**原文保留作对照**）。
>
> **复核二（同日第三次核对，见第 7、8 节）**：① 把**服务替换**这一类扩展点**完整清点**了（**132 个服务**：内核 85 / 客户端 47）；
> ② 追了 `CompactionEngine` 的调用者 ⇒ **「每次压缩前必然触发」的服务级点确实存在**（`ctx.toolResultPruner`，两条触发路径都在摘要前调用它）；
> ③ **「换引擎」不是唯一途径**（四条服务级杠杆，其中 `summarize()` 被契约称为**唯一**子类定制钩子）；
> ④ 并**部分回答**第 4 节第 1 条：`dsh-jobs` 的文档把「**子类化 + 作为插件加载**」写成了**成文的官方扩展方式**。

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

pi 侧 `session_before_compact` 的语义（本轮复核读到的原文，供第 6 节对照）：
`vendor/pi/packages/coding-agent/src/core/extensions/types.ts:763` 注释 —— **"Fired before context compaction (can be cancelled or customized)"**；
`:764-774` 载荷含 `preparation`、`branchEntries`、`customInstructions?`、`reason: manual|threshold|overflow`、`willRetry`、`signal`；
`:798` 另有 **"True when the failing compaction content came from a session_before_compact handler"**（说明处理器**可以产出压缩内容**）；
触发前会先判 `hasHandlers("session_before_compact")`（`core/agent-session.ts:2778` 与 `:3110`）。

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
| `agent/pre-step` | waterfall | 同上 `:304`（判定类型 `:92-99`） | **可否决该 step、或替换进入它的 messages**；判定形状实测读到：`{kind:'reject'}` 或 `{kind:'enter', messages: UserMessage[], startsRequestSeries?: true}` ⇒ 改写是**整组替换**（不是就地改文本），与 pi 的 `input` 语义可按此翻译 |
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
| `compaction/summary-error` | waterfall | `dsh-compaction/lib/types/index.d.ts:85` | 摘要请求失败后的恢复点（返回 true 表示已推进）；**详见第 6 节** |
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

### 2.4 第三类扩展点：**服务替换**（本轮复核新增，见第 6 节）

除"事件"之外，DSH 还有**服务级**扩展点：插件可以**提供一个服务实现的实例**（例如 `ctx.compaction`）。
这类介入点不触发"事件"，因此**第一次只扫事件的清单必然会漏掉它** —— 这正是原第 4 节第 2 条被推翻的原因。

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
| 13 | `session_before_compact` | **②**（**理由已更正**；原判"无等价闸门"**被推翻**） | ★ **2026-10-16 关键区分（观察 vs 干预）**：`compaction/start` 确实是**会话日志事件**（声明于 `dsh-compaction` 的 `SessionEventMap`，`types.d.ts:21`；同族 `:35/73/88`），经 `session/event` 追加派发 ⇒ **观察型用法够用**（我们唯一那处=压缩前落快照+记账：`compaction/start` 到达时 summary 与替换用的 `user/message` 都还没落 ✓，已把映射从`via:'service'` 改为 `via:'session-event'`）；但它是**提交后**的，**不能否决压缩** ⇒ **干预型**用法仍需服务替换/瀑布（见右列分析）✗ | ~~只找到 `compaction/summary-error` 与 `compaction/start`~~；实为 **服务级**：`CompactionEngine`（`dsh-compaction/lib/types/index.d.ts:102`，注册为 `ctx.compaction` @ `:67-70`）＋ **`compaction/summary-error` 瀑布**（`@mode waterfall` @ `:83`，可在失败后**持久改写被选中的输入** @ `:72-77`）＋ 配置化策略（`dsh-compaction-basic/lib/types/config.d.ts:22`、`:29`、`:42`） | 能力**存在**但**形态不同**：pi 是"**每次压缩前**的回调（可取消/可自定义，`vendor/pi/.../types.ts:763`）"；DSH 是"**换一个压缩引擎实现**"（契约原文"Implementations own trigger policy, retention, and summarization" @ `dsh-compaction:94-95`；首方实现 `BasicCompactionEngine extends CompactionEngine` @ `dsh-compaction-basic/lib/types/index.d.ts:24`）＋失败路径瀑布（首方用法 `dsh-compaction-image-offload/lib/index.js:146`）。⇒ 仍需改语义（要换介入形态），但**不是缺口** |
| 14 | `thinking_level_select` | **②** | ~~`model/selection`（SessionEventMap）~~ ★ **2026-10-16 更正**：**应用点**是 `agent/request`（waterfall，替换冻结调用配置；配置里有 `reasoningEffort?: ReasoningEffortId`，`dsh-llm/lib/types/call-config.d.ts:19`，模块注释原话 "request waterfalls replace them"）；**触发点**在 DSH 仍**无**等价物 | 两者形态不同：pi 是"**选中档位时**触发 + 处理器改档"；DSH 没有选中事件，但有**每请求**的配置替换点 ⇒ 正确移植方式是**把"缓存安全夹档"逻辑搬到请求点**（每请求幂等），级别→档位的纯映射已实现（`custom/adapters/dsh/thinking-level.ts`，只降不升）；✗ 真正改配置需模型路由（`LlmModelReasoningInfo.efforts`）故运行时未验 |
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
（**复核后计数不变**：第 13 行的档位仍是 ②，只是理由从"缺口"改成"形态不同"，见第 6.3 节；
**复核二后仍是 ②**，但理由进一步精确为「三处等价落脚点 + 唯一缺「单独取消压缩」」，见第 8.5 节。）

### 3.2 换基座时风险最高的三类（按理由排序）

1. **会话生命周期三件套**（`session_start` 9 处、`session_shutdown` 6 处、`before_agent_start` 6 处 = **21 个调用点**）：
   粒度从"会话"变"agent/步"，`session_shutdown` 还多了归档停止这条独立路径；本项目在这几处做的是**资源启停与状态落盘**（子代理池、tmux、计划模式、autopilot 调度器、记忆），错配会造成**静默不启动或静默不清理**。
2. **输入与压缩前的干预点**（`input` 4 处、`session_before_compact` 1 处）：
   ~~DSH 侧的对应点是"步"级或只有失败恢复瀑布，没有等价的"输入改写/压缩前改写"闸门；这类差异不会报错，只会行为悄悄变了。~~
   **（该判断已被推翻，见第 6 节。）** 更正后：`input` 的对应点确实在"步"级（`agent/pre-step`）；
   `session_before_compact` 的对应能力**存在**，但必须换介入形态 —— 提供自己的 `CompactionEngine`（`ctx.compaction`），
   或走 `compaction/summary-error` 瀑布（**仅失败路径**）。⇒ 风险性质从"**静默缺失**"降级为"**需要一次架构选择**"：
   只有当移植时**不知道**这条服务级介入点，才会退化成"行为悄悄变了"。
3. **工具结果与请求的 decision 形状**（`tool_call` 3、`tool_result` 3、`before_provider_request` 1、`tool_execution_start` 1 = 8 处）：
   事件级可对应（①），但 pi 的"改参数/改结果"与 DSH 的 `PreToolDecision` / 归一化结果对象**形状不同**，属于每个处理器都要过一遍的机械改造。

---

## 4. 未核实项（必读，明确列出）

1. **自动化任务（autopilot）的 21 个调用点是本清单里最难的一块**：它注册 `session_start`/`session_shutdown`/`turn_*`/`tool_*`/`input`/`agent_settled` 共 7 类，
   我只核到"事件级有对应"，**没有核对**它每个处理器依赖的 `ctx` 能力在 DSH 里是否存在（例如调度器受 `hasUI` 门控这一条在 DSH 里对应什么）。
   ⇒ **复核二部分回答**（第 7.1 节）：调度器的**服务级对手确实存在** —— `ctx.schedule`（`dsh-schedule/lib/types/index.d.ts:15`，"Durable Host-wide reminder management"，含 cron/daily/weekly/every 解析）
   与 `ctx.jobs`（`dsh-jobs/lib/types/index.d.ts:18`）。
   ~~**残留未核实** ✗：DSH 的 `schedule` 是否**不依赖交互客户端**（若是，则 my-pi 那条 `hasUI` 门控带来的「无人值守不跑」在 DSH 侧**自动消失**）。~~
   ⇒ **复核三已回答（第 7.4 节）✓**：**DSH 的 `schedule` 不依赖交互客户端** ✓ —— 它是**宿主级计时器 + 持久任务行**，
   投递经 `sessionController.resolveAgent` 写进**会话收件箱**、并能**唤起冷会话** ✓；**但 `Host` 进程必须运行** ✗
   （且**纯 headless / SDK-only 组合挂不上** ✗）。⇒ my-pi 的 `hasUI` 门控**不被继承** ✓，代价是**部署形态**（Host 常驻）✓。
2. ~~**`session_before_compact` 的"压缩前干预"是否真的缺失**：我只扫了已声明的事件（105 + 59）。
   **未核实** `dsh-compaction` 是否还有别名的、或非事件形式的介入点。这是本清单里**最可能被推翻的一条**。~~
   ⇒ **已核实，并被推翻**（2026-10-11 复核，证据见第 6.1/6.2 节）：**非事件形式的介入点确实存在**，就是 `CompactionEngine` 服务（`ctx.compaction`），
   且有首方实现 `BasicCompactionEngine` 与首方插件在用。**残留未核实**：
   ① 在**真实 profile** 里"**替换引擎**"是否就是官方推荐的扩展路径（我只读到契约里"每个 context 载入一个实现"这句，**未读到**迁移指南或示例插件）；
   ② 除 `summary-error` 瀑布外，是否存在"**每次压缩前必然触发**"的服务级回调（该类只暴露 `compactIfNeeded`/`compactNow`/`compactRegion` 三个抽象方法，
   **未逐个追其调用者**看有没有可插入的判点）。
   ⇒ **已核实（复核二，第 8 节）：存在** ✓ —— `ctx.toolResultPruner` 在**两条触发路径**上都在摘要之前被 `ctx.get` 取用并执行
   （`dsh-compaction-basic/lib/index.js:926`；pressure 分支在过阈值后、`context-overflow` 分支在选范围前），且它是**可替换服务**。
   另外 `summarize()` 被契约称为**唯一**子类定制钩子（`dsh-compaction-basic/lib/types/index.d.ts:20`）。
   **残留未核实** ✗：pruner 的**替换**是否有首方示例（只见到「由引擎取用」与契约，未见替换实例）。
3. **`thinking_level_select`**：已确认**没有** thinking-level 命名的事件；本轮**新增证据**：思考级别在 DSH 里是**适配器配置**
   （`dsh-llm-deepseek/lib/types/config.d.ts:11-13`：`thinking: enabled|disabled|undefined`，注释写"Default thinking effort (default `high`); `off` disables thinking per request"；
   `dsh-llm-deepseek-account/lib/types/config.d.ts:7` 同）＋ 一个**客户端分析事件** `thinking_level_switch`（`dsh-client-product-analytics/lib/types/events.d.ts:45`）。
   **仍未核实**：`model/selection` 的负载类型 `ModelSelection`（`dsh-api-session-controller/lib/types/types.d.ts:35`）**字段里是否含思考级别**（**未展开**该类型）。
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

---

## 6. 复核轮（2026-10-11）：验证或推翻"压缩前干预缺失"

**结论：原结论被推翻。** DSH **有**压缩前介入能力，只是形态与 pi 不同（pi 是"每次压缩前的回调闸门"，DSH 是"**可替换的压缩引擎服务**"＋失败路径瀑布）。

### 6.1 正向证据（文件:行号）

| # | 证据 | 出处 |
|---|---|---|
| 1 | 压缩是**抽象服务**：`export declare abstract class CompactionEngine extends Service`，并注册为 `ctx.compaction` | `dsh-compaction/lib/types/index.d.ts:102`（`interface Context { compaction: CompactionEngine }` 在 `:67-70`） |
| 2 | 契约原文：**"Implementations own trigger policy, retention, and summarization"**；**"Load one implementation per context as `ctx.compaction`"** | 同上 `:94-95`、`:100` |
| 3 | 三个抽象方法：`compactIfNeeded`、`compactNow`、`compactRegion` | 同上 `:116`、`:137`、`:157` |
| 4 | **首方就是"换实现"**：`export declare class BasicCompactionEngine extends CompactionEngine` | `dsh-compaction-basic/lib/types/index.d.ts:24` |
| 5 | 另一个首方插件在**压缩触发后、摘要前**削减超大工具输出（"Once a compaction trigger qualifies, it replaces over-budget text …"） | `dsh-compaction-tool-result-pruner/README.md` |
| 6 | **可拦截瀑布**：`'compaction/summary-error'(payload, next): boolean`，`@mode waterfall` | `dsh-compaction/lib/types/index.d.ts:85`（`@mode` 注解在 `:83`） |
| 7 | 该瀑布的语义明确允许**改输入**：**"synchronously record a durable change to its selected input"**，且"the provider **re-derives and re-prices the selection** before retrying" | 同上 `:72-77` |
| 8 | **首方确实在用它**：`ctx.on("compaction/summary-error", …)` | `dsh-compaction-image-offload/lib/index.js:146`（类型侧 `lib/types/index.js:29`） |
| 9 | 策略可配置（阈值/保留/容量换算） | `dsh-compaction-basic/lib/types/config.d.ts:22`、`:29`、`:42` |
| 10 | 手动压缩命令 `/compact`（"type it and the conversation condenses on demand"） | `dsh-command-compact/README.md` |
| 11 | `compaction/start`、`compaction/summary`、`compaction/end`、`compaction/prune` 属 `SessionEventMap`（日志类型，提交后不可拦截） | `dsh-compaction/lib/types/types.d.ts:15`（条目在 `:21`、`:35`、`:73`、`:88`） |

### 6.2 负向主张的搜索证据（"我搜了什么"）

这是本轮要立的标准：**说"DSH 没有 X"必须交代搜索面**。

- **覆盖目录**：`/root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/`，共 **289 个包**（`ls | wc -l`）。
- **压缩相关包全部打开**：筛选命令 `ls $DSH | grep -iE 'compact|context|session|agent|summar|memory|prompt|hook'`
  ⇒ 与压缩直接相关的 5 个包逐个打开读过：`dsh-compaction`、`dsh-compaction-basic`、`dsh-compaction-tool-result-pruner`、
  `dsh-compaction-image-offload`、`dsh-command-compact`。
- **找"事件形式的压缩前闸门"**：`grep -rnE "^\s*'compaction[^']*'" $DSH --include=*.d.ts`
  ⇒ 只命中 5 行：4 个 `SessionEventMap` 条目（`start`/`summary`/`end`/`prune`）＋ 1 个真事件 `compaction/summary-error`；
  **没有任何 `compaction/prepare`、`compaction/before-*` 形态的 cordis 事件**。
- **找"非事件介入点"**：`grep -rniE "interface |export type |prune|summariz|prepare|transform|before|hook" $DSH/dsh-compaction/lib/types/`
  ⇒ 读过 `index.d.ts`（**160 行全文**）、`types.d.ts`、`checkpoint.d.ts`、`brand.d.ts`、`invariant.d.ts`、`tool-pairing.d.ts`
  ⇒ 介入点是 `index.d.ts` 里的 **`CompactionEngine` 抽象类**（**服务级**），不在事件里。
- **找"谁实现/使用引擎"**：`grep -rln "CompactionEngine" $DSH` ⇒ `dsh-compaction`（契约）、`dsh-compaction-basic`（实现）、`dsh-compaction-image-offload`（引用）。
- **找"是否有拦截式监听"**：`grep -rn "on('compaction\|on(\"compaction" $DSH` ⇒ 仅 `dsh-compaction-image-offload` 的 `summary-error`（`lib/index.js:146`、`lib/types/index.js:29`）。
- **没搜到 ≠ 没有**：第一次清单之所以判"缺失"，是因为**只扫了"事件"这一类扩展点**；DSH 的扩展面**至少有三类**：
  cordis 事件（105）、会话日志类型（59，观察用）、**服务替换**（如 `ctx.compaction`，本轮新增认知）。

### 6.3 更正后的判定（对第 3 节与第 3.2 节的影响）

- **第 3 节第 13 行**：档位**仍是 ②需改语义** —— 不是 ①（因为"每次压缩前的逐次回调"在 DSH 里没有直接对应，得换介入形态），
  也不是 ③（因为能力**确实存在**）；变的是**理由**：从"没有等价闸门"改成"**闸门在服务层**（替换 `CompactionEngine`）＋失败路径瀑布（`compaction/summary-error`）"。
- **三档计数不变**：① 11 / ② 7 / ③ 0（调用点加权 23 / 29，总数 53）。
- **第 3.2 节第 2 类的性质改写**：从"**静默缺失**（不报错、行为悄悄变）"降级为"**需要一次架构选择**"。
  仍成立的部分：`input` 的对应点确实在"步"级（`agent/pre-step`）；若要"**每次压缩前都跑自定义逻辑**"，
  必须**替换/包装压缩引擎**，而不能只挂一个事件。

### 6.4 顺带核实：`thinking_level_select`（第 4 节第 3 条）

- **负向主张（搜索证据）**：`grep -rniE "thinking" $DSH --include=*.d.ts` ⇒ 命中的**全是**：
  客户端 UI 文案（`dsh-client-ui-chat/.../locale.d.ts`、`dsh-client-ui-trajectory/...`）、
  **适配器配置**（`dsh-llm-deepseek/lib/types/config.d.ts:11-13`、`dsh-llm-deepseek-account/lib/types/config.d.ts:7`）、
  分析事件 `thinking_level_switch`（`dsh-client-product-analytics/lib/types/events.d.ts:45`）、
  思考重放元数据（`dsh-llm-deepseek/lib/types/replay.d.ts`）⇒ **没有**任何"思考级别选择"的生命周期钩子或会话事件。
- ⇒ 判断维持 ②（需改语义）：思考级别在 DSH 是**适配器/部署配置**，不是**会话级可选事件**；
  **仍未核实** `ModelSelection`（`dsh-api-session-controller/lib/types/types.d.ts:35`）字段是否携带级别。

### 6.5 本轮的自我更正

- 我（上一轮）把"**只扫事件**"的结论写成了"**DSH 没有等价闸门**"，并在风险清单里把它列为"不会报错、只会行为悄悄变"。
  这是**把"我没搜到"当成了"不存在"** —— 本轮按"负向主张必须交代搜索面"的标准复核后**推翻**。
- 教训（与本项目其他待办同源）：**扩展点可能不止"事件"一类**；扫事件得出的"无对应"，必须再扫一遍**服务/接口/配置**三种形态才能定论。
---

## 7. 第三类扩展点：服务替换清单（2026-10-11 复核二新增）

**为什么要清点它**：第 6 节发现「扩展点不止事件一类」。本轮把**服务替换**这一类**完整清点**了一遍 ——
因为「我的能力在 DSH 里有没有落脚点」这个问题的答案，很可能不在事件表里，而在这张服务表里。

### 7.0 方法与计数（可复跑）

提取口径：扫全部 `.d.ts`，取 `declare module '@deepseek-ai/cordis'` 的 **`interface Context { … }`** 块里的属性行
（即「这个服务挂在 `ctx.<名字>` 上」），对 `@deepseek-ai/*` 全树去重。

    python3 - <<'PY'
    import re,pathlib
    D=pathlib.Path('/root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai'); seen={}
    for f in D.rglob('*.d.ts'):
        s=f.read_text(encoding='utf-8',errors='ignore')
        for m in re.finditer(r'interface Context\s*\{(.*?)\n\}', s, re.S):
            for pm in re.finditer(r'^\s{4,8}([a-zA-Z][A-Za-z0-9_]*)\??\s*:\s*([^;\n]+);', m.group(1), re.M):
                seen.setdefault(pm.group(1),(pm.group(2).strip(), str(f.relative_to(D))))
    print(len(seen))
    PY

结果：**distinct 服务名 132 个**，其中**内核/服务端侧 85 个**、**客户端/API/宿主侧 47 个**。
另有 **76 处 `extends Service` 类**（`grep -rn "extends Service" $DSH --include=*.d.ts`）—— 服务是 DSH 的**一等扩展形态**。

> 判档口径（本节的 ①/②/③/④）：**①可直接对应**（my-pi 有等价能力，改造主要是换接入方式）、
> **②需改造**（能力在但粒度/所有权不同）、**③my-pi 无对应**（DSH 有、my-pi 没有）、
> **④my-pi 独有**（反向差异：my-pi 有而 DSH 服务表里没有）。

### 7.1 内核侧服务（85 个）按族映射

| 族 | 档 | 含的服务 | my-pi 对应 | 备注 |
|---|---|---|---|---|
| **工具 / 命令 / 技能 / 扩展运行时** | **①** | `tools`、`commands`、`skills`、`mcpResources`、`ptcRuntime` | my-pi 侧是 pi 扩展 API（registerTool 61 / registerCommand 14）+ packs 技能库 | `ptcRuntime`（程序化工具调用运行时）my-pi 无对应 ⇒ 单列 ③ |
| **提示词装配与上下文计量** | **①** | `systemPrompt`、`tokenMeter`、`spillStore`、`workspaceChanges` | my-pi 的 context 特性 + 用量度量守门覆盖同类能力 | `spillStore`（溢出存储）对应 my-pi 的 portable/memory/tool-outputs ⇒ ② |
| **压缩（含前置介入）** | **②** | `compaction`、`toolResultPruner` | 见第 8 节：能力存在，形态是服务替换/子类钩子，不是逐次前置回调 | `toolResultPruner` 在两条触发路径上都在摘要前执行 ✓ |
| **会话与持久化** | **②** | `sessionPersistence`、`sessionProjections`、`sessionProjectionCache`、`sessionQuery`、`sessionTitle`、`sessionTelemetry`、`sessionReferenceResolver`、`sessionFeedback`、`launcherSessionQueryPath`、`storage`、`storageDomain`、`attachments`、`fileReferences` | my-pi 用 portable/memory 与 portable/agent/sessions 承担同类职责 | my-pi 没有「会话投影 / 查询引擎 / 标题服务」这三类独立设施 ⇒ ② |
| **子代理 / 团队 / 工作流** | **①** | `subagents`、`subagentModelSelection`、`agentTeams`、`workflowEngine` | my-pi 的 subagent 特性（pi --mode rpc 池 + 收件箱）对应 subagents | `workflowEngine` 与 `agentTeams`（实验）my-pi 无对应 ⇒ ③ |
| **定时调度与后台作业** | **①** | `schedule`、`jobs` | `schedule` = Durable Host-wide reminder management（dsh-schedule/lib/types/index.d.ts:15），对应 my-pi 的 autopilot 调度器；`jobs` 对应后台作业 | **已核实（第 7.4 节）✓**：DSH 的 `schedule` = **宿主级计时器**（`dsh-schedule/lib/index.js` 的 `requestDrive`/`drive`，`setTimeout` @`:1641` + `unref` @`:1645`）读**持久任务行**（`:1567`）投递，**不依赖交互客户端** ✓（全 DSH `hasUI` 命中 **0**，覆盖 289 包 / 3011 文件）；**但 Host 进程必须运行** ✗，且纯 headless/SDK-only 组合挂不上 ✗ ⇒ my-pi 的 `hasUI` 门控**不被继承** ✓ |
| **计划模式** | **①** | `planMode` | my-pi 的 plan-mode 特性有直接对应（PlanModeController） | 本清单里最干净的一处服务级对应 |
| **审批 / 授权 / 权限 / 沙箱 / 提问** | **①** | `approval`、`authorization`、`permissionPresets`、`sandbox`、`sandboxPolicy`、`userQuestions` | my-pi 有交互确认与写入边界约定；userQuestions 对应向用户提问 | sandbox / sandboxPolicy / authorization / permissionPresets my-pi 无对应（本项目靠约定与守门，不靠运行时沙箱）⇒ ③ |
| **LLM / 凭证 / 账号 / 默认模型** | **②** | `llm`、`credentials`、`deepseekAccount`、`deepseekLlmApiExtensions`、`agentDefaultModel` | pi 有自己的 provider/模型配置（portable/agent/models.json） | 接入方式不同 ⇒ ② |
| **文件系统 / 进程 / 外壳 / 终端** | **②** | `fs`、`subprocess`、`shell`、`shellEnv`、`terminals` | pi 侧有同类工具；my-pi 的 tmux 特性对应 terminals（①） | `shellEnv` my-pi 无对应 ⇒ ③ |
| **Agent 生命周期 / 预设 / 目标** | **②** | `agents`、`agentLoop`、`agentPresets`、`configuredAgentIdentities`、`goals` | my-pi 的 mode / plan-mode / autopilot 覆盖部分生命周期 | 粒度与所有权不同（DSH 是 agent 注册表 + 循环服务）⇒ ② |
| **宿主 / 启动 / 插件管理 / 热更 / 自省** | **③** | `loader`、`pluginManager`、`pluginPackages`、`profileContext`、`hmr`、`cordisInspect`、`dynamicCordisRunner`、`entry`、`appExit`、`appReady`、`cmdlineArgs`、`launchEnvironment`、`dshHomePath`、`baseUrl`、`startTime`、`invariants`、`logger`、`events`、`registry`、`reflect`、`root` | my-pi 没有插件管理器 / 热更 / 启动编排这一整套（它靠 patches + 特性目录 + 一个 supervisor 外壳） | ★ 反向差异：my-pi 的 supervisor / 自愈外壳 / 注入面基线 在 DSH 服务表里没有对应项 ⇒ ④ |
| **遥测 / 反馈** | **③** | `otel`、`sessionTelemetry`、`messageFeedback` | my-pi 明确关闭遥测（PI_TELEMETRY=0）并有自己的用量度量守门 | ★ 反向差异：my-pi 的用量度量口径守门属 ④ |
| **设置与配置编辑** | **②** | `settings`、`configEditor` | my-pi 靠 portable/agent/*.json + 守门校验 | 形态不同（schema 驱动表单 vs 文件+守门）⇒ ② |
| **语音** | **①** | `speechToText`、`speechController` | my-pi 的 voice 特性有直接对应 | 实验性包，但语义对应清晰 |
| **单件 / 其它** | **③** | `officeToPdf`、`typert`、`web`、`webhookRuntime`、`workspaceRegistry` | my-pi 无 Office 转换；web 对应 my-pi 的 web-terminal 特性（④ my-pi 独有形态） | typert / webhookRuntime / workspaceRegistry my-pi 无对应 ⇒ ③ |

逐项出处（每族里的每个服务，按名列出类型与声明位置）：

**工具 / 命令 / 技能 / 扩展运行时**（档 ①）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `tools` | `ToolRuntime` | `dsh-tools/lib/types/index.d.ts:34` |
| `commands` | `CommandRuntime` | `dsh-commands/lib/types/index.d.ts:65` |
| `skills` | `SkillRegistry` | `dsh-skill/lib/types/index.d.ts:201` |
| `mcpResources` | `McpResourceRuntime` | `dsh-mcp-resources/lib/types/index.d.ts:11` |
| `ptcRuntime` | `PtcRuntime` | `dsh-ptc-runtime/lib/types/index.d.ts:59` |

**提示词装配与上下文计量**（档 ①）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `systemPrompt` | `SystemPrompt` | `dsh-system-prompt/lib/types/index.d.ts:12` |
| `tokenMeter` | `TokenMeter` | `dsh-token-meter/lib/types/index.d.ts:16` |
| `spillStore` | `SpillStore` | `dsh-spill/lib/types/index.d.ts:22` |
| `workspaceChanges` | `WorkspaceChanges` | `dsh-workspace-changes/lib/types/types.d.ts:118` |

**压缩（含前置介入）**（档 ②）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `compaction` | `CompactionEngine` | `dsh-compaction/lib/types/index.d.ts:69` |
| `toolResultPruner` | `ToolResultPruner` | `dsh-compaction-tool-result-pruner/lib/types/index.d.ts:15` |

**会话与持久化**（档 ②）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `sessionPersistence` | `SessionPersistence` | `dsh-session-persistence/lib/types/index.d.ts:76` |
| `sessionProjections` | `SessionProjectionRegistry` | `dsh-session-projection/lib/types/index.d.ts:25` |
| `sessionProjectionCache` | `SessionProjectionCache` | `dsh-session-projection-cache/lib/types/index.d.ts:27` |
| `sessionQuery` | `SessionQueryEngine` | `dsh-session-query/lib/types/index.d.ts:25` |
| `sessionTitle` | `SessionTitleService` | `dsh-session-title/lib/types/index.d.ts:33` |
| `sessionTelemetry` | `SessionTelemetryBackend` | `dsh-session-telemetry/lib/types/index.d.ts:20` |
| `sessionReferenceResolver` | `SessionReferenceResolver` | `dsh-session-reference/lib/types/index.d.ts:20` |
| `sessionFeedback` | `SessionFeedbackService` | `dsh-command-feedback/lib/types/index.d.ts:24` |
| `launcherSessionQueryPath` | `string` | `dsh-session-query-sqlite/lib/types/index.d.ts:17` |
| `storage` | `Storage` | `dsh-storage/lib/types/index.d.ts:25` |
| `storageDomain` | `DomainFacility` | `dsh-storage-domain/lib/types/index.d.ts:27` |
| `attachments` | `AttachmentStore` | `dsh-attachment/lib/types/index.d.ts:14` |
| `fileReferences` | `FileReferenceService` | `dsh-file-reference/lib/types/index.d.ts:16` |

**子代理 / 团队 / 工作流**（档 ①）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `subagents` | `SubagentRuntime` | `dsh-subagent/lib/types/index.d.ts:64` |
| `subagentModelSelection` | `SubagentModelSelectionConfig` | `dsh-tool-subagent/lib/types/model-selection-settings.d.ts:9` |
| `agentTeams` | `TeamService` | `dsh-experimental-agent-team/lib/types/index.d.ts:14` |
| `workflowEngine` | `WorkflowEngine` | `dsh-workflow/lib/types/index.d.ts:15` |

**定时调度与后台作业**（档 ①）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `schedule` | `ScheduleService` | `dsh-schedule/lib/types/index.d.ts:15` |
| `jobs` | `JobRegistry` | `dsh-jobs/lib/types/index.d.ts:18` |

**计划模式**（档 ①）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `planMode` | `PlanModeController` | `dsh-plan-mode/lib/types/index.d.ts:51` |

**审批 / 授权 / 权限 / 沙箱 / 提问**（档 ①）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `approval` | `ApprovalService` | `dsh-user-approval/lib/types/index.d.ts:21` |
| `authorization` | `AuthorizationService` | `dsh-authorization/lib/types/index.d.ts:35` |
| `permissionPresets` | `PermissionPresetService` | `dsh-permission-presets/lib/types/index.d.ts:12` |
| `sandbox` | `SandboxProvider` | `dsh-sandbox/lib/types/index.d.ts:118` |
| `sandboxPolicy` | `SandboxPolicyService` | `dsh-sandbox-policy/lib/types/index.d.ts:30` |
| `userQuestions` | `UserQuestionService` | `dsh-user-questions/lib/types/index.d.ts:16` |

**LLM / 凭证 / 账号 / 默认模型**（档 ②）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `llm` | `LlmRuntime` | `dsh-llm/lib/types/index.d.ts:30` |
| `credentials` | `CredentialProvider` | `dsh-credentials/lib/types/index.d.ts:100` |
| `deepseekAccount` | `DeepSeekAccount` | `dsh-deepseek-account/lib/types/index.d.ts:14` |
| `deepseekLlmApiExtensions` | `DeepSeekLlmApiExtensionRegistry` | `dsh-deepseek-llm-api-extensions/lib/types/index.d.ts:11` |
| `agentDefaultModel` | `AgentDefaultModelConfig` | `dsh-agent-default-model/lib/types/index.d.ts:8` |

**文件系统 / 进程 / 外壳 / 终端**（档 ②）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `fs` | `FileSystem` | `dsh-fs/lib/types/index.d.ts:17` |
| `subprocess` | `SubprocessRuntime` | `dsh-subprocess/lib/types/index.d.ts:43` |
| `shell` | `ShellExecutor` | `dsh-shell/lib/types/index.d.ts:16` |
| `shellEnv` | `ShellEnvRegistry` | `dsh-shell-env/lib/types/index.d.ts:16` |
| `terminals` | `TerminalSessionService` | `dsh-terminal/lib/types/index.d.ts:15` |

**Agent 生命周期 / 预设 / 目标**（档 ②）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `agents` | `AgentRegistry` | `dsh-agent/lib/types/index.d.ts:20` |
| `agentLoop` | `AgentLoop` | `dsh-agent-loop/lib/types/index.d.ts:29` |
| `agentPresets` | `AgentPresetRegistry` | `dsh-agent-preset-registry/lib/types/index.d.ts:17` |
| `configuredAgentIdentities` | `ConfiguredAgentIdentities` | `dsh-agent-loop/lib/types/index.d.ts:38` |
| `goals` | `GoalService` | `dsh-goal/lib/types/index.d.ts:19` |

**宿主 / 启动 / 插件管理 / 热更 / 自省**（档 ③）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `loader` | `Loader` | `cordis-plugin-loader/lib/types/index.d.ts:39` |
| `pluginManager` | `PluginManager` | `dsh-plugin-manager/lib/types/index.d.ts:34` |
| `pluginPackages` | `PluginPackages` | `dsh-app-boot/lib/types/profile-resolution/service.d.ts:8` |
| `profileContext` | `ProfileContext` | `dsh-app-boot/lib/types/profile-context.d.ts:29` |
| `hmr` | `Hmr` | `dsh-hmr/lib/types/index.d.ts:7` |
| `cordisInspect` | `CordisInspectRegistryService` | `dsh-cordis-host-runner/lib/types/inspect-registry.d.ts:24` |
| `dynamicCordisRunner` | `DynamicCordisRunnerService` | `dsh-cordis-host-runner/lib/types/index.d.ts:52` |
| `entry` | `Entry` | `cordis-plugin-loader/lib/types/index.d.ts:45` |
| `appExit` | `AppExit` | `dsh-cmdline/lib/types/index.d.ts:55` |
| `appReady` | `AppReady` | `dsh-cmdline/lib/types/index.d.ts:57` |
| `cmdlineArgs` | `CmdlineArgs` | `dsh-cmdline/lib/types/index.d.ts:53` |
| `launchEnvironment` | `LaunchEnvironmentSnapshot` | `dsh-launch-environment/lib/types/index.d.ts:78` |
| `dshHomePath` | `typeof dshHomePath` | `dsh-app-boot/lib/types/index.d.ts:26` |
| `baseUrl` | `string` | `cordis/lib/types/context.d.ts:23` |
| `startTime` | `number` | `cordis-plugin-loader/lib/types/index.d.ts:42` |
| `invariants` | `InvariantRegistry` | `dsh-invariants/lib/types/index.d.ts:53` |
| `logger` | `LoggerService` | `cordis/lib/types/context.d.ts:27` |
| `events` | `EventsService` | `cordis/lib/types/context.d.ts:25` |
| `registry` | `RegistryService` | `cordis/lib/types/context.d.ts:31` |
| `reflect` | `ReflectService` | `cordis/lib/types/context.d.ts:29` |
| `root` | `this` | `cordis/lib/types/context.d.ts:21` |

**遥测 / 反馈**（档 ③）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `otel` | `OTel` | `dsh-otel/lib/types/index.d.ts:7` |
| `sessionTelemetry` | `SessionTelemetryBackend` | `dsh-session-telemetry/lib/types/index.d.ts:20` |
| `messageFeedback` | `MessageFeedbackService` | `dsh-message-feedback/lib/types/index.d.ts:18` |

**设置与配置编辑**（档 ②）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `settings` | `SettingsForms` | `dsh-settings/lib/types/index.d.ts:27` |
| `configEditor` | `ConfigEditor` | `dsh-config-editor/lib/types/index.d.ts:6` |

**语音**（档 ①）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `speechToText` | `SpeechToText` | `dsh-experimental-speech-to-text/lib/types/index.d.ts:9` |
| `speechController` | `SpeechController` | `dsh-experimental-api-speech-to-text/lib/types/index.d.ts:11` |

**单件 / 其它**（档 ③）

| 服务 | 类型 | 声明位置 |
|---|---|---|
| `officeToPdf` | `OfficeToPdf` | `dsh-office-to-pdf/lib/types/index.d.ts:13` |
| `typert` | `TypertRegistryContract` | `dsh-typert-protocol/lib/types/types.d.ts:574` |
| `web` | `WebRuntime` | `dsh-web/lib/types/index.d.ts:15` |
| `webhookRuntime` | `WebhookRuntime` | `dsh-webhook/lib/types/index.d.ts:8` |
| `workspaceRegistry` | `WorkspaceRegistry` | `dsh-workspace/lib/types/index.d.ts:82` |

> **计数口径的一处修正（诚实标注）**：本节的"内核 / 客户端"是按**包名路径前缀**机械划分的，而 `sessionLogDownload` 声明在
> `dsh-session-log-export/lib/types/client/index.d.ts`（**客户端侧**），因包名前缀是 `dsh-session-` 被误分入内核侧。
> ⇒ **实际内核侧 84 个、客户端侧 48 个**（合计仍是 132）；该服务本身在 §7.2 已并入"客户端 UI 服务"一批处理。

### 7.2 客户端 / API / 宿主侧服务（47 个）

my-pi 是**终端 TUI 应用**（pi-tui + 11 个 UI 补丁），没有「浏览器客户端 + Remote API」这一层，因此这一批的映射结论是**结构性的**：

- **客户端 UI 服务**（`slots`、`layout`、`theme`、`locale`、`conversation`、`uiSession`、`uiWorkspace`、`documentPreviews`、
  `sidebarRight`、`sidebarRightTabs`、`feedbackUi`、`settingsSchema`、`inputTriggers`、`chatFileMentions`、`userQuestionPanels`、
  `modelDirectories`、`clientModules`、`modules`、`resources`、`fileUpload`、`fileUploads`、`shortcuts`、`commandUi`、
  `configForms`、`connection`、`pluginRegistryProbe`、`productAnalytics`、`webTerminals`、`sessions`、`workspaces`、`remote` …）
  ⇒ 对应 my-pi 的 **TUI 渲染层与那 11 个 UI 补丁** ⇒ **②需改造**（形态完全不同：插槽注册 vs 补丁）。
- **Remote/API 控制器服务**（`sessionController`、`workspaceController`、`jobController`、`terminalController`、
  `settingsController`、`credentialsController`、`directoryPickerController`、`typertGateway`、`webServer` …）
  ⇒ my-pi **无对应**（它没有「宿主—客户端 RPC 面」）⇒ **③**。
- **反向差异 ④**：my-pi 的 **web-terminal 特性（自带鉴权与传输守门）** 在 DSH 里是 `webServer` + `web` 服务，
  但 my-pi 那套形态没有等价服务 ⇒ 记为 ④。

### 7.3 数量汇总

| 档 | 内核侧（85） | 客户端侧（47） | 说明 |
|---|---|---|---|
| **①可直接对应** | 工具/命令/技能族、调度与作业族、计划模式、子代理族、语音、审批族（部分） | — | 最省事的一批 |
| **②需改造** | 压缩、会话与持久化、提示词与计量、LLM/凭证、文件系统/进程、Agent 生命周期、设置 | 全部客户端 UI 服务 | 换接入方式/粒度，不是「没有」 |
| **③my-pi 无对应** | 宿主/启动/插件管理族、遥测族、沙箱/授权族、单件族 | 全部 Remote/API 控制器 | DSH 有、my-pi 没有（**换基座后可白拿**） |
| **④my-pi 独有** | supervisor/自愈外壳、注入面基线、用量度量守门、web-terminal、tmux 注册表 | — | 这些**必须自己搬**，DSH 服务表里没有落脚点 |

> **一句话**：85 个内核服务里，**没有一项**是「my-pi 的能力在 DSH 里找不到任何形态」的 ——
> 与第 3 节「③无对应 0 个」的结论一致；真正的成本在 **②的接入形态改造** 与 **④的自研件搬运**。

---

## 8. 复核二：追 `CompactionEngine` 的调用者（补齐第 4 节第 2 条的残留缺口）

**结论：缺口②已被回答 —— 存在「每次压缩前必然触发」的服务级点** ✓；
**并且「换引擎」不是唯一途径** ✗✓（至少四条服务级杠杆）。

### 8.1 谁调用三个抽象方法（文件:行号）

| 调用点 | 位置 | 触发路径 |
|---|---|---|
| `ctx.on("agent/pre-step", …)` ⇒ `compactIfNeeded(agent, "pressure", signal)` | `dsh-compaction-basic/lib/index.js:839`、`:841` | **自动**：每步边界压力检查（serial 监听） |
| `ctx.on("agent/request-error", …)` ⇒ `compactIfNeeded(agent, "context-overflow", signal)` | 同上 `:861`、`:872` | **自动**：provider 确认 `CONTEXT_WINDOW_EXCEEDED` 后的一次头收缩 |
| `ctx.compaction.compactNow(...)` | `dsh-command-compact/lib/index.js:55` | **手动** `/compact` 命令 |
| `compactRegion(...)`（内部） | `dsh-compaction-basic/lib/index.js:934`、`:956`、`:971` | 由上面两条自动路径与显式范围调用 |

⇒ **除引擎自身与 `/compact` 外没有别的调用者**（`grep -n "this.compactIfNeeded"` 仅 `:841`、`:872`）。

### 8.2 ★「每次压缩前必然触发」的服务级点：**`ctx.toolResultPruner`** ✓

    // dsh-compaction-basic/lib/index.js:926
    const prune = this.ctx.get("toolResultPruner");
    if (trigger === "context-overflow") {
        if (prune !== void 0) { prune.pruneSession(agent.session); measurement = meter.measure(agent.session); }
        ...
    }
    // pressure 分支：过阈值后同样先 prune、重新计量、再决定是否摘要
    if (measurement.totalTokens < spec.thresholdTokens) return null;
    if (prune !== void 0) { prune.pruneSession(agent.session); measurement = meter.measure(agent.session); }

⇒ **两条触发路径都在摘要之前调用它**（`context-overflow` 在选范围前、`pressure` 在过阈值后）✓
⇒ 而且它是**可替换服务**：`ToolResultPruner extends Service`，注册名 `toolResultPruner`
（`dsh-compaction-tool-result-pruner/lib/types/index.d.ts:15`、`:19`；实现侧 `super(ctx, "toolResultPruner")` @ `lib/index.js:71`）✓✓

### 8.3 四条服务级杠杆（「换引擎」不是唯一途径 ✗）

| # | 杠杆 | 覆盖时机 | 出处 |
|---|---|---|---|
| 1 | **提供/替换 `ctx.compaction`**（`CompactionEngine` 实现） | 触发策略、保留策略、摘要全流程 | `dsh-compaction/lib/types/index.d.ts:102`、`:94-100`（"Implementations own trigger policy, retention, and summarization"） |
| 2 | ★ **子类化 `BasicCompactionEngine` 覆写 `summarize()`** | **每一次摘要**（契约称其为**唯一**子类定制钩子） | `dsh-compaction-basic/lib/types/index.d.ts:20`（"`summarize()` is the sole subclass customization hook"）、`:43`、`:49` |
| 3 | ★ **提供/替换 `ctx.toolResultPruner`** | **每一次压缩的摘要之前**（两条触发路径都过） | 见 8.2 |
| 4 | **替换 `ctx.tokenMeter`** | 每一次决策的计价（压力、保留、范围、收缩校验） | `dsh-compaction-basic/README.md`（"One measurement service prices every decision"）＋ `dsh-compaction/lib/types/index.d.ts`（`ctx.tokenMeter`） |

**另有两条非服务级手段**：`compaction/summary-error` 瀑布（**仅失败路径**，`@mode waterfall`，可**持久改写被选中的输入** @ `:72-77`）
与**配置化策略**（`dsh-compaction-basic/lib/types/config.d.ts:22`、`:29`、`:42`）。

### 8.4 同时**部分回答**了第 4 节第 1 条（「替换引擎是不是官方推荐路径」）

**是。** `dsh-jobs` 的抽象服务文档把这条路径**写成了契约原话**：
`dsh-jobs/lib/types/index.d.ts:22` —— "**Subclass, implement the abstract members, and load the subclass as a plugin** — it registers as `ctx.jobs`" ✓
⇒ 「**子类化 + 作为插件加载**」是 DSH **一等、成文**的扩展方式，不是绕路 ✓✓

### 8.5 更正后的 `session_before_compact` 结论（第 3 节第 13 行 / 第 3.2 节第 2 类）

| pi 的能力（`vendor/pi/.../types.ts:763`："can be cancelled or customized"） | DSH 的对应 | 判定 |
|---|---|---|
| **自定义压缩内容** | 覆写 `summarize()`（杠杆 2）✓ | **①能力等价**（形态从「回调」变「子类钩子」） |
| **改写/裁剪被压缩的输入** | 替换 `toolResultPruner`（杠杆 3）✓ | **①能力等价**（且**每次压缩前都跑**） |
| **失败后恢复** | `compaction/summary-error`（waterfall）✓ | **①能力等价** |
| **取消/否决这次压缩** | 只有 `AbortSignal`；**没有**「单独否决压缩」的钩子 ✗ | **残留差异**（要否决得替换引擎或干预 `agent/pre-step`） |

⇒ 第 3 节第 13 行档位**仍是 ②需改语义**（因为「逐次前置回调」这个**形态**确实没有），
但**理由进一步精确**为：「能力有**三处**等价落脚点（子类钩子 / 裁剪服务 / 失败瀑布），**唯一缺的是「单独取消压缩」**」。
⇒ 第 3.2 节第 2 类的风险**再降一级**：从「需要一次架构选择」改为「**需要在三个成文介入点里选一个**」（都是首方已用的路径）。

**顺带一个必须记住的差异** ✗：压缩的摘要调用是 `ctx.llm.stream()` **直连**，文档明说它
"**without running the loop-only `agent/request` extension point**"（`dsh-compaction-basic/README.md`）
⇒ 挂 `agent/request`（对应 my-pi 的 `before_provider_request`）**看不到压缩请求** ✗ —— 移植时若指望在那里做计费/改写，会**静默失效**。

## 7.4 复核三：`schedule` 是否依赖交互客户端（**已核实 ✓**）

**问题**：my-pi 的调度器受 `hasUI` 门控（`custom/features/autopilot/index.ts:886`：无头会话只做种子对账、不启调度器 ✗）
⇒ 若 DSH 的 `schedule` 也依赖 UI，则「无人值守不跑」会在换基座后**继续存在**。**结论：不依赖** ✓。

**① 驱动 = 宿主服务内的计时器（不是客户端）✓**：`dsh-schedule/lib/index.js` 的 `ScheduleService.requestDrive()`
（注释原文 "Recompute the nearest obligation **after startup or a durable change**" @`:1533-1536`）→ `drive()`
扫**持久任务行**：`const due = this.tasks().filter((task) => task.status === "active" && Date.parse(task.record.scheduledAt) <= scanNow)` @`:1567`
⇒ 只依赖**已存任务 + 当前墙钟** ✓；随后为下一次义务**只武装一个** `setTimeout` @`:1641`，
并 **`this.timer.unref()`** @`:1645`（不阻止进程退出，但**Host 在跑时照常触发** ✓）。
README 也明写「**one Host timer**」（`dsh-schedule/README.md:63`）。

**② 投递不需要 UI ✓**：`drive()` 里 `await this.ctx.sessionController.resolveAgent(task.sessionId)` @`:1569`
⇒ 经**会话控制器**解析原会话；README:65 原文：「Delivery resolves the original Session through `sessionController.resolveAgent`.
A plugin-sourced `followup()` synchronously appends the message to the **Session inbox**; successful Session flush acknowledges
durable delivery.」✓ 即投递 = **写进会话收件箱**（不需要有人开着界面 ✓）。

**③ 冷会话可被唤起 ✓**：README:12「The Host restores a **cold Session** when delivery is due.」✓
⇒ 目标会话**不必是活跃/交互中的** ✓。

**④ 负向证据（关键 ✓）**：全 DSH 搜 `hasUI` ⇒ **0 命中** ✓。
命令：`grep -rn "hasUI" $DSH --include=*.js --include=*.d.ts`（`$DSH` = `/root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai`）；
覆盖：**289 个包 / 3011 个 js+d.ts 文件** ✓ ⇒ DSH **没有** my-pi 那种 `hasUI` 门控 ✓。

**⑤ 生命周期挂点全是服务端 agent/session 事件 ✓**：`agent/created` @`:2660`、`agent/disposed` @`:2663`、
`session/created` @`:2669`、`workspace/session-activity` @`:2682`、`workspace/session-stop` @`:2694` ✓ —
**没有一个是客户端/UI 事件** ✓；包里唯一的 `attach`/`attached`（`:2654-2702`）是**给 agent 挂 schedule 工具**
（`registerScheduleTools(...)`、`ctx.agents.roots()` ✓），**不是 UI 附着** ✓。

**但必须一并记住的约束（如实 ✗）**：
1. **Host 进程必须运行** ✓ —— README:153 原文「**The Host must be running to deliver reminders.**」✗
   ⇒ 不是「无需任何进程」，而是「**无需交互客户端**」✓；
2. **纯 headless / SDK-only 组合挂不上** ✗ —— README:26 原文：Schedule **cannot be mounted alone in a headless or SDK-only
   composition**: delivery requires the **Host Web Session controller** and a Session persistence backend, because a delivery
   commits only after the Session acknowledges `session/flush` ✓ ⇒ 它属于**宿主服务形态**，不是「无头 agent 自跑」✗；
3. **回执只确认「进了收件箱」，不确认「模型执行了」✗** —— README:65 原文「Receipts … acknowledge inbox delivery,
   **not model execution**」✓ ⇒ 这**与 my-pi autopilot 刚修的那类「报成功却没做事」是同一风险族** ✓✓
   （我在 my-pi 侧加的 `suspect: unparsed tool call` 检测对应 DSH 侧的什么，**未核实** ✗）；
4. **非 exactly-once** ✗：崩溃或任务写失败可在会话 flush 后**重复投递**（README:154 ✓）；且重复任务**只补投最近一次错过的发生**（README:12 ✓）；
5. **存储 = 一个 JSON 域文档** `schedule.json`（README:160 ✓，经 storage-domain 路由 ✓）。

**⑥ `dsh-jobs` 与 `dsh-schedule` 的分工（一句话）✓**：`jobs` = **会话内**后台长任务注册表
（所有权按 agent 会话隔离、需要「服务该 owner 的控制器」附着 ✗ —— 那是**控制器**不是 UI ✓）；
`schedule` = **宿主级持久**的**墙钟提醒**，到点以**后续消息**投回原会话 ✓。

**⇒ 对换基座的可执行结论 ✓**：**「无人值守不跑」这条在 DSH 侧不继承** ✓ —— my-pi 需要**交互会话**（`hasUI` ✗），
DSH 只需要**Host 常驻**（无客户端亦可 ✓）⇒ 这是**部署形态的改变**，**不是能力缺口** ✓。
