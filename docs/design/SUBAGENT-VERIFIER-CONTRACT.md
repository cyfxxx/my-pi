# 编辑类子代理的 verifier 契约（P8）：提案

> 2026-10-08。对照 SoL-Pi 的 **D6 "Avoid generative edit delegates without a verifier contract"**。
>
> **本项只出提案，不改任何默认行为**（方案第 1 节的边界）。下面的 P8-A 属"新增测量"、可自行实施，
> 但本轮**只写方案**，实施与否由用户定。

## 一、现状（实现事实）

`subagent` 的子代理**可以自由写文件**：`SubagentToolParams`（`core/types.ts`）里没有任何验收条件相关字段
——参数只有 `agent / task / tasks / chain / agentScope / cwd / model / context / extensions`。
也就是说：派一个写类子代理出去，**父级拿到的是它的自述**，没有任何独立判据。

## 二、证据（实测，本项的关键：**风险尚未发生**）

真实会话（`portable/agent/sessions/**/*.jsonl`，4 个会话文件）里 `subagent` 的全部调用：

```
subagent 调用总数: 9
分布: {'context=spawn': 1, 'context=None': 8, 'tasks': 3}
agent: {'scout': 5}
```

- **agent 只用过 `scout`（只读定位）**，**从未派过 `worker` 类编辑代理**；
- `context` 8 次未指定（默认 spawn）、1 次显式 spawn；3 次用了并行 `tasks`。

再看遥测口径：`portable/memory/subagent/usage.jsonl` 的字段是

```
['agent','agentSource','cacheRead','cacheWrite','cost','exitCode','input','model','output','task','ts','turns']
```

⇒ **没有"改了哪些文件"字段**。所以现在**既没有"编辑代理被派出去"的事实，也没有能观测它的口径**。

**结论（决定了本提案的形态）**：D6 说的是"不要在没有 verifier 契约时派生成式编辑代理"——
而**我们这里连生成式编辑代理都还没派过**。此时做"强制 verifier"是**给一个尚未出现的风险加摩擦**，
属于凭想象做设计（P3 的教训：先测量，再决定）。

**好消息**：数据**已经在手边**。`SingleResult.messages`（`core/types.ts:23`）保存了子代理的**全部消息**，
其中包含它的 `toolCall` 块 ⇒ 提取"它调用了哪些写类工具"几乎是免费的。

## 三、提案

### P8-A（新增测量，可自行实施 —— 建议**先做这个**）

`usage-log.ts` 的 `buildUsageRecord` 增加一个字段：

```ts
/** 子代理调用过的写类工具名（去重；从 SingleResult.messages 的 toolCall 块提取） */
writeTools: string[];   // 例如 ['write','edit']；只读子代理为 []
```

有了它就能回答第一个问题：**"派出去的子代理到底改没改文件"**。
后续（第二步）再加**返工代理指标**：父级在子代理返回后的 N 轮内，是否又对**同一批文件**发生写操作
（可从父级自己的会话消息提取）。**两个指标合起来才是 D6 的证据**；没有它们，"要不要强制 verifier"只能靠感觉。

### P8-B（提案，需用户点头）：opt-in `verify` 契约

```
subagent { ..., verify: { command: "<只读验收命令>" } }
```

流程：
1. 把验收命令**写进子代理的任务说明**（"你的改动必须让 `<command>` 通过"）——让它知道自己会被怎么判；
2. 子代理返回后，**由 my-pi 在父级实际执行该命令**（直接复用 P1 已落地的
   `autopilot/store/run-check.ts` 的 `runCheckCommand`）；
3. 结果并入父级工具结果：`验收：已通过 \`<command>\`` 或 `验收：未通过（输出尾部…）`。

**关键设计（与 P1 同源的结构约束）**：判据由 **harness** 跑，**不采信子代理的自述**——
否则"我改完了，测试通过了"永远是一句无法证伪的话。这与 `goal complete` 的三态（declared/verified）是同一个模式。

**默认不变**：不传 `verify` 时行为与现在**完全一致**。

### P8-C（提案，需用户点头）：对写类子代理**提醒不阻塞**

若子代理**调用过写类工具**（P8-A 的数据）且本次**未提供 `verify`**，在返回文本里追加一句：
"该子代理改动了文件但没有验收条件；建议下次带上 `verify: {command}`，或在父级自行验证。"
——与 P4/P7 的一贯风格一致（**提醒，不阻塞**）。

### P8-D（提案）：**不推荐**默认强制 verifier

理由：① 我们的证据不支持（编辑代理从未被派过）；② 它会**改变委派语义**（从"能用就用"变成"没验收条件不能用"），
属于削减能力；③ 在没有 P8-A/B 数据前强制，只会让模型为了绕过限制而写一个假命令（`verify: {command: 'true'}`）——
**形式满足、实质失效**，比不做更糟。若将来 P8-A 显示编辑类子代理确实常用且返工率可观，再讨论强制。

## 四、风险与约束（若实施 P8-B）

| 风险 | 约束 |
|---|---|
| 验收命令有副作用 | 描述里明确要求**只读/幂等**；沿用 `runCheckCommand` 的 120s 上限与输出截断 |
| **cwd 错位**（在父级目录跑了子代理的验收） | 必须在**子代理的 cwd**（`step.cwd ?? cwd`）下执行，否则判据无效 |
| 并行 `tasks` 下成本 ×N | 每个子任务各跑一次；应在结果里标明是哪个子任务的验收 |
| "验收失败"被误读成"子代理失败" | 两者分开表述：子代理 `exitCode` 与验收结果各自独立显示 |
| 命令跑不起来（工具缺失/环境差异） | 与 P1 一致：按失败处理并把原因写清（不静默） |

## 五、本项的能力地板与交付性质

**纯文档，无代码行为变更。** 能力地板：`tsc` / `vitest` / `check-features`（文档链接）/
`check-conventions`（第 D 节）/ `check-dead-exports` / `golden`。

**建议顺序**：P8-A（测量，可自行实施）→ 看数据 → 再定 P8-B/C；**P8-D 不推荐**。
