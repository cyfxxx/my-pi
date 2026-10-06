# scripts — 运维脚本

仓库内所有可执行运维脚本（**不得建子目录**，`check-isolation` 检查 9）。定位为「构建 / 守门 / 运维 / 自愈」四类。

## 构建与引导

| 脚本 | 用途 |
|------|------|
| `build.sh` | 一键重建/引导：Node 检查 → 根依赖 `npm ci`（不改 lock）→ vendor 引导与补丁幂等提交 → 工作区按依赖顺序构建（模型数据缺失时联网生成）→ 可选 fd-rg shim / 自愈缓存 |
| `dev.sh` | 开发模式运行源码（tsx 直接跑 vendor 的 `cli.ts`，不构建；tsx 来自根 `node_modules`） |
| `sync-upstream.sh` | 上游同步 + 自动修复：临时 worktree 确定性重建补丁栈 → 重建 dist → 刷自愈缓存 → 类型检查（`PI_SYNC_DRY_RUN=1` 只读预演）。**同步前先跑 `check-upstream.sh`** |
| `lib-vendor.sh` | 被 build/sync/doctor source 的共享逻辑（补丁幂等应用、依赖一致性、vendor exclude） |
| `lib-mode.sh` | 被 `pi-supervisor.sh` / `dev.sh` source 的**模式解析**共享逻辑：读 `modes.json`（配置）+ `modes-sessions.json`（会话→模式记录，gitignored），产出 `MODE_NAME`/`MODE_NS`/`MODE_APPEND_ABS`（人设绝对路径）并导出 `PI_SESSION_MODE`（pi 侧的软来源）。模式是**会话属性**：新会话用 `modes.json` 的 default；bash 只认 `--session <绝对路径>`，`-c`/`-r`/会话 id 等形态交给 pi 侧 `session_start` 自愈。此前只写在 supervisor 里，导致 `dev.sh` 静默不注入人设 |
| `pi-source-build.sh` | 构建 vendor/pi 并把 dist 缓存为「好 pi」（崩溃自愈用）；`--no-build` 仅缓存现有 dist |
| `run-ts.sh` | 以 tsx 运行「需加载 my-pi TypeScript 逻辑」的脚本（`custom/` 用无扩展名导入，Node 裸跑解析不了）；headless 写记忆/入库的统一入口。tsx 由 `custom/package.json` 声明（根 `node_modules/.bin/tsx`）——**不要再用 `vendor/pi` 那份**：上游 v0.99.0 起已删除该依赖，本地副本是升级残留，fresh `npm ci` 后消失 |

## 体检与守门

