# 能力账本（迁移与删减的唯一事实源）

> 规则：**每行一个能力**；状态只能是 `keep`（自建保留）/ `adapt`（换 DSH 原生或改造）/ `drop`（删）/ `pending`（待定）。
> 每个 `drop` 必须先有"删除前断言"；每个 `adapt` 必须有"迁移映射"；每个 `keep` 必须有"验收断言"。
> 判据见 [`MIGRATION-STRATEGY.md`](MIGRATION-STRATEGY.md) §3（使用证据 / 替代覆盖 / 数据负担 / 维护成本）。

## 1. 旧项目 12 个 feature

| 能力 | 旧实现规模 | 使用证据（32 会话/1512 次） | DSH 原生 | 我们的现行实现 | 数据归属 | 状态 | 断言 |
|---|---|---|---|---|---|---|---|
| memory | 3.6k 行 | `memory_store` 2、`memory_search` 6 | 无 | ✅ `assistant/memory/*`（store/检索/摘要/意图） | `assistant/memory/entries.json`（127 条） | **keep** | `test/memory*.mjs`、verify ⑭⑯⑰ |
| tmux | 2.0k 行 | `tmux_run` 8、`tmux_read` 7 | 只读 `tmux-context` | ✅ 5 工具（`mypi-` 前缀） | 无（运行时） | **keep** | `test/tmux.mjs`、verify ⑩ |
| web-search | 1.0k 行 | 0（窗口内） | ✅ 原生（DeepSeek）+ 接缝 | ✅ SearXNG provider | 无 | **keep** | `test/web-search.mjs`、verify ⑨ |
| subagent | 4.2k 行 | `subagent` 11 | ✅ `dsh-tool-subagent` | — | 旧：`portable/memory/subagent/usage.jsonl` | **adapt** | 用原生；旧 usage 数据冻结 |
| plan-mode | 2.2k 行 | `plan_exit` 17 | ✅ `dsh-plan-mode` | — | 旧：`portable/memory/plans/` | **adapt** | 用原生；旧 plans 数据迁移器待写 |
| mode | 3.4k 行 | 0 | ✅ agent preset | 部分（`local` preset） | 旧：`portable/agent/modes/`、`modes.json` | **adapt** | 见 `MODE-COMPARISON.md`；缺 `minimal`/`roleplay` preset |
| context | 10.1k 行 | 0（指标类） | ✅ token-meter / compaction | 部分（瘦身 preset） | 旧：`portable/memory/context/usage.jsonl` | **adapt** | 压缩两阶段②未做 |
| autopilot | 9.8k 行 | 仅 `admin_restart` 6 | ✅ schedule + goal | 部分（`maintain.sh`） | 旧：`portable/memory/scheduler/` | **adapt** | 见 `AUTOMATION-OVERLAP.md`；failover/看门狗/验证器未做 |
| voice | 3.7k 行 | 0 | ✅ voice-input bundle（SenseVoice） | — | 旧：`portable/memory/voice?`（无独立目录） | **drop** | 需要时 `MYPI_VOICE=1` 挂 bundle |
| browser | 1.3k 行 | 0 | ❌（只有 UI 侧栏） | — | 旧：`portable/memory/tool-outputs/`（浏览器产物） | **pending** | 真要用时自建（Playwright 工具） |
| link | 2.0k 行 | 0 | 部分（`/api/remote.mux` 协议） | 我们的 transport 用到 mux | 旧：`portable/memory/`（scattered） | **pending** | 先确认链路场景（手机配对？） |
| intervention | 0.8k 行 | 0 | 部分（`dsh-message-feedback`） | 部分（教训挖掘读旧数据） | 旧：`portable/memory/interventions.jsonl`（5 条） | **adapt** | `scripts/lesson-miner.ts` 已读 |

## 2. 旧项目非 feature 资产

| 资产 | 规模 | 处理 | 状态 |
|---|---|---|---|
| facade（`dsh/`，pi→DSH 翻译层） | 2441 行 | 不迁移；只作历史参照 | **drop**（已从默认组合移除） |
| `custom/core/`（适配器/原子写/密钥清洗等） | 见 `custom/` 3 MB | 密钥清洗已重写进 `memory/store.ts`；其余不迁 | **drop**（按需搬） |
| `scripts/`（旧项目 91 个脚本） | 1.1 MB | 只保留 `dsh-runtime.sh`/`lib-portable.sh` 的等价物（已重写为 `assistant/scripts/vendor-dsh.sh`） | **drop** |
| `packs/`（技能包） | 12 MB | 需要技能时按需挑；不整体迁 | **pending** |
| `docs/`（旧文档） | 2.1 MB | 只带 design/operations 与相关部分 | **adapt** |
| `portable/agent/sessions`（历史会话） | 2.8 MB | DSH 会话格式不同；要"可读历史"需迁移器 | **pending** |
| `portable/memory/*`（记忆/摘要/台账） | 5 MB | 记忆已迁；摘要/台账/干预按需 | **adapt**（部分已做） |

## 3. DSH 侧"默认关闭、按需开启"的项

| 项 | 开关 | 状态 |
|---|---|---|
| schedule（定时任务） | `MYPI_SCHEDULE=1` | **keep（可选）** |
| voice-input bundle | 未接 | **pending** |
| 账号登录 | 默认关闭（`no-login.patch.yml`） | **drop（确认不需要）** |
| 品牌（M0.6） | 未做 | **pending** |
| 体积裁剪（M0.5） | 未做 | **pending** |

## 4. 账本纪律

1. 新增能力 = 新增一行 + 断言，不许"只加代码不记账"；
2. 删除前必须先把该行改成 `drop` 并**写清删除前断言**，再删；
3. `pending` 不允许长期挂账：每个里程碑结束时必须收敛（keep/adapt/drop）；
4. 每行都要能回答："如果它坏了，哪条命令会红？"
