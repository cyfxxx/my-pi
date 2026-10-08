# 子代理优化：常驻 RPC 池（对照 DSH）

> 2026-10-07。本文是**立项文档**：先给实测证据与差距表，再给目标架构、分期实施与验证方式。
> 结论先行：my-pi 的子代理**不缺并行**（已经有带上限的并发池），真正的差距是**每个任务都要付一次
> pi 冷启动（本机实测 35–45s）**。而 pi 自带 `--mode rpc`（支持 `prompt` + `new_session` +
> `parentSession`），因此可以做成**常驻池**——**零 vendor 补丁**即可拿到 DSH 那两条真正的优势
> （热复用 + 隔离），代价只有进程边界。

## 一、先纠正一个预设（靠实测，不靠印象）

| 能力 | my-pi 现状 | 证据 |
|---|---|---|
| 多任务并行 | **已有**，带并发上限 | `subagent/core/helpers.ts:179-212`：`limit = max(1, min(concurrency, items.length))` + `Promise.all(workers)`；上限按"是否本地推理"调整（`subagent/index.ts:40`） |
| 三种编排形态 | **已有** `single` / `parallel` / `chain` | `subagent/index.ts:53-55`（`chain` 用 `{previous}` 引用上一步输出） |
| agent 预设 | **已有** `scout` / `worker` / `reviewer` | 同上 |
| 独立上下文 | **已有** `--no-session`（空上下文） | `core/runner.ts:88-90` |
| 继承上下文 | **已有** `context: 'fork'`（`--fork`） | `core/types.ts:61-65` |
| 单任务模型覆盖 | **已有** `model` 参数 | `runner.ts:112` `resolveModelId(...)` |
| **每次任务的进程启动** | **每次都要**：`spawn(process.execPath, [cli.js, ...])` | `core/runner.ts:167` `spawn(invocation.command, invocation.args, ...)` |
| **冷启动成本** | 本机实测 **35–45s**（两实例并发 55–73s） | 本会话早先的 headless 实验 |
| 主会话阻塞 | **同步阻塞**（AGENTS.md 明确） | `docs` / `AGENTS.md` |
| 子代理可用工具 | **仅 pi 内置**（`--no-extensions`） | `core/runner.ts:88` |

**所以"缺并行 fan-out"不成立**——那是我的错误预设，实测推翻了它。真正的成本是**进程启动**，
而它恰好是可以消掉的那一项。

## 二、DSH 赢在哪（两条，其余 my-pi 已有）

1. **进程内子代理**：没有进程启动成本（my-pi 每次 35–45s）。
2. **`subagent_fork` 继承会话**：my-pi 有 `--fork`，形态上等价。
3. **`workflow`**：脚本化 fan-out（多阶段 + 结构化结果）。my-pi 没有等价物——
   但 my-pi 的 `parallel`/`chain` 覆盖了多数用例，`workflow` 是"模型写一段编排脚本"的另一种形态，
   **列为后续议题，不在本期范围**。

结论：**赢点在"启动成本"**，所以本期目标就是把启动成本消掉，同时**不牺牲隔离**。

## 三、目标架构：常驻 RPC 子代理池

### 为什么可行（关键证据）

`vendor/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts` 定义了完整的控制协议：

```ts
| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
| { id?: string; type: "new_session"; parentSession?: string }   // ← 新建（或分叉）会话
| { id?: string; type: "abort" }
| { id?: string; type: "set_model"; provider: string; modelId: string }
| { id?: string; type: "get_state" | "get_session_stats" | ... }
```

- 启动方式：`pi --mode rpc`（`cli/args.ts:99-106` 校验 `text|json|rpc`；包入口 `./rpc-entry` →
  `dist/bundle/rpc-entry.js`）。
- **一轮结束的信号就是 `agent_settled`**（`modes/rpc/rpc-mode.ts:357` `if (event.type === "agent_settled")`）
  ——与 my-pi 空闲门依赖的是**同一个事件**，语义已经在 my-pi 侧验证过（它是唯一可安全 `triggerTurn` 的时刻）。
- `new_session` 带 `parentSession` ⇒ **分叉语义**（等价 my-pi 现在的 `--fork`）。
- `abort` 是**协议内**的取消（比现在 `scheduleKillChain` 杀进程更干净）。

### 设计