| 脚本 | 用途 |
|------|------|
| `doctor.sh` | 本地环境 vs 仓库体检（依赖/vendor/补丁/dist 新鲜度/自愈缓存/shim/外部工具/类型/本地 vs origin/**vendor 离线归档是否含当前 PINNED_COMMIT**）+ **[12] 运行时状态不变量**（调 `state-audit.mjs`）；`--fix` 自动修复，`--full`/`--no-net` |
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
| `golden-tasks.sh` | 行为防退化基准 **19 步**（隔离/注册面/死导出/类型/单测/补丁/补丁行为/注入面/文档/supervisor/定时任务提示词/浏览器终端/用量度量/约定守门/书籍框架/私钥引导包/pre-push 门禁范围/**运行时状态不变量**/**模式切换场景**；第 19 步"模式切换场景"**默认跳过**（`PI_GOLDEN_SCENARIO=1` 开启，理由见下），`--fast` 跳过 tsc+vitest，`--smoke` 追加无头冒烟＝第 20 步） |
| `bootstrap-key.sh` | **age 私钥引导包**（方案 A）：`pack`（`age -p` 口令加密 → `sync/bootstrap.age` + 明文元信息 `.meta.json`）/ `verify`（成员白名单 + 指纹核对，不安装）/ `unpack [--yes]`（安装到私钥路径，600，覆盖留 `.bak`）；只装解密材料，**不装 SSH 私钥**。见 [docs/operations/KEY-BOOTSTRAP-ANALYSIS.md](../docs/operations/KEY-BOOTSTRAP-ANALYSIS.md) |
| `test-bootstrap.sh` | 引导包守门（13 项，临时密钥）：拒绝仓库内私钥、成员白名单、指纹不一致拒绝、口令模式 pack/unpack、覆盖保护、拒绝夹带 `id_ed25519` 的引导包；接入 golden 第 16 步 |
| `books.py` | **书籍知识库框架**（探针/索引/按需提页/报告/自检）：目录优先建索引（PDF outline / EPUB nav）、按需页提取（文字层优先 → tesseract 兜底）、缓存复用、每次运行留 run log；两端通用（手机 `role=phone` / PC `role=worker`）。用法见 [packs/books/SKILL.md](../packs/books/SKILL.md)，方案见 [docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md](../docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md) |
| `test-books.mjs` | 书籍框架自检（合成 PDF 跑通 probe/index/read/report/记录，15 项，零网络零 LLM），接入 golden 第 15 步 |
| `test-web-terminal.mjs` | 浏览器终端进程级守门（鉴权/cookie 属性/Host 栅栏/穿越防护/WS 双向数据/resize/restart/孤儿会话回收，36 项，零 LLM）；缺 `script`/`stty` 时显式 SKIP |
| 排查入口 | 见 [`../docs/BUG-REPLAYS.md`](../docs/BUG-REPLAYS.md)：事故 → 指纹 → 可执行复现 → 现在由谁挡住 |
| `state-audit.mjs` | **运行时状态不变量体检**（只读、零 LLM）：把「使用中才会发现」的静默失效变成一条结论——人设文件丢失（启动器静默不注入）、功能名拼错（静默少功能）、`default`/会话记录指向未知模式（静默回 full）、会话模式记录指向不存在的会话文件、重启请求写了没落地（超过 supervisor 的 300s 窗口）、重启通知超期未被消费、`PI_AGENT_MODE` 硬覆盖按会话模式；以及 `recovery/rounds.jsonl` 里的**行为异常**（24h 内"重启请求被吞"→error、同一会话 10 分钟重启 ≥3 次=循环、1 小时 ≥3 轮崩溃恢复=恢复风暴）；`--json`/`--strict`/`--quiet`，有 error 级发现则 exit 1 |
| `lib-state-audit.mjs` | `state-audit.mjs` / `daily-health.mjs` / `test-state-audit.mjs` 共用的**判定与文案**（纯函数吃快照，测试才能造任意状态）；绝不写文件 |
| `lib-fake-provider.mjs` | 本地假 provider（确定性、零网络）：把"这个动作到底有没有产生模型请求"变成可断言的**计数与请求体**，并让固定回复落进会话。真实 provider 让回合级断言变成概率事件（实测同一提示词 4.6s–145s）；场景用它断言"切模式 0 次请求 / 续跑那次请求体带着续跑指令" |
| `test-scenario-mode-restart.mjs` | **真实生命周期场景**（真 pty + 真 supervisor + 真 pi + 真 bootstrap，约 4 分钟）：在隔离的 agent/memory 目录里以 `--session` 启动 → 在 TUI 里输入 `/mode roleplay` → 断言进程真的被重拉、新进程 argv/env 里确实是 roleplay（人设 + 命名空间）、**切模式不触发任何模型回合**（会话文件里没有 user/assistant/custom_message 条目）、并在同一会话里验证**续跑通道**（写一条 intent=continue 的重启请求 → 新进程真的起回合接上工作）。自带**假 provider**，所以这些断言是计数级事实：切模式 `completions=0`、整场只跑了续跑那一个回合，且该回合的**请求体**里确实带着续跑指令（**26 项**）。因不再需要模型回合，本场景**不依赖 provider/网络**。这是唯一能挡住 2026-10-06「切模式后进程直接退出、模式没换」的检查。**默认不在 pre-push 门禁里跑**：它让门禁长到 ~7.5 分钟，实测 git push 期间 SSH 连接会被远端关闭（"Connection to ssh.github.com closed by remote host"）→ 用 `PI_GOLDEN_SCENARIO=1` 显式开启（改 mode/supervisor/生命周期 时必须跑）；缺 `script`/`stty` 或未构建 dist 时自跳过，`PI_SCENARIO_SKIP=1` 可再显式跳过 |
| `test-state-audit.mjs` | 状态体检口径守门（**50 项**，零 LLM）：每条不变量的「该触发 / 不该触发」两侧 + healthy 状态零 finding + **只读性**（跑完不动文件）+ **三处真值不漂移**（`FIXED_MODES` ↔ `lib-mode.sh`/`logic.ts`、功能名 ↔ `ALL_FEATURES`）+ CLI 退出码语义（error→1、`--strict` 下 warning→1、`--json` 可解析）；只注册命令的 `mode`/`intervention` 不得被误判为未知功能 |
| `test-usage-metrics.mjs` | 成本度量口径守门（**46 项**，零 LLM）：合成数据驱动 `daily-health.mjs`，锁定命中率取自**每轮用量**而非工具级台账、前缀前端变更（system/tools/level）与**首段分叉（`messages@0-7`＝整段重放）**会触发告警、中后段分叉单独计数不误报、**旧记录仅 head 不计入**（与头窗内追加无法区分，实测误报率 19/42）、**冷启动次数与未命中量**（与每轮用量配对）、**工具声明体积**超阈值告警、**回合内 bash 调用分布**（每步 p50/p90/max 与单命令占比，漂移即告警）、**压缩归因**（压缩窗口内的整段重放单独计数并进「已知」留痕，窗口外不豁免）、缺数据时记 n/a 而非瞎算 |
| `patch-playwright-core.mjs` | Termux 下把 playwright-core 的 linux 分支扩展至 android（幂等） |
| `install-hooks.sh` | 启用 `.githooks/`（pre-commit → `golden --fast`；pre-push → 默认全量，仅当本次推送改动全部在 `prepush-scope.sh` 白名单内时降级 `--fast`）；本地无 CI，钩子是唯一自动防线。钩子会把完整输出 `tee` 到 `/tmp/my-pi-golden-{precommit,prepush}.log`——分步日志 `/tmp/golden-*.log` 会被下一次运行覆盖，偶发失败（实测发生过一次无法归因的拦截）需要留证据 |
| `prepush-scope.sh` | pre-push 门禁范围判定（`<remote_oid> <local_oid>` → `full`/`fast`）：只有改动全部落在 `portable/memory/stats/` 才降级快检。远端对象不可得/全 0/空 diff 一律回退全量 |
| `test-prepush-scope.sh` | 上者的守门（7 项，临时仓库造真实提交）：纯数据→fast、含代码→full、数据+代码混合→full、远端未知/新分支/空 diff/删 ref→full；接入 golden 第 17 步 |
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
| `memory-store.mjs` | 记忆入库（零 LLM，直调 memory 逻辑层 `storeEntry`，内置标题去重）；`--json`/`--file`/stdin，`--dry-run`，`--source manual`（人工写入，治理层受保护；默认 `auto`＝自动流程） |
| `memory-lifecycle.mjs` | 记忆生命周期只读报告（零 LLM，调 `analyzeLifecycle`：淘汰/升格/冲突/垃圾/聚合候选）；`--json`/`--limit`；headless 下替代 `/memory lifecycle` |
| `reseed-seeds.mjs` | 把 `scheduled-seeds.json` 的定义显式应用到已存在的同名任务（种子对账只补缺失不覆盖；改提示词后用它；保留 id/enabled/lastRun/runCount/history，默认预演，`--apply` 先备份） |
| `daily-health.mjs` | 每日健康检查（**加权命中率/未命中每次/输出占比/前缀前端变更次数/首段分叉/中后段分叉/冷启动次数**/记忆库/种子失配/守门脏改/**运行时状态异常与警告**（调 `lib-state-audit.mjs`，error→alert、warning→留痕）；阈值 `PI_HEALTH_HIT_FLOOR`=0.97、`PI_HEALTH_UNCACHED_CEIL`=3000、`PI_HEALTH_COLDSTART_CEIL`=8。数据源是每轮用量 `.usage-diag.jsonl` 与 `prefix-fingerprints.jsonl`——**不要改用工具级台账 `usage.jsonl`**，它没有缓存字段，会让命中率恒为 n/a） |
| `knowledge-fetch.py` | 知识源抓取（落 `portable/memory/knowledge/`） |
| `knowledge-ingest.mjs` | 知识订阅入库（零 LLM，`storeEntry` 内置去重） |
| `tool-stats-sync.mjs` | 工具使用统计汇总（`usage.jsonl` → 跨设备计数） |
| `task-summarizer.mjs` | 任务记录批量总结（游标聚合 → digest，`--spawn` 可选入库） |
| `sync-memory.sh` | 记忆/选定会话的 age 加密同步（`init/push/pull/verify/status`）；`verify` 校验可解密性 + `age.pub` 与私钥一致性 + 清单一致 + JSON 有效，`--no-key` 仅查密文完整性 |

## 相关

- 脚本清单与职责总览：[../STRUCTURE.md](../STRUCTURE.md)
- 构建/同步/体检深入：[../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
