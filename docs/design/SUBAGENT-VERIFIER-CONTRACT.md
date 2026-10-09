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

### P8-A ✅ **已完成（2026-10-08，提交 `69c56f4f4`）**

`usage-log.ts` 的 `buildUsageRecord` 已增加字段：

```ts
/** 子代理调用过的**文件编辑类**工具名（去重、保序；只读子代理为 []） */
writeTools: string[];   // 例如 ['write','edit']；只读子代理为 []
```

**口径边界（重要，别当它是"改没改文件"的完备判据）**：
- 只认**以编辑文件为主要目的**的工具：`write` / `edit` / `edit_and_run`；
- **故意不含 `bash` / `ctx_exec` / `tmux_*`**——它们是 catch-all，含进来会让字段**恒为非空**
  （几乎每个子代理都会跑一条命令），信息量归零；
- 因此它是"**用过文件编辑工具**"的**下界**。测试里有一条**反向断言**（`WRITE_TOOLS` 里出现
  `bash`/`ctx_exec`/`tmux_*`/`read`/`grep` 即失败），防止将来有人"顺手补全"把字段废掉。

**当前样本状态（2026-10-08 实测）**：`usage.jsonl` 共 **10 条记录，带 `writeTools` 的 0 条**
——字段落地前写的记录没有该字段，所以**要等下一次真实子代理派发才第一次有值**。
这与"真实子代理使用共 9 次、agent 只用过 `scout`（只读）、从未派过编辑代理"是一致的：
**问题还没发生，指标先就位。**

**可直接运行的查询（三个都实测过）**：

```bash
# ① 有多少条记录带 writeTools（字段落地后才会有值）
python3 -c "import json;rs=[json.loads(l) for l in open('portable/memory/subagent/usage.jsonl',encoding='utf-8') if l.strip()];print(sum(1 for r in rs if r.get('writeTools')),'/',len(rs))"

# ② 按 agent 汇总：哪些子代理动过文件
python3 -c "import json,collections;rs=[json.loads(l) for l in open('portable/memory/subagent/usage.jsonl',encoding='utf-8') if l.strip()];print(dict(collections.Counter(r.get('agent','?') for r in rs if r.get('writeTools'))) or '（无）')"

# ③ 只读 vs 编辑 的比例
python3 -c "import json;rs=[json.loads(l) for l in open('portable/memory/subagent/usage.jsonl',encoding='utf-8') if l.strip()];ed=[r for r in rs if r.get('writeTools')];print(f'编辑类 {len(ed)} / 全部 {len(rs)}')"
```

### P8-A 第二步 ✅ **已完成（2026-10-08）**：返工代理指标

**回答的问题**：派出去的子代理改过文件之后，**父级是否在随后的 N 个回合内又改回同一个文件**
——这才是"改动质量"的代理信号（P8-A 只回答"用没用编辑工具"）。

**落点**：`scripts/daily-health.mjs` 新增持续字段 **`子代理返工=<返工数>/<有改动的子代理数>(<比例>)`**，
无样本时记 **`n/a`**（不假装 0%）。

**口径（五条，写进实现注释并由合成夹具钉住）**：
1. 只统计 **`writePaths` 非空**的子代理——有改动才有"返工"可言（只读子代理不进分母）；
2. 窗口按**父级助手回合数**（默认 **5**，`PI_HEALTH_REWORK_TURNS` 可调）而**非时间**——
   回合更贴近"这次委派是否被立刻返工"；
3. "又改同一文件" = **至少一个路径相同**（同时统计匹配数，便于按更严口径重算）；
4. 只认**写类工具**（与 `usage-log.ts` 的 `WRITE_TOOLS` 同口径，`bash` 等 catch-all 不算）；
5. **精确归属**：`usage.jsonl` 记录带 `parentSession`（来源 `ctx.sessionFile`；池化 worker 自己是
   `--no-session`，所以它记的是「谁派了它」）⇒ 只在**那一个会话**里找返工窗口；
   旧记录缺该字段时退回启发式「父级必须先于子代理存在」。

   **这条把原先的残余误归属风险消掉了**（原风险：另一个并发会话改了同一文件会被误算成返工）。
   守门里有专门的回归测试：夹具放**两个会话**，只有**别的会话**改了同一文件时必须算出 `0/1(0.0%)`；
   另有一条测旧记录的启发式回退。

**守门**：`scripts/test-usage-metrics.mjs` 新增 2 项（58 → **60 项**），其中一项专门钉住边界
**"父级在第 6 个回合才改同一文件 ⇒ 不算返工"**，另一项钉住"无样本记 n/a"。

**真实数据（2026-10-08 实测）**：`usage.jsonl` 里带 `writePaths` 的记录 **0 条** ⇒
字段输出 **`子代理返工=n/a`**。这与"真实 subagent 共 9 次、agent 只用过 `scout`（只读）、
从未派过编辑代理"一致：**指标已就绪，样本待积累**（不编数字）。

