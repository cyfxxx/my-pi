# 拼接分支现状：跑的是什么、离构想差多少、本地模型该怎么管上下文

> 记录时间：2026-10-18。分支 `feat/private-assistant`（基于合并后的 `4453d3965`，与回退后的 `main` 不同线）。
> 本文是**现状快照**，不是目标；目标与接缝规则见 [PRIVATE-ASSISTANT.md](PRIVATE-ASSISTANT.md)。

## 1. 现在实际跑的七层

| # | 层 | 是什么 | 归属 |
|---|---|---|---|
| 1 | 运行时 | 仓内 vendored DSH `0.2.0-rc.2`（289 包，`runtime/<平台>/ext/dsh`，gitignored） | 上游 |
| 2 | 启停 | `scripts/dsh-launch.sh` + profile `mypi-web` + `dsh/profile/my-pi.patch.yml` | **来自 DSH 那条线** |
| 3 | 旧适配层 | `my-pi` 插件：facade + 12 个 feature（54 工具 / 12 命令 / 18 钩子） | 待决策去留 |
| 4 | 新插件 | `assistant/plugin/entry.ts`（72 行，只注册 `mypi_note`，只依赖 `@deepseek-ai/dsh-tools`） | 新写 |
| 5 | 前端 | DSH React GUI（零改动）+ `assistant/src/tui.mjs`（183 行，pi-tui 渲染） | 上游 + 新写 |
| 6 | 模型 | `dsh-llm-deepseek`（在线）+ `dsh-llm-pi-ai`（本地/任意 OpenAI 兼容端点） | 上游 |
| 7 | 客户端传输 | `assistant/src/transport.mjs`（126 行：`?token=`→cookie、`POST /api/<ep> {args:{…}}`、`WS /api/remote.mux`） | 新写 |

**必须直说的一点**：第 3 层还在。`mypi.sh` 借的是 `scripts/dsh-launch.sh`，而它默认挂 `my-pi.patch.yml`
⇒ 终端里绝大多数工具来自旧的 facade 适配层，不是新插件。**所以现在是"新前端 + 旧适配层"，
不是干净拼接。** 另外第 2 层来自已回退的 DSH 线，分支目前**依附**于 `archive/dsh-on-main`。

## 2. 对照最初的构想

| 构想 | 现状 | 判断与原因 |
|---|---|---|
| DSH 插件系统 | 脊柱：会话/工具/权限/持久化/压缩都在宿主，两端共享一份 | ✅ 成立；这是唯一不可让的部分（两份会话日志 = 两个事实源） |
| DSH Web UI | `dsh web` 直接用，一行没改 | ✅ 成立；品牌仍 `DeepSeek Harness`（`dsh-brand` 接缝，未做） |
| pi 的分层架构 | **没采用**；用的是 pi 的**包**（`pi-ai`、`pi-tui`），不是分层方式 | ⚠️ DSH 的 cordis 本身就是分层（服务注册 + `inject` + fiber）；再叠一层 features/adapters 是**两套权限模型**，出问题恰在两套规则的缝上；且这套分层是 my-pi 自创，不是 pi 上游的 |
| pi 的 TUI | 用 `pi-tui`（纯渲染库，依赖只有 `marked` + `get-east-asian-width`） | ⚠️ 渲染层可拿；pi 的 **TUI 应用**绑定 pi 自己的会话/扩展模型，拿过来等于拉进第二个 agent loop |
| opencode 的 TUI | 未接 | ❌ 它是 **opencode server 协议的客户端**（server + protocol + client + tui），数据层与 DSH 不同；接它要重写数据层，比用 `pi-tui` 自写更贵。干净用法是**外部 agent**（ACP/MCP），但那样它看它自己的会话，不共享 |

## 3. 待解决的问题（按代价排序）

1. **旧适配层去留**（最大）：留 facade ⇒ 54 工具里大半是"把 pi 能力翻译到 DSH"＝继续修修补补；
   砍 ⇒ 12 个 feature 要么重写成 DSH 插件，要么放弃。二选一，没有中间态。
2. **启动脚本归属**：把 ~100 行宿主启动从 `scripts/dsh-launch.sh` 搬进 `assistant/`，
   让分支**自包含**，不再依附已回退的线。
3. **工具呈现**：工具只注册一次，但"怎么画"每个前端各写一遍。应以 `output.render` / `presentationMeta`
   定义一份共享呈现，而不是 TUI / Web 各画各的。
4. **会话格式**：DSH 的 append-only 日志 vs pi 的 JSONL。要"两套界面读同一份历史"，只能是 DSH 格式，
   pi 历史需要迁移器。
