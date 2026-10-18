# 拼接分支现状：跑的是什么、已完成到哪、离构想差多少

> 记录时间：2026-10-18（深夜快照）。分支 `feat/private-assistant`，自包含（依赖 `archive/dsh-on-main` 的只有历史提交）。
> 目标是 [ASSISTANT-PLAN.md](ASSISTANT-PLAN.md)，接缝规则见 [PRIVATE-ASSISTANT.md](PRIVATE-ASSISTANT.md)，
> 自我优化闭环见 [SELF-OPTIMIZATION.md](SELF-OPTIMIZATION.md)，压缩改造见 [COMPACTION-INTENT.md](COMPACTION-INTENT.md)。

## 1. 现在实际跑的六层

| # | 层 | 是什么 | 归属 |
|---|---|---|---|
| 1 | 运行时 | 仓内 vendored DSH `0.2.0-rc.2`（289 包，`runtime/<平台>/ext/dsh`，gitignored） | 上游 |
| 2 | 启停 | `assistant/host/launch.mjs`（自包含：建 profile、拼 patch、起停、抓 URL） | 本仓 |
| 3 | 插件 | `assistant/plugin/`：`mypi_note` + tmux×5 + memory×3 + SearXNG provider + 意图账本/摘要/用量钩子（≈1.2k 行，只依赖 `dsh-tools`/`dsh-llm`） | 本仓 |
| 4 | 记忆 | `assistant/memory/`：store（同原项目 schema）+ retrieval（BM25/质量/MMR）+ intent + summaries + 四个 headless 脚本 | 本仓 |
| 5 | 前端 | DSH Web（零改动）／社区 TUI `@deepseek-harness-tui/dsh-tui`（可装、可回退）／`mypi.sh tui` 自带 pi-tui 客户端（回退） | 上游 + 本仓 |
| 6 | 模型 | `dsh-llm-deepseek`（在线）+ `dsh-llm-pi-ai`（本地/OpenAI 兼容） | 上游 |

**已不再有 facade**：`--with-facade` 只剩对照用途；默认组合 27 工具（+我们新加的 8 个 = 35），verify 第⑦步断言之。

## 2. 已完成（都有断言）

| 里程碑 | 内容 | 断言 |
|---|---|---|
| M0 断奶 | 自包含启动器 + 无 facade | ①–⑧ |
| M0.1 便携 | 单目录运行、profile 由模板生成、凭据复制 | ②③ |
| 网络搜索 | SearXNG 挂进 `ctx.web`（官方无需额外 API，但一次搜索=一轮模型） | ⑨ |
| tmux | 5 工具、`mypi-` 前缀保护 | ⑩ |
| 记忆 P1 | 同 schema + 迁移 128→127 条 + 三级去重/脱敏/环境/预算注入 | ⑬⑭ |
| 记忆 P2 | BM25×质量分 → MMR → 来源轮转；确定性会话摘要 | ⑪⑰ |
| 记忆 P3 | headless 入库/知识订阅/生命周期报告/教训挖掘 + 定时维护脚本 | ⑫ |
| 压缩① | 意图账本（逐字、过滤推进语、折叠、预算内 append-only） | ⑯ |
| 记录闭环 | 工具用量（名字/耗时/成败，不记参数） | ⑮ |
| M1 TUI | 社区 TUI 在 DSH 0.2.0-rc.2 上真跑通 + 共享 DSH_HOME 接入 | ⑱（可 SKIP） |
| M2 探针 | Termux/陌生环境一条命令自检（本机实测：PRoot+glibc 可跑） | 手动 |

## 3. 怎么跑

```bash
assistant/scripts/mypi.sh web            # 起宿主并给带 token 的 URL（数据在 assistant/.run/home）
assistant/scripts/mypi.sh tui            # 优先社区 TUI；MYPI_TUI=builtin 回退到 pi-tui 客户端
assistant/scripts/setup-tui.sh           # 安装社区 TUI 并把本仓插件挂进它的 profile
assistant/scripts/verify-m1.sh           # 19 项验收（约 6–8 分钟）
assistant/scripts/maintain.sh [--ingest] # 定时维护：生命周期报告 + 教训挖掘 + 摘要修剪
bash assistant/scripts/probe-termux.sh   # 陌生环境探针
```

## 4. 已知缺口（按代价）

1. **压缩第②步**（自定义 `CompactionEngine`）：接口已查清（`compactIfNeeded/compactNow/compactRegion` 三个抽象方法），
   但要自己实现"选区间 → 抽账本 → 只压工作历史 → 提交 checkpoint"，约 400–600 行；当前只有第①步（账本注入）。
2. **autopilot 自动化**：只剩本地 cron 式维护（`maintain.sh`），没有原项目的看门狗/种子/会话重启。
3. **摘要精炼**：现在是确定性摘要，`decisions/facts/prefs/lessons` 留空，未接 LLM 精炼。
4. **品牌（M0.6）与体积（M0.5）**：按你的决定暂缓。
5. **TUI 功能面差异**：社区 TUI 能跑，但"哪些面板在 TUI 里可用/不可用"还没盘点。

## 5. 合并就绪判断

- 主验收 **19 项全绿**（`verify-m1.sh`），黄金任务与约定守门均通过；
- 分支**自包含**：起停、插件、记忆、脚本、文档都在 `assistant/` 与 `docs/`，不再依赖已回退的 DSH 线；
- 数据**进仓**：记忆库 `assistant/memory/entries.json`（127 条）、摘要与用量在 `.run/`（gitignored）；
- 合入 `main` 前只剩"人决定"的事：是否要压缩②、autopilot、品牌/体积。

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