**实现形态的一处偏离（记录理由）**：原计划写一个 TS 纯函数 `computeRework`，
但 `daily-health.mjs` 是 ESM 脚本、**无法 import TS 模块**（my-pi 的 TS 由 pi 在运行时加载）。
若把纯函数放 TS 而无人调用，它会变成**死导出**。故按本仓库既有模式（P2 的 `compact-payback` 同理）：
**口径逻辑落在 daily-health 的 JS 里，用合成夹具钉住**——被测的是同一条真实路径，而不是一个影子实现。

**由此对 P8-B / P8-C 的建议（基于数据，不擅自改默认）**：
- **B（opt-in `verify`）与 C（写类子代理缺验收条件时提醒）暂不做。** 依据：编辑类子代理**一次都没派过**，
  返工率无从谈起；此时实现它们是为**未被走到的路径**写代码，属于凭想象做设计（与 P4 审计的同一标准）。
- **若将来要做，C 比 B 便宜得多**（C 只消费已就绪的 `writeTools`，不需要任何新通道；B 要处理 cwd 错位、
  并行 `tasks` 成本 ×N、"验收失败 ≠ 子代理失败"等已列表的约束）。
- **触发条件写下来**：当 `子代理返工` 显示**有改动的子代理 ≥ 10 个**、且返工比例**明显偏高**时，
  再回到 B/C；否则维持现状。
- **P8-D（默认强制）继续不推荐**（会改变委派语义 + 诱使 `verify:{command:'true'}` 这类形式满足）。

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

## 附：加 `parentSession` 时暴露的一个真实缺陷与新的守门（2026-10-08）

**缺陷**：给 `runSubprocessAgent` 加 `parentSession` 时 `tsc` 报错，顺带暴露出**上一批（S4）留下的问题**——
`runSubprocessAgent` 里对 `runPooledAgent(...)` 的调用**根本没传 `allowExtensions`**
⇒ **池化路径（默认开启）会静默忽略 `extensions` 选项**：spawn 路径正常、池化路径失效。
而当时那些"测函数本身"的单元测试（`buildPooledSpawnArgs` / `pooledProfileKey`）**结构上测不到这条接线**。

**为什么编译器挡不住**：`allowExtensions` 与 `parentSession` 都是**可选参数**——漏传不报错、只是取值
`undefined`。所以这类缺陷**编译通过、测试全绿、运行时静默降级**。

**处置**：① 修调用处（`allowExtensions` + `parentSession` 都传）；② 新增**源码级守门**
`subagent/__tests__/wiring-args.test.ts`（3 项）：断言 `runPooledAgent` / 每个 `runSubprocessAgent`
调用处都带这两个参数、且两条路径在落用量记录前都写了 `currentResult.parentSession`。
③ **守门自证**：临时拿掉 `allowExtensions` 后守门**必须变红**（实测确实红了，且消息直指"漏传"），
恢复后转绿——并且**在同一坏状态下 `tsc` 不报错**，印证了"可选参数漏传编译器看不见"。

## 附二：`goal complete` 的第二校验来源已实现（2026-10-08，用户指定）

用户明确"我说的是关于 `verify_*` 的那个"，即把 LLM 评审接成 `goal` 的**第二校验来源**。

**先纠正一处我自己的说法**：我曾在 P3 审计里写"`verify_*` 那 5 个导出缺的那一半**正好是** `goal` 缺的
第二来源"——**核实后不成立**：那套的形状是 **Best-of-N 候选打分**（`bestIndex`/`scores[]`/`nCandidates`/
`selectedIndex`/`baselineCost`），回答"N 个候选里哪个最好"；而 `goal` 要的是"**目标是否真的达成**"的
**二元判定 + 理由**。故**不复用**那套，另写提示词与解析器；5 条白名单理由也据此更正为"形状不匹配"。

**通道（关键发现）**：pi **不给**扩展暴露调用模型的 API（`ExtensionContext` 只有 `sendMessage`（投递、
不同步返回）、`setModel`/`getModel`/`getThinkingLevel`、`executeTool`）。故评审走
**`ctx.executeTool('subagent', ...)`** 起一个**独立上下文**的评审子代理——顺带得到更强的一点：
**评审看不到本会话的自我叙述**。

**实现**：`run/goal-verdict.ts`（提示词 + 确定性解析 + `runGoalJudge` 通道封装，全部纯逻辑可测）+
`store/goal.ts` 新增 `judgeVerifiedCompletion`（与 `verifiedCompletion` **并列的独立入口**，
所以"模型自封 verified"依然结构上不可能）+ `goal` 工具新增 opt-in `verify` 参数。

**硬约束（都有测试）**：`verify` 是 **opt-in**，不传时行为与以前**逐字节一致**；评审判定为达成 ⇒
`verified` 且**标明来源是评审**（不冒充命令校验）；未通过/认不出/调用失败/超时/格式不符 **一律
fail-open 退回 `declared`**（把基础故障说成"未达成"是错的）；确定性 `check` **优先级更高**。
**通道接线**另有源码级守门（`tsc` 看不见这类"可选通道没接上"）。
