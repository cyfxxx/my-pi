# scripts — 运维脚本

仓库内所有可执行运维脚本（**不得建子目录**，`check-isolation` 检查 8）。定位为「构建 / 守门 / 运维 / 自愈」四类。

## 构建与引导

| 脚本 | 用途 |
|------|------|
| `build.sh` | 一键重建/引导：Node 检查 → 根依赖 `npm ci`（不改 lock）→ vendor 引导与补丁幂等提交 → 工作区按依赖顺序构建（模型数据缺失时联网生成）→ 可选 fd-rg shim / 自愈缓存 |
| `dev.sh` | 开发模式运行源码（优先 vendor 内置 tsx） |
| `sync-upstream.sh` | 上游同步 + 自动修复：临时 worktree 确定性重建补丁栈 → 重建 dist → 刷自愈缓存 → 类型检查（`PI_SYNC_DRY_RUN=1` 只读预演） |
| `lib-vendor.sh` | 被 build/sync/doctor source 的共享逻辑（补丁幂等应用、依赖一致性、vendor exclude） |
| `pi-source-build.sh` | 构建 vendor/pi 并把 dist 缓存为「好 pi」（崩溃自愈用）；`--no-build` 仅缓存现有 dist |
| `run-ts.sh` | 以 vendor tsx 运行「需加载 my-pi TypeScript 逻辑」的脚本（`custom/` 用无扩展名导入，Node 裸跑解析不了）；headless 写记忆/入库的统一入口 |

## 体检与守门

| 脚本 | 用途 |
|------|------|
| `doctor.sh` | 本地环境 vs 仓库体检（依赖/vendor/补丁/dist 新鲜度/自愈缓存/shim/外部工具/类型/本地 vs origin/vendor 离线归档）；`--fix` 自动修复，`--full`/`--no-net` |
| `check-isolation.sh` | 隔离边界（symlink、禁用目录、逻辑层 Pi 依赖、vendor 干净等 9 项） |
| `check-features.sh` | 功能完整性（12 feature 目录 + 生成式注册面基线 + 适配器 API + 钩子事件 + 配置/脚本/补丁） |
| `gen-registrations.mjs` | 从代码生成/校验注册面基线 `registration-baseline.json`（`--update` 刷新）；替代手写清单防漂移 |
| `check-dead-exports.mjs` | 死导出守门（抓"写了没接线"；白名单 `dead-exports-allowlist.txt`） |
| `check-patches-behavior.mjs` | 补丁行为存在性守门（断言关键符号/自标记仍在 vendor 源码，防上游同步语义漂移） |
| `check-injection-surface.sh` | system prompt 注入面前缀指纹基线守门（`--update` 更新基线） |
| `check-doc-links.mjs` | 文档内部相对链接一致性 |
| `check-seeds-headless.mjs` | 定时任务提示词 headless 可用性守门（不得引用 `--no-extensions` 下不存在的扩展工具/斜杠命令） |
| `golden-tasks.sh` | 行为防退化基准（隔离/注册面/死导出/类型/单测/补丁/补丁行为/注入面/文档/supervisor/定时任务提示词；`--fast` 跳过 tsc+vitest，`--smoke` 追加无头冒烟） |
| `patch-playwright-core.mjs` | Termux 下把 playwright-core 的 linux 分支扩展至 android（幂等） |
| `install-hooks.sh` | 启用 `.githooks/`（pre-commit → `golden --fast`，pre-push → 全量）；本地无 CI，钩子是唯一自动防线 |
| `vendor-bundle.sh` | vendor/pi 离线归档（`create`/`restore`/`status`）；bundle 不入库 |

## 对外服务

| 脚本 | 用途 |
|------|------|
| `setup-external.sh` | 可选外部服务/依赖（tmux / SearXNG 原生或容器 / whisper 指引 / fd-rg shim） |
| `searxng-config.sh` | 生成 SearXNG `settings.yml`（禁用不可达引擎、bing 指向 cn.bing.com；`--force/--probe`） |

## 运行期自愈与运维

| 脚本 | 用途 |
|------|------|
| `pi-supervisor.sh` | 崩溃自愈外壳（分类/修复者 pi/健康检查/熔断）；`MY_PI_NO_SUPERVISOR=1` 直启 |
| `test-supervisor.sh` | supervisor 纯函数行为测试（崩溃分类 / admin state 解析；库模式 source，无需网络/provider） |
| `memory-store.mjs` | 记忆入库（零 LLM，直调 memory 逻辑层 `storeEntry`，内置标题去重）；`--json`/`--file`/stdin，`--dry-run` |
| `memory-lifecycle.mjs` | 记忆生命周期只读报告（零 LLM，调 `analyzeLifecycle`：淘汰/升格/冲突/垃圾/聚合候选）；`--json`/`--limit`；headless 下替代 `/memory lifecycle` |
| `reseed-seeds.mjs` | 把 `scheduled-seeds.json` 的定义显式应用到已存在的同名任务（种子对账只补缺失不覆盖；改提示词后用它；保留 id/enabled/lastRun/runCount/history，默认预演，`--apply` 先备份） |
| `daily-health.mjs` | 每日健康检查（命中率/记忆库/种子失配/守门脏改） |
| `knowledge-fetch.py` | 知识源抓取（落 `portable/memory/knowledge/`） |
| `knowledge-ingest.mjs` | 知识订阅入库（零 LLM，`storeEntry` 内置去重） |
| `tool-stats-sync.mjs` | 工具使用统计汇总（`usage.jsonl` → 跨设备计数） |
| `task-summarizer.mjs` | 任务记录批量总结（游标聚合 → digest，`--spawn` 可选入库） |
| `sync-memory.sh` | 记忆/选定会话的 age 加密同步（`init/push/pull/verify/status`）；`verify` 校验可解密性 + `age.pub` 与私钥一致性 + 清单一致 + JSON 有效，`--no-key` 仅查密文完整性 |

## 相关

- 脚本清单与职责总览：[../STRUCTURE.md](../STRUCTURE.md)
- 构建/同步/体检深入：[../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
