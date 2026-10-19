# 迁移清单：什么进仓库 / 什么做索引 / 什么只记来源

> 策略见 [`POLICIES.md`](POLICIES.md) §3；能力状态见 [`CAPABILITY-LEDGER.md`](design/CAPABILITY-LEDGER.md)。

## 1. 直接进仓库（代码/配置/测试/文档）

| 内容 | 位置 | 说明 |
|---|---|---|
| 插件与启动器 | `assistant/plugin/`、`assistant/host/` | 现行代码 |
| 记忆层 | `assistant/memory/` | store/检索/摘要/意图（含 127 条记忆数据） |
| 脚本与验收 | `assistant/scripts/`、`assistant/test/` | 含 `vendor-dsh.sh`、`build.sh`、`export-clean.sh`、`check-upstreams.mjs` |
| 设计与运维文档 | `docs/design/`、`docs/operations/`、`docs/*.md` | 含策略、账本、清单 |
| 决策历史 | `DECISIONS.md` | 仅历史，不参与构建 |

## 2. 做成索引（大块、按需）

| 内容 | 索引 | 说明 |
|---|---|---|
| `packs/`（18 包 / 147 技能 / ~10MB） | [`PACK-INDEX.md`](PACK-INDEX.md) + `PACK-INDEX.json` | **pi 专属内容不迁移**；其余按需从老仓库 `git archive` 取 |
| 旧会话（`portable/agent/sessions`，2.8MB） | 不迁移 | DSH 会话格式不同；要读历史需迁移器（pending） |
| 旧文档（`docs/` 中与旧项目强耦合的部分） | 只带 design/operations + 新写的根文档 | 其余留在老仓库 |

> 索引的重生成：`node assistant/scripts/gen-pack-index.mjs`

## 3. 只记来源（有明确上游）

| 内容 | 记录处 |
|---|---|
| DSH 运行时（`runtime/`，约 500MB） | [`UPSTREAMS.md`](UPSTREAMS.md) + `vendor-dsh.sh` 的 `DSH_VERSION` |
| 社区 TUI、pi-ai、pi-tui、SearXNG | 同上 |

## 4. 明确不迁移

| 内容 | 原因 |
|---|---|
| `link`（远程连接/配对） | 使用证据 0；需要时再处理（用户决定） |
| `custom/` 旧 feature 目录 | 只作参照；按需从老仓库查（见 `legacy/` 计划） |
| facade（`dsh/`，2441 行翻译层） | 已被 DSH 插件取代 |
| pi 专属或 pi 绑定的 skills | 新底座是 DSH，pi 绑定内容无意义 |

## 5. 检查清单（每次迁移跑一遍）

1. `node assistant/scripts/check-upstreams.mjs` —— 上游是否更新；
2. `node assistant/scripts/gen-pack-index.mjs` —— 索引是否过期；
3. `bash assistant/scripts/verify-m1.sh` —— 现行能力是否全绿；
4. `git status` —— 没有把 `runtime/`、`.run/`、`portable/agent/settings.json` 之类带进来。
