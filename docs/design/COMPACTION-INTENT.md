# 压缩时的用户意图保留（两阶段压缩）

> 结论先行：DSH 的压缩**可以改**（`ctx.compaction` 是抽象服务，实现方拥有"触发/保留/摘要"三件事）。
> 当前 `compaction-basic` 只是把意图当作"摘要指令里的第一条要求"，**由模型执行、不是机器保证**。
> 我们按"先整合、再压缩"改成两阶段：用户输入走确定性通道，其余走模型摘要。

## 1. 现状（读代码得出）

| 事实 | 出处 |
|---|---|
| 选中区间 = 第一个非 system 节点 → 保留近期尾巴（`retainTokens` 预算）之前；**不拆工具调用/结果对** | `compaction-basic` `selectCompactableRange()` |
| **用户消息没有特殊待遇**：旧 user 消息照常被 shadow，整段进摘要输入 | 同上 |
| 摘要指令第一条就是 `## Primary Request and Intent`，并要求"quote verbatim where the exact wording matters" | `COMPACTION_INSTRUCTION` |
| 摘要有硬约束：必须比被压缩内容小（`framedSummary < shadowedRouteTokens`） | `compaction-basic` 提交前断言 |

⇒ 意图**被要求保留**，但没有**结构性保留**：换小模型/摘要被截断时，旧意图会走形。

## 2. 两阶段设计

```
阶段一（机器，0 次模型调用）
  从被 shadow 的区间里抽出全部 user 消息
  → 过滤掉"无信息量"的（继续 / 好的 / 嗯 / 重试 / 再试一次 这类纯推进语）
  → 重复意图折叠（同一意图多次追问 → 合并成一条，保留最新措辞）
  → 产出「意图账本」：逐字引用 + 首次/最近出现时间 + 未完成标记
  → 硬上限（默认 1000 tokens；超了按"未完成 > 最近 > 更早"优先保留）

阶段二（模型，只压工作历史）
  摘要输入 = 被 shadow 的 assistant/tool 内容（**不含 user**）
  摘要输出 = 现有结构化 checkpoint（Files / Errors / Pending / Current Work …）
  → 拼上「意图账本」为固定小节，标注"逐字、机器抽取、不可改写"
```

关键：**账本不经模型之手**；模型只压工作历史。这样"用户意图"的保真度是确定的，不依赖摘要模型的水平。

## 3. 用户原话保留策略（已定：方案 B）

- **逐字保留"有信息量"的用户消息**；纯推进语（继续/好的/嗯/重试…）过滤掉；
- 同一意图的重复追问**折叠**（保留最新措辞，记 recurrence）；
- 上限 **~1000 tokens**；超限时按「未完成 > 最近 > 更早」取舍；
- 账本内每条标注首次/最近出现，便于模型判断"这是新要求还是老要求"。

## 4. 落地顺序

| 步 | 内容 | 成本 |
|---|---|---|
| **①** | `retainTokens` 调大（近期逐字保留更多）+ **意图账本 append-only 注入**（复用已验证的注入通道） | ✅ **已完成**（见 §7） |
| **②** | 自定义 `CompactionEngine`：选择区间（可复用 basic 逻辑）→ 抽账本 → 只对工作历史做模型摘要 → 提交带账本的 checkpoint | 1–2 天 |

②失败可**一行回滚**：profile 里换回 `compaction-basic` 即可（实现是同一条接缝的两个后端）。

## 5. 验收断言（比"摘要看着不错"硬）

造 50 轮会话、每轮带一个不同意图，触发压缩后断言：

> **压缩后的 surface 里，每一个"有信息量"的用户意图都能逐字找到；纯推进语不要求保留。**

配套：
- 账本 token 不超上限；
- 摘要仍满足"比被压缩内容小"的硬约束（若账本过长，先压缩账本自身：去重 → 截断更早条目）。

## 7. 第①步已落地（2026-10-18）

- `assistant/memory/intent.ts`：`isFiller`（中英推进语）、`textOfContent`、`foldIntent`（jaccard>0.6 折叠、次数+1）、
  `recordIntent`（原子重写）、`renderIntentLedger`（逐字、预算内、从更早的丢起）。
- `entry.ts`：`session/event` 监听 `user/message`（跳过 `mypi-memory`/`mypi-intent`/`time-context` 三种自有来源），
  有信息量才记账本；`agent/pre-step` 第一步把账本作为**追加消息**注入（`source.kind='mypi-intent'`），
  与记忆注入共用"内容未变不追加"的去重键。
- 账本落点 `assistant/.run/intents/<sessionId>.jsonl`（会话级、gitignored）。
- 验证：`test/intent.mjs` —— 有信息量逐字进账本、`继续` 不进、重复意图折叠成一条（×N）、请求里带 `[mypi-intent]` 块。
  verify 扩到 **16 项全绿**。
- ✗ 未做：第②步（自定义 `CompactionEngine`）；`retainTokens` 的调大还没写进 profile（当前仍用默认值）。

## 6. 风险

1. **体积**：账本会挤占摘要预算 → 必须有上限与折叠（这也是"先整合再压缩"的原因）；
2. **判定"有信息量"**：过滤规则不能太激进（比如"继续"有时是"按当前方案继续"）；规则与用例要一起评审；
3. **多语言**：推进语的过滤要覆盖中英文常见形态；
4. **重放一致性**：账本是 checkpoint 的一部分，必须写进 session log（`compaction/start` 到 `compaction/end` 之间），确保 replay 结果一致。