```
                    ┌──────────────── 常驻 pi --mode rpc 进程（池，大小 = 并发上限）────────────────┐
subagent(parallel) ─┤ 1. new_session (fresh)          或 new_session {parentSession}  → 隔离/分叉     │
                    │ 2. set_model（该 agent 预设需要时）                                              │
                    │ 3. prompt(task)                                                                  │
                    │ 4. 收集事件直到 agent_settled → 组装现有 SingleResult（复用现有 UI/汇总代码）     │
                    └──────────────────── 进程留用，下一个任务复用 ────────────────────────────────────┘
```

要点：

1. **隔离不能妥协**：每个任务前必须 `new_session`。**这是本期第一件要验证的事**——
   若 `new_session` 不能完全隔离（例如残留 compactionSummary / 工具状态 / 消息数组），
   则退化为"池只用于同一 `chain`/同一批 `parallel` 内的复用"，并把这个限制写进文档。
2. **单飞**：一个 rpc 进程同一时刻只能跑一个 `prompt`（协议是单会话）→ **池大小 = 并发上限**，
   每个 worker 独占一个进程。这与现有 `limit` 逻辑天然吻合。
3. **崩溃恢复**：进程退出/协议错乱 → 杀掉并重建该 worker，**不是**让整个 `subagent` 调用失败；
   重试预算与现有 `retries` 语义对齐。
4. **超时与取消**：用 `abort` 请求；保留现有 30 分钟总超时作为兜底（`runner.ts` 的 `totalTimer`）。
5. **顺带能拿到的一项能力**：rpc 是**普通模式**，不加 `--no-extensions` 就会加载 my-pi 的扩展 ⇒
   子代理可以拥有 memory/todo/tmux 等工具。而配合本会话刚落地的 **`exposure: 'deferred'`**（注册但不声明），
   这**不会**让子代理的前缀膨胀——重型工具只在它真的 `tool_search` 时才进来。
   **这一条建议作为独立开关**（`subagent` 的参数或 agent 预设字段），默认保持现在的"仅内置工具"，
   因为它引入了"子代理能改状态"的新风险面。
6. **不改变对外契约**：`subagent` 的工具名/参数/返回结构不变；`SingleResult` 的字段继续由
   `runner.ts` 的现有组装逻辑产生。**实现上是给 `runSubprocessAgent` 增加一条"走池"的实现路径**，
   保留原路径作为回退（`PI_SUBAGENT_POOL=off` 时完全回到今天的行为）。

## 四、分期（每期都是"能独立验证、能独立回退"的）

| 期 | 内容 | 验收 |
|---|---|---|
| ~~**S1**~~ ✅ | **协议探针（已完成，见第七节）**（不改产品代码）：写一个临时脚本起 `pi --mode rpc`，跑 `new_session`→`prompt`→收到 `agent_settled`，两次任务，**断言第二次没有前一次的上下文残留**、并测出"第二个任务的墙钟" | 拿到冷启动 vs 热复用**实测对比数字**；隔离结论有证据 |
| **S2** | 池的最小实现：单 worker 复用 + 崩溃重建；`PI_SUBAGENT_POOL=off` 回退 | 现有 subagent 测试全绿；新增池的纯逻辑测试（framing/状态机） |
| **S3** | 池铺到 `parallel`（池大小 = 并发上限）+ `abort` 取消 + 日志 | 端到端：3 个并行任务只起 ≤1 次冷启动 |
| **S4** | 可选：子代理加载扩展（`deferred` 配合）+ 文档/守门 | 前缀体积不退化；风险面有文档与开关 |

**S1 之前不要动产品代码**——因为整个方案押在"`new_session` 真的隔离"这一个假设上。

## 五、风险与已知代价

- **隔离假设**（最大风险，S1 验证）。若不成立 → 见设计要点 1 的退化方案。
- **进程泄漏**：池进程必须挂 `session_shutdown` 清理（参考 `tmux` 的 `shutdownCleanup`）。
- **协议版本漂移**：`--mode rpc` 是 pi 的公开面，但仍在 `vendor/` 内；上游改动时靠现有
  `scripts/check-upstream.sh` 的"adapters 依赖的 API 面是否变动"来预警。
- **成本不再是瓶颈**（用户已明确不限制），所以**不做**"为省钱而牺牲隔离"的取舍。
- **本期不做**：`workflow`（脚本化编排）、进程内子代理（需要改 vendor 的会话模型）。

## 六、与本次会话其他改动的协同

- **空闲门**（`tmux/watcher.ts` 的 `createIdleGate`）：池的"任务完成 → 唤醒主会话"直接复用同一套语义
  （`agent_settled` 才 `triggerTurn`）。
- **`executionMode`**（`adapters/tool-adapter.ts`）：`subagent` 将来若支持**异步/后台**，需要评估它是否
  该标 `sequential`——目前它是同步阻塞的，**不标**是正确的；一旦改成后台，判定要重做。
