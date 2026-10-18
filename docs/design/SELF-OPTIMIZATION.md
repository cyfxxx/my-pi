# 自我优化系统：闭环地图与迁移契约

> **这是原项目最重要的独有功能**，迁移时按"先保闭环、再谈优化"的纪律做。
> 本文记录：闭环由哪几段组成、数据在哪、以及**哪些不变量绝不能破坏**。

## 1. 四条闭环（不是一条）

| 闭环 | 组成 | 数据落点 | 现状 |
|---|---|---|---|
| **记忆闭环** | 自动入库 → 三级去重合并 → 检索/注入（append-only）→ 生命周期治理 → 教训挖掘 | `memory/entries.json`、`summaries.json`、`interventions.jsonl`、`memory-search.jsonl` | **P1 已迁移**（见 §4），P2/P3 待做 |
| **知识与技能闭环** | 知识库（`docs/knowledge/`、`packs/`）→ `knowledge-fetch.py` / `knowledge-ingest.mjs` → 记忆条目；技能（`SKILL.md`）按需加载 | `docs/knowledge/`、`packs/`、记忆库 | 待迁移（P3） |
| **记录闭环** | 工具/子代理/上下文用量统计、任务记录、干预快照 | `portable/memory/stats/{tool-events.jsonl,tool-count-*.json}`、`subagent/usage.jsonl`、`context/usage.jsonl`、`task-records.jsonl` | 待迁移（P3） |
| **自动化闭环** | autopilot（调度/看门狗/种子）、每日知识摘要、定时治理 | `scheduler/tasks.json`、`daily-results/`、`knowledge/` | 待迁移（P3） |

四条的连接方式：**记录闭环**产出证据 → **记忆/知识闭环**把证据沉淀为条目 → **回忆闭环**在会话开始注入 → **自动化闭环**定期驱动前两者。
断掉任意一段，"自优化"就退化成"一个记事本"。

## 2. 迁移契约（不变量，改动前必须三思）

1. **schema 不换**：`entries.json` 保持原字段（`category/title/content/tags/confidence/source/recurrence/createdAt/updatedAt/accessedAt/environments/contentHash/links/deleted/supersededBy`）。
   换 schema = 历史 127 条与后续脚本同时失配。
2. **注入只追加**：只在**回合第一步**、内容变化时，把快照**追加**到请求消息末尾；绝不改 system prompt、绝不重排历史
   （证据：原项目改成"移除旧注入"后命中率掉到 61.1%，单次重算 150K–320K tokens）。
3. **写入先脱敏**：`scrubSecrets` 覆盖 GitHub/OpenAI/AWS/JWT/Bearer/PEM/通用键值等模式。
4. **环境可见性**：`environments` 含 `all` 或当前环境才注入；Termux 专用记忆不得出现在 Linux 会话里。
5. **三级去重**：标题同 → 更新；内容 hash 同 → 合并；近似（jaccard>0.7）→ 合并（保留更长内容）；
   合并时 confidence 取最大、recurrence+1、tags/environments 并集。
6. **数据进仓**：记忆库放在 `assistant/memory/`（**gitignore 例外**），随仓库便携；换机不丢。
7. **不做不可回退的自动删除**：淘汰/升格只出**候选报告**，写操作需显式执行。

## 3. 数据现状（迁移前实测）

| 项 | 量 |
|---|---|
| 记忆条目 | **128 条**（solutions 70 / reference 47 / fact 11） |
| 自动来源占比 | knowledge-fetch 48 + auto 44 + digest 5 = **97/128（76%）** |
| 复用证据 | `recurrence>1` 19 条 |
| 环境标记 | termux 3 / all 125 |
| 会话摘要 | 63 KB |
| 检索台账 | 6 条 |
| 干预记录 | 5 条 |

⚠️ 只看"工具调用次数"会得出"记忆没人用"的错误结论（`memory_store` 只有 2 次）——**记忆的引擎是脚本自动入库**，不产生工具调用。

## 4. P1（已完成）

- `assistant/memory/store.ts`：与原项目同 schema 的存储（原子写）、`scrubSecrets`、三级去重合并、环境可见性、自动互链、评分与**token 预算注入**。
- `assistant/scripts/import-memory.ts` + `assistant/dist/import-memory.mjs`：把 128 条迁到 `assistant/memory/entries.json`，
  **实测 128 → 127**（1 条被标题去重合并），类别/来源/环境/时间戳全部保留，39 条保留互链。
- 工具改为 `memory_store{category,title,content,tags,confidence,environment}` / `memory_search` / `memory_stats`。
- `test/memory-store.mjs`（schema/条数/字段完整性）与 `test/memory.mjs`（写入、每回合只注入一次、**首条 user 消息逐字不变**）都在 verify 里。

## 5. P2 / P3（待做）

- **P2（检索已完成）**：`assistant/memory/retrieval.ts` —— BM25（标题加权 ×2、k1=1.2、b=0.75）
  × 质量分（置信度 + 复现次数 + 30 天半衰期）→ MMR（λ=0.7）去重；环境过滤在候选阶段完成。
  断言：`test/retrieval.mjs` 五条（稀有词 idf、标题命中优先、近似重复不占前两位、高置信排前、termux 不外泄）。
  - **记录闭环（最小版）**：`assistant/plugin/stats.ts` —— 订阅 `tool/call` 与 `tool/result`，
    按 `callId` 配对成 `{ts,session,tool,durationMs,ok}` 写入 `.run/stats/tool-events.jsonl`；
    **只记名字/耗时/成败，不记参数与输出**（参数可能带密钥）。`test/stats.mjs` + verify 第⑮步。
  **仍未做**：会话摘要（`summaries.json` 63KB，需要摘要生成链）与"按会话轮转"（原项目按 session 分桶）。
- **P3（入库/治理/挖掘脚本已完成）**：
  - `assistant/scripts/memory-store.ts`（headless 入库，`--json/--file/stdin`、`--source`、`--dry-run`）；
  - `assistant/scripts/knowledge-ingest.ts`（知识订阅 md → 记忆条目，来源 `knowledge-fetch`，幂等）；
  - `assistant/scripts/memory-lifecycle.ts`（**只读**报告：淘汰/升格/垃圾/近似重复候选）；
  - `assistant/scripts/lesson-miner.ts`（干预快照 → 教训候选，`--ingest` 才写库）。
  四个脚本都走同一个 `storeEntry`（去重/脱敏/环境语义与插件完全一致）；`test/scripts.mjs` 四条断言覆盖
  "首写 created / 重写 updated / 知识入库幂等 / 生命周期可算 / 挖掘可入库"，verify 扩到 **15 项全绿**。
  - **记录闭环（最小版）**：`assistant/plugin/stats.ts` —— 订阅 `tool/call` 与 `tool/result`，
    按 `callId` 配对成 `{ts,session,tool,durationMs,ok}` 写入 `.run/stats/tool-events.jsonl`；
    **只记名字/耗时/成败，不记参数与输出**（参数可能带密钥）。`test/stats.mjs` + verify 第⑮步。
  **仍未做**：
  - 自动入库脚本：`knowledge-ingest`（95 行）+ `memory-store`（164 行）；
  - 治理：`memory-lifecycle`（83 行，只读候选报告）+ `lesson-miner`（121 行，读 `interventions.jsonl`）；
  - 记录闭环：子代理/上下文用量（工具用量已做）、按日聚合；
  - 自动化闭环：autopilot 的调度/看门狗/种子、每日子摘要。
- **明确不做**：`/memory` 命令（用户几乎不用）、`ctx_*`（实测 0–2 次）。
