# scripts — 运维脚本

仓库内所有可执行运维脚本（**不得建子目录**，`check-isolation` 检查 8）。定位为「构建 / 守门 / 运维 / 自愈」四类。

## 构建与引导

| 脚本 | 用途 |
|------|------|
| `build.sh` | 一键重建/引导：Node 检查 → 根依赖 `npm ci`（不改 lock）→ vendor 引导与补丁幂等提交 → 工作区按依赖顺序构建（模型数据缺失时联网生成）→ 可选 fd-rg shim / 自愈缓存 |
| `dev.sh` | 开发模式运行源码（tsx 直接跑 vendor 的 `cli.ts`，不构建；tsx 来自根 `node_modules`） |
| `sync-upstream.sh` | 上游同步 + 自动修复：临时 worktree 确定性重建补丁栈 → 重建 dist → 刷自愈缓存 → 类型检查（`PI_SYNC_DRY_RUN=1` 只读预演）。**同步前先跑 `check-upstream.sh`** |
| `lib-vendor.sh` | 被 build/sync/doctor source 的共享逻辑（补丁幂等应用、依赖一致性、vendor exclude） |
| `lib-mode.sh` | 被 `pi-supervisor.sh` / `dev.sh` source 的**模式解析**共享逻辑：读 `modes.json`（配置）+ `modes-state.json`（运行时 current，gitignored），产出 `MODE_NAME`/`MODE_NS`/`MODE_APPEND_ABS`（人设绝对路径）。此前只写在 supervisor 里，导致 `dev.sh` 静默不注入人设 |
| `pi-source-build.sh` | 构建 vendor/pi 并把 dist 缓存为「好 pi」（崩溃自愈用）；`--no-build` 仅缓存现有 dist |
| `run-ts.sh` | 以 tsx 运行「需加载 my-pi TypeScript 逻辑」的脚本（`custom/` 用无扩展名导入，Node 裸跑解析不了）；headless 写记忆/入库的统一入口。tsx 由 `custom/package.json` 声明（根 `node_modules/.bin/tsx`）——**不要再用 `vendor/pi` 那份**：上游 v0.99.0 起已删除该依赖，本地副本是升级残留，fresh `npm ci` 后消失 |

## 体检与守门

