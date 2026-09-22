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

## 体检与守门

| 脚本 | 用途 |
|------|------|
| `doctor.sh` | 本地环境 vs 仓库体检（依赖/vendor/补丁/dist 新鲜度/自愈缓存/shim/外部工具/类型/本地 vs origin）；`--fix` 自动修复，`--full`/`--no-net` |
| `check-isolation.sh` | 隔离边界（symlink、禁用目录、逻辑层 Pi 依赖、vendor 干净等 9 项） |
| `check-features.sh` | 功能注册面（12 feature 的目录/工具/命令/快捷键/钩子/适配器 API/补丁） |
| `check-injection-surface.sh` | system prompt 注入面前缀指纹基线守门（`--update` 更新基线） |
| `check-doc-links.mjs` | 文档内部相对链接一致性 |
| `golden-tasks.sh` | 行为防退化基准（隔离/注册面/类型/单测/补丁/注入面/文档；`--smoke` 追加无头冒烟） |
| `patch-playwright-core.mjs` | Termux 下把 playwright-core 的 linux 分支扩展至 android（幂等） |

## 对外服务

| 脚本 | 用途 |
|------|------|
| `setup-external.sh` | 可选外部服务/依赖（tmux / SearXNG 原生或容器 / whisper 指引 / fd-rg shim） |
| `searxng-config.sh` | 生成 SearXNG `settings.yml`（禁用不可达引擎、bing 指向 cn.bing.com；`--force/--probe`） |

## 运行期自愈与运维

| 脚本 | 用途 |
|------|------|
| `pi-supervisor.sh` | 崩溃自愈外壳（分类/修复者 pi/健康检查/熔断）；`MY_PI_NO_SUPERVISOR=1` 直启 |
| `daily-health.mjs` | 每日健康检查（命中率/记忆库/种子失配/守门脏改） |
| `knowledge-fetch.py` | 知识源抓取（落 `portable/memory/knowledge/`） |
| `knowledge-ingest.mjs` | 知识订阅入库（零 LLM，`storeEntry` 内置去重） |
| `tool-stats-sync.mjs` | 工具使用统计汇总（`usage.jsonl` → 跨设备计数） |
| `task-summarizer.mjs` | 任务记录批量总结（游标聚合 → digest，`--spawn` 可选入库） |

## 相关

- 脚本清单与职责总览：[../STRUCTURE.md](../STRUCTURE.md)
- 构建/同步/体检深入：[../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