- **`deferred` + `tool_search`**：让"子代理也加载扩展"变得可负担（见设计要点 5）。

## 七、S1 进展（2026-10-07，实测）

探针脚本 `/tmp/rpc-probe.mjs`（临时件，不入库）：起 `pi --mode rpc --no-extensions --no-session`，
依次 `prompt` → 等 `agent_settled` → `new_session` → `prompt`。

**已拿到的确定性数据（可信）**：

| | 墙钟 |
|---|---|
| 冷：进程启动 + 任务 1 | **28.5s** |
| 热：复用同一进程跑任务 2 | **10.4s** |
| 节省 | **18.1s（63%）** |

`new_session` 返回 `{"success":true,"data":{"cancelled":false}}`；`prompt` 返回
`{"success":true,"data":{"disposition":"started"}}`，而"这轮跑完"确实由 `agent_settled` 事件通知
（与设计预期一致，任务 2 期间收到 101 个事件）。

**隔离结论：未验证（不能说成立，也不能说失败）。**

原因是我第一次用了**错误的方法**：问模型"你此前收到过几条用户消息"，它答 **「2」**。
这**既可能**是任务 1 的上下文残留（任务 1 有 1 条用户消息 + 本次提问 = 2），
**也可能**只是模型数不清（让 LLM 自省消息条数本来就不可靠）。**两种解释无法区分**，
所以这条证据无法支撑任何结论——**方法论问题，不是 pi 的行为证据**。

**下一步（S1 v2）**：改用**确定性**判据——把 rpc 进程指向 `scripts/lib-fake-provider.mjs`
（它会记录每个请求的 body），直接断言**第二次任务的 `messages` 里只有任务 2、不含任务 1**。
不依赖模型自述。在这一步通过之前，**S2 不启动**（整个池方案押在"`new_session` 真隔离"上）。

## 八、S1 v2 结果：隔离**确定性验证通过**（2026-10-07）

改用确定性判据（不依赖模型自述）：把 rpc 进程指向 `scripts/lib-fake-provider.mjs`（记录每个请求 body），
两次任务各带一个唯一暗号，直接断言**第二次请求的 `messages` 里不含第一次的暗号**。

探针 `/tmp/rpc-isolation.mjs`（临时件，不入库）输出：

```
/chat/completions 请求数: 2
  请求1: roles=[system,user] 含暗号A=true 含暗号B=false 消息数=2
  请求2: roles=[system,user] 含暗号A=false 含暗号B=true 消息数=2

冷启动（spawn → 首个模型请求）: 19.1s
热任务（prompt2 → 首个模型请求）: （见下方口径说明）
热任务（prompt2 → agent_settled）: 0.25s
```

**结论：`new_session` 真正隔离** —— 同一进程内，第二次任务的请求是干净的 `[system, user]`（2 条消息），
**不含任何第一次任务的痕迹**。池方案的核心假设**成立**，S2 可以启动。

**省下的成本就是那个 19.1s**：这是 pi 进程的纯启动开销（假 provider、无模型抖动、无网络），
也就是池**每次任务**替掉的部分。对照真实 provider 的端到端测量（28.5s 冷 → 10.4s 热，省 63%）：
两者的差主要是真实模型延迟，与启动开销无关。

**口径说明（方法论）**：上面"热任务 → 首个模型请求"那一行**我测错了**——我在 `prompt` 响应返回的
**同一 tick** 就去读 provider 已记录的最后一个请求，而此时新请求还没到，于是读到的是**上一次**的
时间戳（算出负数）。**该行数据作废，不作为结论**。可信的是两个端点值：冷启动 19.1s、
热任务整轮（prompt → `agent_settled`）0.25s。S2 要测"每个任务的平均墙钟"时，应当**在 provider 侧
按暗号归属请求**再计时，而不是取"最后一个请求"。

**S2 开工前的清单**（由本次结果收紧）：
1. 池大小 = 现有并发上限（`helpers.ts:184` 的 `limit`），每个 worker 独占一个进程（协议是单会话）；
2. 每任务前 `new_session`（本验证已证明其隔离性）；`context: 'fork'` 时改用 `new_session {parentSession}`；
3. 崩溃/协议错乱 → 重建该 worker，不让整个 `subagent` 调用失败；
4. `PI_SUBAGENT_POOL=off` 回退到今天的 spawn 路径；
5. 计时用"provider 侧按暗号归属"的口径，避免上面那种取错样本的错。