| 脚本 | 用途 |
|------|------|
| `doctor.sh` | 本地环境 vs 仓库体检（依赖/vendor/补丁/dist 新鲜度/自愈缓存/shim/外部工具/类型/本地 vs origin/**vendor 离线归档是否含当前 PINNED_COMMIT**）；`--fix` 自动修复，`--full`/`--no-net` |
| `check-isolation.sh` | 隔离边界（symlink、禁用目录、逻辑层 Pi 依赖、vendor 干净等 9 项） |
| `check-features.sh` | 功能完整性（12 feature 目录 + 生成式注册面基线 + 适配器 API + 钩子事件 + 配置/脚本/补丁） |
| `gen-registrations.mjs` | 从代码生成/校验注册面基线 `registration-baseline.json`（`--update` 刷新）；替代手写清单防漂移 |
| `check-dead-exports.mjs` | 死导出守门（抓"写了没接线"；白名单 `dead-exports-allowlist.txt`） |
| `check-patches-behavior.mjs` | 补丁行为存在性守门（断言关键符号/自标记仍在 vendor 源码，防上游同步语义漂移） |
| `check-upstream.sh` | **上游同步前体检（只读）**：目标版本/区间提交数/各包 churn/新增包、changelog 新增版本段与破坏性关键词、每个 `patches/*.patch` 的目标文件是否被上游改过、`custom/adapters` 依赖的 API 面是否变动；结论=已最新/可同步/需先改补丁（`PI_CHECK_NO_FETCH=1` 离线，`PI_CHECK_STRICT=1` 风险时 exit 2）。流程见 [../docs/operations/UPSTREAM-UPDATE.md](../docs/operations/UPSTREAM-UPDATE.md) |
| `check-injection-surface.sh` | system prompt 注入面前缀指纹基线守门（`--update` 更新基线） |
| `check-conventions.sh` | 约定守门（P4 升格通道）：A 运行时状态不入库（`settings.json` 的 `deviceId`、`modes.json` 的 `current`）／B 敏感文件与运行时数据不入库（已跟踪 + **暂存区**，含 `*-state.json`、会话、扩展安装位、私钥、`.env`）／C 生产代码禁 `any` 与动态 `import(`（测试与 `node_modules` 排除）；三条原为 AGENTS.md 软约定 |
| `check-doc-links.mjs` | 文档内部相对链接一致性 |
| `check-seeds-headless.mjs` | 定时任务提示词 headless 可用性守门（不得引用 `--no-extensions` 下不存在的扩展工具/斜杠命令） |
| `golden-tasks.sh` | 行为防退化基准 **15 步**（隔离/注册面/死导出/类型/单测/补丁/补丁行为/注入面/文档/supervisor/定时任务提示词/浏览器终端/用量度量/约定守门/书籍框架；`--fast` 跳过 tsc+vitest，`--smoke` 追加无头冒烟） |
| `books.py` | **书籍知识库框架**（探针/索引/按需提页/报告/自检）：目录优先建索引（PDF outline / EPUB nav）、按需页提取（文字层优先 → tesseract 兜底）、缓存复用、每次运行留 run log；两端通用（手机 `role=phone` / PC `role=worker`）。用法见 [packs/books/SKILL.md](../packs/books/SKILL.md)，方案见 [docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md](../docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md) |
| `test-books.mjs` | 书籍框架自检（合成 PDF 跑通 probe/index/read/report/记录，15 项，零网络零 LLM），接入 golden 第 15 步 |
| `test-web-terminal.mjs` | 浏览器终端进程级守门（鉴权/cookie 属性/Host 栅栏/穿越防护/WS 双向数据/resize/restart/孤儿会话回收，36 项，零 LLM）；缺 `script`/`stty` 时显式 SKIP |
| `test-usage-metrics.mjs` | 成本度量口径守门（**35 项**，零 LLM）：合成数据驱动 `daily-health.mjs`，锁定命中率取自**每轮用量**而非工具级台账、前缀前端变更（system/tools/level）与**首段分叉（`messages@0-7`＝整段重放）**会触发告警、中后段分叉单独计数不误报、**旧记录仅 head 不计入**（与头窗内追加无法区分，实测误报率 19/42）、**冷启动次数与未命中量**（与每轮用量配对）、**工具声明体积**超阈值告警、**回合内 bash 调用分布**（每步 p50/p90/max 与单命令占比，漂移即告警）、缺数据时记 n/a 而非瞎算 |
| `patch-playwright-core.mjs` | Termux 下把 playwright-core 的 linux 分支扩展至 android（幂等） |
| `install-hooks.sh` | 启用 `.githooks/`（pre-commit → `golden --fast`，pre-push → 全量）；本地无 CI，钩子是唯一自动防线。钩子会把完整输出 `tee` 到 `/tmp/my-pi-golden-{precommit,prepush}.log`——分步日志 `/tmp/golden-*.log` 会被下一次运行覆盖，偶发失败（实测发生过一次无法归因的拦截）需要留证据 |
| `vendor-bundle.sh` | vendor/pi 离线归档（`create`/`restore`/`status`）；`status` 会标注每个归档**是否含当前 PINNED_COMMIT**（只报"存在"会假安全）；bundle 不入库 |

## 对外服务

| 脚本 | 用途 |
|------|------|
| `setup-external.sh` | 可选外部服务/依赖（tmux / SearXNG 原生或容器 / whisper 指引 / fd-rg shim） |
| `searxng-config.sh` | 生成 SearXNG `settings.yml`（禁用不可达引擎、bing 指向 cn.bing.com；`--force/--probe`） |

## 运行期自愈与运维

| 脚本 | 用途 |
|------|------|
| `web-terminal.sh` | 浏览器终端启动器：在 pty 里拉起 `my-pi.sh`，起 HTTP/WS 服务（只绑 127.0.0.1，远程走 SSH 隧道）；见 [custom/web-terminal/README.md](../custom/web-terminal/README.md) |
| `pi-supervisor.sh` | 崩溃自愈外壳（分类/修复者 pi/健康检查/熔断）；`MY_PI_NO_SUPERVISOR=1` 直启 |
| `test-supervisor.sh` | supervisor 纯函数行为测试（崩溃分类 / admin state 解析；库模式 source，无需网络/provider） |
| `memory-store.mjs` | 记忆入库（零 LLM，直调 memory 逻辑层 `storeEntry`，内置标题去重）；`--json`/`--file`/stdin，`--dry-run` |
| `memory-lifecycle.mjs` | 记忆生命周期只读报告（零 LLM，调 `analyzeLifecycle`：淘汰/升格/冲突/垃圾/聚合候选）；`--json`/`--limit`；headless 下替代 `/memory lifecycle` |
| `reseed-seeds.mjs` | 把 `scheduled-seeds.json` 的定义显式应用到已存在的同名任务（种子对账只补缺失不覆盖；改提示词后用它；保留 id/enabled/lastRun/runCount/history，默认预演，`--apply` 先备份） |
| `daily-health.mjs` | 每日健康检查（**加权命中率/未命中每次/输出占比/前缀前端变更次数/首段分叉/中后段分叉/冷启动次数**/记忆库/种子失配/守门脏改；阈值 `PI_HEALTH_HIT_FLOOR`=0.97、`PI_HEALTH_UNCACHED_CEIL`=3000、`PI_HEALTH_COLDSTART_CEIL`=8。数据源是每轮用量 `.usage-diag.jsonl` 与 `prefix-fingerprints.jsonl`——**不要改用工具级台账 `usage.jsonl`**，它没有缓存字段，会让命中率恒为 n/a） |
| `knowledge-fetch.py` | 知识源抓取（落 `portable/memory/knowledge/`） |
| `knowledge-ingest.mjs` | 知识订阅入库（零 LLM，`storeEntry` 内置去重） |
| `tool-stats-sync.mjs` | 工具使用统计汇总（`usage.jsonl` → 跨设备计数） |
| `task-summarizer.mjs` | 任务记录批量总结（游标聚合 → digest，`--spawn` 可选入库） |
| `sync-memory.sh` | 记忆/选定会话的 age 加密同步（`init/push/pull/verify/status`）；`verify` 校验可解密性 + `age.pub` 与私钥一致性 + 清单一致 + JSON 有效，`--no-key` 仅查密文完整性 |

## 相关

- 脚本清单与职责总览：[../STRUCTURE.md](../STRUCTURE.md)
- 构建/同步/体检深入：[../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