5. **便携体积**：DSH 289 包 ≈ 523 MB；组合越多包越沉。

## 4. 本地模型：上下文管理不是放宽，是**必须换一套预算**

直觉是"本地不花钱 ⇒ 上下文可以给更多"。钱确实为 0，但**默认参数在本地会直接让压缩失效**。

### 4.1 默认策略在小窗口上根本不触发（不是更频繁，是失效）

`dsh-compaction-basic` 在 `dsh-base` 里**没有配置**，取默认值：

```
headroomTokens = 65536     // 默认
maxTokens      = 65536     // 默认，同时也是摘要请求的输出上限
pressureBudget = (contextWindow − 预留输出 tokens) − headroomTokens
if (pressureBudget <= 0) throw TargetPressureConfigError(...)
```

- 8K 窗口、预留 2K 输出 ⇒ `6144 − 65536 < 0` ⇒ 抛错；
- 抛错在 `agent/pre-step` 被 `catch`，**每个目标只 warn 一次**，然后继续本轮、之后也不压
  ⇒ 直到撑爆窗口报 `CONTEXT_WINDOW_EXCEEDED`；
- 32K 窗口同样为负（30K − 65536）⇒ **只有窗口约 70K 以上的模型才受默认策略保护**。
  Ollama 上常见的 8K/32K 模型全在保护之外。

### 4.2 成本从"钱"变成"延迟 / 显存 / 吞吐"

- prefill 时间随上下文长度近似线性增长 ⇒ 长上下文 = 首字慢；
- KV cache 占显存 ⇒ 并发下降；
- 本地后端的 **prefix cache**（vLLM / llama.cpp / Ollama）比云端更关键：DSH 的 summarizer
  特意复用"上次请求的 system prompt + tools + 前导消息"以命中暖前缀；一旦改 system prompt、
  工具顺序或裁剪历史，整段重算，延迟立刻涨。
  ⇒ 本地原则：**稳定前缀、少改写历史、优先无损手段**（裁剪工具结果 / 大输出落盘）。

### 4.3 摘要质量：可跨模型压缩

`compaction-basic` 支持 `summarizationProvider` / `summarizationModel`（默认 = 跟随会话模型：
`configured ?? 最近一次路由 ?? agent options`）。小模型写摘要会越压越糊 ⇒ 建议**对话用本地、压缩用在线**。

### 4.4 成本核算的静默坑

`dsh-token-meter` 对无价格路线算 `cost = 0` ⇒ 任何"以花费为阈值"的策略在本地**静默失效**。
本地档位必须按 **tokens / 窗口比例** 配。

### 4.5 该改的旋钮（都是现成配置，不用写代码）

| 旋钮 | 包 | 默认 | 本地建议 |
|---|---|---|---|
| `modelPolicies[]`（provider/model 精确匹配） | compaction-basic | 无 | **必须给本地路由一条** |
| `headroomTokens` | 同上 | **65536** | 窗口的 ~10%（如 2048） |
| `thresholdRatio` | 同上 | 0.8 | 0.55–0.6（小模型长上下文退化更早） |
| `retainTokens` | 同上 | 按 0.16 比例 | 显式给（如 1500） |
| `maxTokens` | 同上 | **65536** | 降到模型输出上限（如 2048） |
| `summarizationProvider/Model` | 同上 | 跟随会话 | 指回在线模型 |
| `thresholdChars/headChars/tailChars` | tool-result-pruner | 8192/4096/1024（base 已配） | 本地可再收紧 |
| `maxInlineTokens` | spill-policy | 12500（base 已配） | 本地下调，大输出落盘 |

样例（放本地 profile patch）：

```yaml
- id: compaction-basic
  config:
    thresholdRatio: 0.6
    modelPolicies:
      - provider: local
        model: qwen2.5-7b              # 换成实际模型 id
        thresholdRatio: 0.55
        headroomTokens: 2048
        retainTokens: 1500
        maxTokens: 2048
        summarizationProvider: deepseek-official
        summarizationModel: deepseek-flash
```

### 4.6 可验证的判据

用 mock 端点把窗口设 8K、连续灌满：**修前**应看到一次
`compaction-basic: local/<model> reserves … headroom tokens … leaving no pressure budget` 的 warn，
且永不压缩；**修后**应看到 `compaction (pressure): shadowed …` 日志，且会话能越过 8K 继续多轮。

## 5. 下一步（待用户决定）

1. 旧适配层：保留（渐进）还是砍掉重写（干净）——决定后续全部工作量。
2. 把宿主启动搬进 `assistant/`，让分支自包含。
3. 落一份本地档位配置，并用 4.6 的判据验证。
