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
| `check-conventions.sh` | 约定守门（P4 升格通道）：A 运行时状态不入库（`settings.json` 的 `deviceId`、`modes.json` 的 `current`）／B 敏感文件与运行时数据不入库（已跟踪 + **暂存区**，含 `*-state.json`、会话、扩展安装位、私钥、`.env`）／C 生产代码禁 `any` 与动态 `import(`（测试与 `node_modules` 排除）／D 文档结构计数与事故台账（脚本数、golden 步数、`BUG-REPLAYS` 每行可重跑）／E 模式人设的图片资产引用成对（悬空引用、孤儿资产、目录 8 MB 上限）；A/B/C 三条原为 AGENTS.md 软约定 |
| `check-packs-links.mjs` | **packs 内部链接守门**（新增 2026-10-15）：`check-doc-links.mjs` 有意排除 `packs/`，这一条补上 —— 校验 `packs/**` 下所有 md 的**相对链接**（跳过围栏代码块、`http(s)`/`mailto`/纯锚点；以 `/` 开头的按上游口径跳过并单独计数），命中集合 = `git ls-files packs` 的文件 ∪ 其父目录（天然忽略 `work/`、`tool-index.md` 等 gitignore 生成物），另放行「磁盘上确实存在」或「被 .gitignore 忽略」的目标。用法 `node scripts/check-packs-links.mjs [--json] [--pkg <name>]`；断链 ⇒ exit 1 并点名 `md:行 -> 目标`。接在 `check-conventions.sh` G 段 ⇒ 随 golden（含 `--fast`）跑 |
| `check-packs-structure.mjs` | **packs 结构守门**（新增 2026-10-15）：把 `packs/README.md` 里已成文却无人执行的结构约定变成断言 —— R1 包根须有 `SKILL.md`（或在 `DETAIL_LAYERS` 细节层白名单 / `ROOT_ENTRY_ALIAS` 的 vendored 入口别名里）／R2 每个 `SKILL.md` 的 frontmatter 须有 `name`+`description` 且 description 不含日期／R3 包根须有"使用后经验沉淀"段或 `EXPERIENCE.md`／R4 包名须出现在 `packs/INDEX.md` 与 `packs/README.md`／R5 **packs 下不得有未跟踪或"未跟踪且被忽略"的文件**（`IGNORE_ALLOW` 列各包正常运行产物；这条兜住"`git add` 被 `.gitignore` 静默吞掉上游已跟踪文件"）／R6 `drafts/` 只允许 `.gitkeep` 与 `workticket-*.md`／R7 README 里"已落地 N 个"计数须等于实测。用法 `node scripts/check-packs-structure.mjs [--json]`；接在 `check-conventions.sh` H 段 ⇒ 随 golden（含 `--fast`）跑 |
| `lib-portable.sh` | **便携运行时单一事实来源**（新增 2026-10-15，被 `my-pi.sh`/`pi-supervisor.sh`/`lib-vendor.sh`/服务脚本 source）：平台判定、仓内运行时目录、Node/Python 解析（`pi_resolve_node`/`pi_resolve_python`）、便携环境导出（`pi_portable_env`：PATH + npm/pip 缓存 + pycache **强制**仓内）、服务私有 `HOME`/`XDG`/`TMP`（`pi_service_env`）、venv 自愈（`pi_py_repair_venv`）。解析点由此从三份拷贝收敛为一处 |
| `portable-runtime.sh` | **把运行时装进仓库**（新增 2026-10-15）：`status`/`node`/`python`/`deps [profile…]`/`searxng`/`repair`/`env`/`verify`/`all`。清单 `scripts/portable-artifacts.txt`（版本+镜像+**sha256**），下载后校验再解包到 `<repo>/runtime/<平台>/`；`deps` 用 `pip --target` 装进仓内站点目录（不建 venv ⇒ 天然可搬迁）；`searxng` 把 SearXNG 源码+依赖+settings 也装进仓库；`repair` 从缓存重解包（FUSE 符号链接污染自愈）。详见 [docs/operations/PORTABLE-LINUX.md](../docs/operations/PORTABLE-LINUX.md) |
| `dsh-scenario-isolation.sh` | **P6③ 场景测试（DSH 版）之一：两实例隔离**（默认 **SKIP**，需 `MY_PI_HOST_SMOKE=1`）：两个实例**并发**跑（各自的隔离 `DSH_HOME` + 各自的 `PI_USAGE_DIAG_FILE`），但**共用同一个仓库状态**（`portable/`）—— 这正是换底座后要重问的问题（pi 侧的场景测试断言的是 pi 的进程/状态语义，DSH 的 Host/Session 语义不同 ⇒ 必须重写，见迁移计划 P6③）。断言：① 两实例都退出码 0 且都能看到插件日志；② 会话库互不串（各自 home 下的会话 id 不同）；③ 用量台账各写各的、**仓库默认那份不被写**；④ 不产生脏目录（`dsh/portable`）。开关：`MY_PI_SCEN_PROMPT_A/B`（两个任务）、`MY_PI_SCEN_BASE`（隔离根）、`MY_PI_SCEN_TIMEOUT` |
| `dsh-scenario-session-resume.sh` | **P6③ 场景测试（DSH 版）之二：会话续接（adopt/resume）**（默认 **SKIP**，需 `MY_PI_HOST_SMOKE=1`）：DSH 没有 pi 那套 `newSession/switchSession` 入口，对应能力是 `--session-id <id>` **收养**已持久化的会话继续跑。断言：① 两轮报出的 sessionId 相同、会话目录数不变（是收养而不是新开）；② 续接的会话里我们的插件仍在位；③ 第二轮答得出第一轮让它"记住"的词（历史确实被带上）。★ 明确**不**验"切换前可否决"——DSH 上该语义没有落点（钩子映射 `session_before_switch` 行）。若模型没回忆起来，脚本回 **exit 2（无法判定）**而不是判失败（不把模型波动当插件问题）。开关：`MY_PI_SCEN_WORD`、`MY_PI_SCEN_BASE`、`MY_PI_SCEN_TIMEOUT` |
| `dsh-scenario-mode.sh` | **P6③ 场景测试（DSH 版）之三：模式（启动期）生效**（默认 **SKIP**，需 `MY_PI_HOST_SMOKE=1`）：pi 侧的模式场景断言的是 supervisor **自动重启链**，DSH 没有那条链（`admin_restart` 在适配层明确报 unsupported）⇒ 照搬必失败；但"模式 = 启动期决定注册哪些特性"在 DSH 上仍成立且可测。断言：① 默认（full）注册面是"大"的那套；② `PI_AGENT_MODE=minimal`（锁定模式，`features: []`）注册面显著收缩，但 `mode` 命令仍在（否则切不回来）；③ 同一插件两种模式都退出码 0 且有插件日志。★ 明确**不**验"运行中热切换 + 自动重启续接"。隔离做法：把 `PI_CODING_AGENT_DIR`/`PI_MEMORY_DIR` 显式指到临时目录 ⇒ 不读不写仓库 `portable/` |
| `dsh-host-smoke.sh` | **Host 级端到端冒烟**（默认 **SKIP**，需 `MY_PI_HOST_SMOKE=1` 显式 opt-in）：用**隔离 DSH_HOME**（凭据只临时拷一份 600，退出即删）从 `headless` 模板建 profile、叠加本仓 patch，真实启动一次最小任务；判定 = 退出码 0 **且**日志里能看到我们插件自己的行（否则是"插件没加载"）。**实测已通过**，且已跑通四类路径：插件加载/钩子触发（退出码 0、模型回「收到」）、**工具调用**（强制调 `memory_stats` ⇒ DSH 会话日志 `tool/call` 与 `tool/result` 内容正是 my-pi 的输出）、**回合用量**（`assistant/message.usage` ⇒ pi 的 `turn_end` 负载 ⇒ 未被改动的特性真的落盘）、**注册汇总**（`工具 53 / 命令 10 / 同名冲突 1 / 钩子 18`）。开关：`MY_PI_HOST_PROMPT`（换任务）、`MY_PI_DSH_TRACE_EVENTS=1`（会话事件 + 注册汇总诊断）、`PI_USAGE_DIAG_FILE`（用量落盘位置）、`MY_PI_HOST_HOME`/`LOG_DIR`/`CREDENTIALS`。首次跑抓出两个致命问题（`inject` 约束、工具定义必须 `defineTool` 编译），后续抓出**同名冲突连带丢注册**与**用量桥丢数据**，均已修并复验 |
| `dsh-package.sh` | **DSH 插件的正式发布形态验证**：构建 → `npm pack`（自检 tgz 只含 dist、无源码/测试）→ 安装到 `/tmp/my-pi-plugin-install` → **断言产物自包含**（2026-10-18 起 shim 已打进产物 ⇒ 安装目录里**不该**出现 `@earendil-works/*`，也就不再需要部署侧 pi 别名/`pnpm.overrides`）→ 逐包补**宿主包本地等价物**（真实部署由宿主提供）→ 纯 node 从**已安装位置**加载并 apply，实测 **54 工具 / 0 特性失败 / 含 searxng**。★★ **它不在任何自动门禁里**（重、要装包）⇒ **必须手工跑**；正因如此它曾在 2026-10-18 静默失效一整天（那天新增的宿主 import 让独立安装目录解析不到包，见 `BUG-REPLAYS` #43）。代价已被部分补上："产物不得含 `@earendil-works/*` import"这类**零成本断言**已加进每次构建都跑的 `smoke-built.mjs` |
| `dsh-build.sh` | **把 my-pi 的 DSH 插件打成可安装产物**（分支 `feat/base-switch-dsh`）：esbuild `--packages=external` 打包 `dsh/plugin/entry.ts` → `dsh/plugin/dist/my-pi-plugin.mjs`（gitignored）；随后**纯 node 冒烟**（`dsh/spike/smoke-built.mjs`，无 tsx）断言插件名/inject/54 工具/含 web_search/0 失败。用法 `bash scripts/dsh-build.sh [--no-smoke]` |
| `dsh-baseline.sh` | **DSH 侧工具声明面基线**（P6 第一块）：`measure`（打印）/ `--check`（漂移 ⇒ exit 1）/ `--update`（写 `dsh/baseline/tool-surface.json`，需人工确认）。口径 = `parameterSchemaSpecToJsonSchema` 编译后的声明 UTF-8 字节；实测 **54 工具 / 25,761 B**。与 pi 侧的 24,785B **口径不同，不做减法** |
| `dsh-smoke-profile.sh` | **真实 dsh launcher 的 profile 组合干跑**：隔离 `DSH_HOME`（`/tmp/my-pi-dsh-smoke-home`）→ `--from-default-profile headless` → `--patch dsh/profile/my-pi.patch.yml --dump-config` ⇒ 组合树里必须出现 `id: my-pi` 条目。**只组合、不启动 Host**（不打扰正在跑的 dsh web、不碰凭据/内存）；找不到 `dsh` 时记 SKIP 并 exit 0 |
| `dsh-runtime.sh` | **把 DSH 宿主装进仓内**（`install [--from-npx]`/`verify`/`status`/`path`）：落点 `runtime/<平台>/ext/dsh/`（gitignored，与 node/python 同一套便携约定），版本钉死 `DSH_VERSION=0.2.0-rc.2`；`--from-npx` 从已有完整 npx 安装 `cp -a` 搬运（**禁止 `cp -al`**）并自检"零绝对符号链接"。为什么要它：`dsh` CLI 原先只活在 npx 缓存（仓外、会被 `npm cache clean` 清掉） |
| `dsh-launch.sh` | **一条指令启动 my-pi（DSH 基座）**（`web [--port N] [--no-open]`/`headless "任务"`/`acp`）：仓库根 `my-pi.sh web|headless|acp` 分流到这里。宿主**仓内优先**、`DSH_HOME` 默认 `<repo>/portable/dsh`、凭据 600 拷入仓内 home、缺产物现建、`@deepseek-ai/*` 重指到当前宿主；`--print-host` 零副作用报告解析结果 |
| `dsh-spike.sh` | **DSH 换基座 spike**（分支 `feat/base-switch-dsh`）：把 spike 依赖装进 `dsh/spike/node_modules`（gitignored）、把 pi 包 specifier 别名到**本仓 shim**（`custom/adapters/dsh/pi-shims/`，即零 pi 依赖；`PI_SPIKE_PI_ALIAS=vendor` 可切对照模式），再用仓库 tsx 跑 `dsh/spike/spike.ts`。26 条检查（A1–A26，真实 `@deepseek-ai/*` 包）：工具注册/真实执行、观察者钩子不打断 waterfall、**拦截钩子真生效**、真实特性（web-search）注册与执行、未登记事件抛错、**全量 bootstrap（54 工具 / 0 失败 + 钩子台账 7/11/0）**、**pi 形状命令 → 真实命令服务**（`find()` 命中 / `rawInput` 透传 / 会话身份 / 抛错映射）、**会话生命周期真跑**（`session/created` → `session_start`、disposer → `session_shutdown`，身份正确）、**动态上下文落点**、**会话事件桥**（真实 `Session.append()` ⇒ 对应处理器触发、type 不串台）、**工具结果替换**（`{content}` 真替换内容块）、**消息投递接线**、**会话枚举**（真实 `SessionStore`）、**流帧翻译**（真实派发 `chunk` 帧 ⇒ 处理器收到 `assistantMessageEvent`；不可表达帧上报）、**按插件装载**（A18，走 cordis loader ⇒ 才能抓 `inject` 约束类问题）、**注册必须是编译产物**（A19，`parameters.type` 全为 `object`）、**回合用量桥**（A20，真实 `SessionStore` + 兄弟子 ctx + 注册**两条** `turn_end` ⇒ 每条都拿到同一份用量）、**入口配置通路 + 命令换名注册**（A21，按真实装载路径 ⇒ `config.facade` 真的生效）、**`commands.execute()` 真跑**（A22：真实命令服务真的调用我们的处理器，`rawInput` 保留前导空格、会话身份注入、抛错映射成 `{kind:error}`、未知命令 `undefined`）、**移动端子代理并发核对**（A23：对真实 `dsh-subagent` 的 `Volatile<number>` 只读取值，非移动端不报警、模拟 Termux 报警并给部署片段）、**真 agent + 假模型装置**（A24：补齐 `dsh-agent-loop` 要求的 6 个 inject 服务 + 一个只实现 `stream()` 的假 `LlmAdapter` ⇒ 真 loop 跑完多步回合）、**`steer` 的边界语义**（A25：`followup`→`next-turn`、`steer`→`next-step`，且 steer 在第 1 步结束后**作为独立 user 消息**被消费）、**真 agent 下的命令执行**（A26：`commands.execute(活 agent, …)` ⇒ `result.kind=success`，处理器里 `getSessionId()` 正是那个活会话）。实测 **26 通过 / 0 失败**。用法 `bash scripts/dsh-spike.sh [--no-install]` |
| `check-conventions.sh`（J 段） | **DSH 侧基线的条件守门**：装了 `dsh/spike/node_modules` 且构建了 `dsh/plugin/dist` 时，比对 `dsh/baseline/{tool-surface,system-prompt}.json`（漂移 ⇒ 失败并指向 `--update`）；否则打印"跳过"（不静默算通过） |
| `check-md-tables.mjs` | **Markdown 表体完整性守门**（新增 2026-10-18，接在 `check-conventions.sh` **L 段**）：抓"程序化编辑把一行表格写成多行"（续行形状是行首空格 + 引号）—— 这类破表**人眼看着正常、渲染却把该行断成普通文本**，而当时所有既有守门都放行（我自己踩过一次：`DSH-MIGRATION-PLAN.md` 的 #18-x 行少了一条实测记录）。判据刻意窄：只查我们自己维护的 md（排除 vendored 的 `packs/` 与上游 `vendor/`）、**跳过围栏代码块**（实测不跳会误报 60+ 个合法文件，例如 `DECISIONS.md` 里 JSON 代码块的行首引号）。台账表体空行只报告不失败（实测 `knowledge-compile --check` 在 3 处空行下仍解析 41/41 条 ⇒ 做成硬门禁无证据）。用法 `node scripts/check-md-tables.mjs [--json]`；违规 ⇒ exit 1 并点名 `文件:行` |
| `check-conventions.sh`（K 段） | **`dsh/plugin` 的类型检查**（新增 2026-10-18）：官方的 `tsc -p custom/` 不收 `dsh/**`，而 `dsh/plugin/entry.ts` 会 import `@deepseek-ai/*`（该依赖由 `dsh-spike.sh` 按需安装）⇒ **条件**跑 `npx tsc -p dsh/`，缺依赖时明确跳过。它当场抓到两处既有类型错（`facade.disposers.push(...)` 与 `readonly DshDisposer[]` 冲突），那两行每次插件启动都要跑 |
| `check-portability.sh` | **便携性守门**（新增 2026-10-15）：P1 生产代码不得把仓外绝对路径当默认落点／P2 `runtime/` 必须被 gitignore 且零入库／P3 解析与三个缓存必须落在仓内／P4 制品 sha256 必须 64 位十六进制／P5 符号链接不得带 `0001` 污染尾巴。接在 `check-conventions.sh` **I 段** ⇒ 随 golden（含 `--fast`）跑 |
| `test-portability-move.sh` | **真实搬移测试**（新增 2026-10-15，按需、约 5–10 分钟）：整树复制到 `/tmp/my-pi-moved-<pid>`，用最小环境验证"换路径后仍可用"——`my-pi.sh --version` 用新路径的 node、便携 python+站点包可导入、`portable-runtime.sh verify` 全绿、SearXNG 真实搜出结果、扫描旧路径残留。★ 反例已固化：`cp -al` 在本机 FUSE 层**会改到源**（污染 545 个符号链接），故用 tar 管道 |
| `check-doc-links.mjs` | 文档内部相对链接一致性 |
| `check-seeds-headless.mjs` | 定时任务提示词 headless 可用性守门（不得引用 `--no-extensions` 下不存在的扩展工具/斜杠命令） |
| `golden-tasks.sh` | 行为防退化基准 **21 步**（隔离/注册面/死导出/类型/单测/补丁/补丁行为/注入面/文档/supervisor/定时任务提示词/浏览器终端/用量度量/约定守门/书籍框架/私钥引导包/pre-push 门禁范围/**运行时状态不变量**/**模式切换场景**/**两实例隔离场景**/**会话切换场景**；第 19/20/21 步三个真实场景都**默认跳过**（`PI_GOLDEN_SCENARIO=1` 开启，理由见下；其中第 19/20 步是**验收留出集**，第 21 步不是），`--fast` 跳过 tsc+vitest，`--smoke` 追加无头冒烟＝第 22 步） |
| `bootstrap-key.sh` | **age 私钥引导包**（方案 A）：`pack`（`age -p` 口令加密 → `sync/bootstrap.age` + 明文元信息 `.meta.json`）/ `verify`（成员白名单 + 指纹核对，不安装）/ `unpack [--yes]`（安装到私钥路径，600，覆盖留 `.bak`）；只装解密材料，**不装 SSH 私钥**。见 [docs/operations/KEY-BOOTSTRAP-ANALYSIS.md](../docs/operations/KEY-BOOTSTRAP-ANALYSIS.md) |
| `test-bootstrap.sh` | 引导包守门（13 项，临时密钥）：拒绝仓库内私钥、成员白名单、指纹不一致拒绝、口令模式 pack/unpack、覆盖保护、拒绝夹带 `id_ed25519` 的引导包；接入 golden 第 16 步 |
| `books.py` | **书籍知识库框架**（探针/索引/按需提页/报告/自检）：目录优先建索引（PDF outline / EPUB nav）、按需页提取（文字层优先 → tesseract 兜底）、缓存复用、每次运行留 run log；两端通用（手机 `role=phone` / PC `role=worker`）。用法见 [packs/books/SKILL.md](../packs/books/SKILL.md)，方案见 [docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md](../docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md) |
| `test-books.mjs` | 书籍框架自检（合成 PDF 跑通 probe/index/read/report/记录，15 项，零网络零 LLM），接入 golden 第 15 步 |
| `test-web-terminal.mjs` | 浏览器终端进程级守门（鉴权/cookie 属性/Host 栅栏/穿越防护/WS 双向数据/resize/restart/孤儿会话回收，36 项，零 LLM）；缺 `script`/`stty` 时显式 SKIP |
| 排查入口 | 见 [`../docs/BUG-REPLAYS.md`](../docs/BUG-REPLAYS.md)：事故 → 指纹 → 可执行复现 → 现在由谁挡住 |
| `state-audit.mjs` | **运行时状态不变量体检**（只读、零 LLM；含 `--json/--strict/--quiet`）：把「使用中才会发现」的静默失效变成一条结论——人设文件丢失（启动器静默不注入）、功能名拼错（静默少功能）、`default`/会话记录指向未知模式（静默回 full）、会话模式记录指向不存在的会话文件、重启请求写了没落地（超过 supervisor 的 300s 窗口）、重启通知超期未被消费、`PI_AGENT_MODE` 硬覆盖按会话模式；同时在跑的 my-pi 实例数（≥2 → info：共享状态文件、跨实例重启已由 ownerPid 隔离）、以及 `recovery/rounds.jsonl` 里的**行为异常**（24h 内"重启请求被吞"→error、同一会话 10 分钟重启 ≥3 次=循环、1 小时 ≥3 轮崩溃恢复=恢复风暴）；`--json`/`--strict`/`--quiet`，有 error 级发现则 exit 1 |
| `lib-state-audit.mjs` | `state-audit.mjs` / `daily-health.mjs` / `test-state-audit.mjs` 共用的**判定与文案**（纯函数吃快照，测试才能造任意状态）；绝不写文件；另含**调度器健康只读检查**：`scheduler.lock` 四态（none/held/**stale**/**stalled**）+ **任务逾期**兜底，**陈旧/疑似卡死 且 逾期** 时给出"调度器很可能已停摆"的组合判定（**只报告、不改状态** ✓） |
| `lib-fake-provider.mjs` | 本地假 provider（确定性、零网络）：把"这个动作到底有没有产生模型请求"变成可断言的**计数与请求体**，并让固定回复落进会话；支持 `delayMs`（**建议 ≥3s**：零延迟会命中 pi 在 session_start 触发回合时的竞态）与 `hangNext(n)`（模拟回合卡住），并记录每次请求的 `respondedAt`（区分"没回"与"没落盘"）。真实 provider 让回合级断言变成概率事件（实测同一提示词 4.6s–145s）；场景用它断言"切模式 0 次请求 / 续跑那次请求体带着续跑指令" |
| `test-scenario-mode-restart.mjs` | **真实生命周期场景**（真 pty + 真 supervisor + 真 pi + 真 bootstrap，约 8 分钟）：在隔离的 agent/memory 目录里以 `--session` 启动 → 在 TUI 里输入 `/mode roleplay` → 断言进程真的被重拉、新进程 argv/env 里确实是 roleplay（人设 + 命名空间）、**切模式不触发任何模型回合**（会话文件里没有 user/assistant/custom_message 条目）、并在同一会话里验证**续跑通道**（写一条 intent=continue 的重启请求 → 新进程真的起回合接上工作）。自带**假 provider**，所以这些断言是计数级事实：切模式 `completions=0`、整场只跑了续跑那一个回合，且该回合的**请求体最后一条输入**就是续跑指令。第三段还覆盖**缺省 intent（auto）**：把回合卡在模型调用里、半途 SIGTERM 重启 → 盘面尾部=工作在途 → 自动续跑（**33 项**）。因不再需要模型回合，本场景**不依赖 provider/网络**。这是唯一能挡住 2026-10-06「切模式后进程直接退出、模式没换」的检查。**默认不在 pre-push 门禁里跑**：它让门禁长到 ~7.5 分钟，实测 git push 期间 SSH 连接会被远端关闭（"Connection to ssh.github.com closed by remote host"）→ 用 `PI_GOLDEN_SCENARIO=1` 显式开启（改 mode/supervisor/生命周期 时必须跑）；缺 `script`/`stty` 或未构建 dist 时自跳过，`PI_SCENARIO_SKIP=1` 可再显式跳过 |
| `test-state-audit.mjs` | 状态体检口径守门（**55 项**，零 LLM）：每条不变量的「该触发 / 不该触发」两侧 + healthy 状态零 finding + **只读性**（跑完不动文件）+ **三处真值不漂移**（`FIXED_MODES` ↔ `lib-mode.sh`/`logic.ts`、功能名 ↔ `ALL_FEATURES`）+ CLI 退出码语义（error→1、`--strict` 下 warning→1、`--json` 可解析）+ 多实例探测（真 pi 形态 `process.title=pi` 与启动早期 `cli.js` 形态都要数到）；只注册命令的 `mode`/`intervention` 不得被误判为未知功能 |
| `lib-pty-harness.mjs` | `test-scenario-mode-restart.mjs` / `test-scenario-two-instances.mjs` / `test-scenario-session-switch.mjs` 共用的**真实 pty 场景骨架**（机制，不做断言）：`startPty`/`startSupervisorPty`（`script -q -e -f -E never`）、按 `/proc/<pid>/exe|environ` 找 pi/supervisor（**支持实例环境标记**，并排除 supervisor 的 `node -e` 助手——它同样带 agent 目录，会把进程发现指错）、`waitFor`/`stopPi`（重试 + 自解释超时）、JSONL/会话文件读取、隔离 agent 目录与假 provider 接线。抽出来的原因：进程发现判据一处修好、另一处仍是旧的（实测踩过） |
| `test-scenario-session-switch.mjs` | **会话切换场景**（真 pty + 真 supervisor + 真 pi + 假 provider，**18 项**，约 4 分钟）：覆盖用户实测的那条路径——TUI 里 `/new`（或 `/resume` 选择器）会**中止当前会话正在跑的那一轮**（pi 原生：会话替换先 `teardownCurrent()` → `session.abort()`，`agent-session-runtime.ts:167-177`）。断言：切之前模型请求确实在飞 → 发 `/new` 后**这一轮跑完并把回复落进旧会话文件**（工作没丢）、旧会话没有 `stopReason=aborted`/空 content 的 assistant 记录、回合结束后 **pi 自己**完成切换（另建会话文件并收到回复）、全程 PID 不变（进程内替换）；再挂一个请求测**逃生口**：`/new` 被延后后用 Esc 中断 ⇒ 这一轮真被中断（请求始终未被回应 + 会话留下 aborted 记录）且切换照样完成。**对照实验**：`PI_SESSION_SWITCH_GUARD=off node …`（改前行为）应得 **13/18**（五条判别性断言变红）。与第 19/20 步同样默认跳过（`PI_GOLDEN_SCENARIO=1` 开启；`PI_SCENARIO_SKIP=1`/`PI_SCENARIO_KEEP=1`/`PI_SCENARIO_TIMEOUT_MS` 语义一致） |
| `test-scenario-two-instances.mjs` | **两实例隔离场景**（真 pty×2 + supervisor×2 + 真 pi×2，共享一个 agent 目录/`state.json`/`rounds.jsonl`，**33 项**）：A 以 full 起、在 A 的 TUI 里 `/mode roleplay` → A 真重拉且新进程是 roleplay；B 起于 full、pid 全程不变、会话零注入（**A 的重启不越界到 B**）；B 的 `session_start` **晚于** A 写的重启日志 → 断言 B **没有**消费它（`restart-intent` 的 `logWrittenAfterStart`/`logTargetsOtherSession` 归属判据的真链验证）、A 的新进程最终消费/清空它；两实例同时在跑时 `state-audit` 报 `multiple-instances`（实例数 ≥2，真 pi 的 `process.title=pi` 形态）；B 仍可用（假 provider 收到请求、回复落 B 的会话）且 A/B 会话互不污染；收尾两实例 SIGTERM 干净退出、全程 `lostRestart=false`。与第 19 步同样默认跳过（`PI_GOLDEN_SCENARIO=1`），`PI_SCENARIO_SKIP=1`/`PI_SCENARIO_KEEP=1`/`PI_SCENARIO_TIMEOUT_MS` 语义一致 |
| `test-usage-metrics.mjs` | 成本度量口径守门（**62 项**，零 LLM）：合成数据驱动 `daily-health.mjs`，锁定命中率取自**每轮用量**而非工具级台账、前缀前端变更（system/tools/level）与**首段分叉（`messages@0-7`＝整段重放）**会触发告警、中后段分叉单独计数不误报、**旧记录仅 head 不计入**（与头窗内追加无法区分，实测误报率 19/42）、**冷启动次数与未命中量**（与每轮用量配对）、**工具声明体积**超阈值告警、**回合内 bash 调用分布**（每步 p50/p90/max 与单命令占比，漂移即告警）、**压缩归因**（压缩窗口内的整段重放单独计数并进「已知」留痕，窗口外不豁免）、**子代理池复用率**、**子代理返工**（父级在子代理返回后 N 个助手回合内是否又改同一文件；**有 `parentSession` 时只在该父会话里找**，旧记录退回启发式；只统计 `writePaths` 非空者，无样本记 n/a 而非 0%）、缺数据时记 n/a 而非瞎算 |
| `record-change.mjs` | **变更台账**（WikiSkill 借鉴 B 项，2026-10-08）：把每次改动记成结构化一行（`sha`/`subject`/`files`/`golden`/是否跑留出集），并支持 `--reject "提案" --reason "…"` 记**被否的方案与理由**（★ 2026-10-16 修：写进 `DECISIONS.md` 这个**事实来源**并自动重建台账+自检——此前写 `CHANGES.jsonl`（派生物）会被生成器**静默抹掉**，见 `BUG-REPLAYS` #45 与 `CODING-TRAPS` #16）。论文里 `skill-impact.md` 的作用是"**被否的改动不会被重复提出**"——my-pi 缺的正是这层可查询结构（实证：预算顶格被提 3 次、白名单纪律 2 次）。`pre-push` 只调 `--remind`（只提示、不写文件，避免脏工作区）；`--check` 挂在 `check-conventions.sh` 第 E 节 |
| `gen-doc-index.mjs` | **知识索引生成器**（WikiSkill 借鉴 A 项，2026-10-08）：从 `DECISIONS.md`/`PROGRESS.md`/`docs/BUG-REPLAYS.md`/`docs/design/*`/`docs/development/*` 抽"标题 + 一行结论 + **实测数字** + **证据（提交 sha 或可重跑命令）**"生成 `docs/INDEX.md`。用途是**找先例**（"这条判断以前做过吗、结论是什么、证据在哪"）——它**不进模型上下文**，只供检索；`--check` 挂在 `check-conventions.sh` 里防漂移（输出确定性、无时间戳）。`--update` 写回 |
| `security-scan.mjs` | **零依赖安全扫描**（2026-10-09）：`--file`（L0 sha256 + L1 结构：magic/扩展名、EICAR、pickle 危险引用、zip 路径穿越与炸弹）、`--url`（URLhaus 本地缓存比对，未命中叫 **not-listed≠安全**）、`--manifest [--verify]`（哈希清单防篡改）、`--update-feed`（URLhaus 免费无 key）。**三态结论 clean/suspicious/not-scanned**，没有 ClamAV 时必然出现 not-scanned（**不许假装安全**）；自证用 EICAR 测试串 |
| `knowledge-compile.mjs` | **离线「经验 → 知识」编译器**（WikiSkill 借鉴 C 项，2026-10-08）：按论文附录 E.2 的写入判据，把 `docs/BUG-REPLAYS.md` 的证据编译成 `docs/knowledge/patterns/*.md`（每页 10–30 行；写"是什么/根因/**确切命令序列**/**含确切语法的解法**"）+ `index.md`（固定格式的条目（名字 + 括号内相对路径 + PROBLEM + ROOT CAUSE + FIX 三段））。**不建重复、用新证据更新既有**（判据③，已实测）；`--check` 确定性比对（不含"本次增量"文件，故不能纳入比对）。**产物仅供人审阅、不进模型上下文、不改运行时行为** |
| `net-proxy.mjs` | **本地代理探测**（2026-10-10）：探测常见本地代理端口（7890 Clash / 10809 v2rayN / 1080 socks / 8118 privoxy …）。**比镜像清单更轻**：宿主机已有 VPN/加速软件时，`curl`/`git`/`npm`/`pip` 都认 `HTTPS_PROXY`，一行生效、零清单、永远与你的软件同步。**只探测只打印、不改任何配置、不设全局默认**；`--verify` 才真的走一次请求（**端口通 ≠ 能代理**，这条教训来自实测 `ghps.cc` 首页 404 却不能用）；`--export` / `--export-powershell` 给双端写法；**`--self-check` 是双向自证**（自己 listen 一个端口 ⇒ 必须发现；close 后 ⇒ 必须发现不了） |
| `net-mirror.mjs` | **网络通道探测与选路**（2026-10-10）：解决"镜像清单必然腐烂"——**用前探测**（断言**拿到 >0 字节**，不只看状态码）→ 选第一个真能用的 → 结果**带日期**追加 `portable/memory/logs/net-probe.jsonl`（不入库）。含 **2 条反向对照**（`github.com`/`raw.githubusercontent.com`：**应当失败**，若通了说明网络环境变了）。跨平台（不用 `/dev/null`，写 `os.tmpdir()`）。`--pick <file\|repo\|npm\|pypi\|rust\|go\|hf>` 按用途选路；`--self-check` **双向自证**（独立进程起服务返回确切字节 ⇒ 必须 ok 且 size 相符；杀掉后 ⇒ 必须 fail） |
| `security-baseline.mjs` | **分层完整性基线（防篡改）**（2026-10-10）：Tier1=执行面+提示面+控制面凭据+引导密钥；Tier2=进程内入口+系统级持久化点。`--tier1\|--tier2 --init\|--verify [--strict]`；**增量验证**（先比 size+mtimeMs，只有不一致才重算 sha256 ⇒ 热态**0 次哈希**）；**两道剪枝**（永不下潜 `.git`/`node_modules`/`vendor`… + 目录前缀剪枝——漏了"无字面前缀不剪枝"会被自证抓到）；只用 Node 标准库、不调任何外部命令；**默认只记录不阻断**。层定义是数据 `packs/security-baseline/tiers.json`。实测（本机 proot/Android，stat 很慢）：Tier1 init 7.6s / verify **3.1s**（遍历主导）、Tier2 init 0.4s / verify **190ms** |
| `supply-chain-check.mjs` | **供应链审计（离线、零依赖、跨平台）**（2026-10-10）：从 `package-lock.json` 判两类**离线可判**的高信号 ① `resolved` 指向**非预期 registry**（镜像劫持/typosquat 迹象）② **带安装钩子的包**（`hasInstallScript` ⇒ install 时执行代码）。**本地链接（`resolved: \"custom\"` 这类 workspace 包）单独跳过**——第一版把它当陌生 registry 报了假阳性，而**会狼来了的检查必然被无视**。结论只有 `clean` / `needs-review`（**不判恶意、不阻断**）。`--self-check` 双向自证（干净⇒0；陌生 registry 与安装钩子各被点名） |
| `clamd-mode.mjs` | **`clamd` 常驻的"条件自检 + 一键启用/停用"**（2026-10-10）：判定"该不该上常驻"（**内存 ≥8 GiB 且可用 ≥4 GiB** + `clamdscan` 在 PATH + `clamd` 存在 + **socket 真能连上**）；四道检查是**门槛不是建议** ⇒ 任一 fail **拒绝启用**并给原因 ✓。**不自动启**（零引用 ✓）、**不乱杀**（`--disable` 只认自己写的状态文件，杀前核对 `/proc/<pid>/comm === 'clamd'` ✓）、**不开网络端口**（生成的配置剔除 `TCPSocket`/`TCPAddr`，只留本机 socket ✓）。四道检查全做成**注入式纯函数**，`--self-check` 9 种情形 + **反向断言**（"永远可启用"的假实现实测在 7/9 用例上与期望不符 ⇒ **有分辨力**）✓。本机实测：`不可启用`（总内存 7.54 GiB < 8、可用 1.81 GiB < 4、无 `clamdscan`） |
| `subagent-inbox.mjs` | **给运行中的子代理投递消息**（方案 1，2026-10-10）：`post <id> <文本>`／`list`／`read <id> [--max N] [--consume]`／`--self-check`。存 `portable/memory/subagent/<id>.inbox.jsonl`（append-only）+ `<id>.inbox.state.json`（已读偏移）。**id 走白名单防路径穿越** ✓；**坏行跳过不崩**（fail-open ✓）。**投递机制**：父侧经**既有 RPC 的 `prompt` 通道**转发（实测**会被接受并排队**，在**下一个 turn 边界**执行 ⇒ 步骤边界语义，且**不需要**子进程加载扩展，从而**不碰**"子代理默认 `--no-extensions`"这条安全属性 ✓）。**单轮 ≤3 条**、**投递成功才标记已消费**（失败保留未读 ⇒ 宁可重复不丢 ✓）。**只转发文本**：不改工具集/不改权限/不跳过守门；注入文本标为"父会话中途指令"，**不作为系统指令、不提升优先级** ✓ |
| `patch-playwright-core.mjs` | Termux 下把 playwright-core 的 linux 分支扩展至 android（幂等） |
| `install-hooks.sh` | 启用 `.githooks/`（pre-commit → `golden --fast`；pre-push → 默认全量，仅当本次推送改动全部在 `prepush-scope.sh` 白名单内时降级 `--fast`）；本地无 CI，钩子是唯一自动防线。钩子会把完整输出 `tee` 到 `/tmp/my-pi-golden-{precommit,prepush}.log`——分步日志 `/tmp/golden-*.log` 会被下一次运行覆盖，偶发失败（实测发生过一次无法归因的拦截）需要留证据 |
| `prepush-scope.sh` | pre-push 门禁范围判定（`<remote_oid> <local_oid>` → `full`/`fast`）：只有改动全部落在 `portable/memory/stats/` 才降级快检。远端对象不可得/全 0/空 diff 一律回退全量 |
| `test-prepush-scope.sh` | 上者的守门（7 项，临时仓库造真实提交）：纯数据→fast、含代码→full、数据+代码混合→full、远端未知/新分支/空 diff/删 ref→full；接入 golden 第 17 步 |
| `vendor-bundle.sh` | vendor/pi 离线归档（`create`/`restore`/`status`）；`status` 会标注每个归档**是否含当前 PINNED_COMMIT**（只报"存在"会假安全）；bundle 不入库 |

### 留出集（held-out）：第 19/20 步**开发期间不看**

这两个真实场景（模式切换 / 两实例隔离）是**验收留出集**。纪律借鉴 SoL-Pi 的做法
（原文：*"Held-out trajectories never enter subsequent analysis, and no agent inside the auto-research loop
sees the held-out results."*），理由是**如果我们按它调参，验收就退化成"再跑一次已经看过的检查"**。

- **开发期间不看它们的结果**；只在**验收**时用 `PI_GOLDEN_SCENARIO=1` 跑（脚本在真正开跑那一刻会打印提醒）。
- **绝不为了让它们通过而修改留出集本身**（改场景脚本或改断言）。它们因真实缺陷失败 → **修实现**；
  若确有理由要改它们，须在 `DECISIONS.md` 留档并说明**为什么这不算作弊**。
- 本地开发用：`bash scripts/golden-tasks.sh --fast` + 针对改动点的定向
  `npx vitest run <相关测试文件>`。**`--fast` 与默认门禁都不会跑到留出集**，所以常规开发天然看不见它们。
- 它们**默认跳过**本来是出于连接时长约束（见上面两行的说明），但那恰好给了我们"开发时看不见"的性质——
  **这是要保持的性质，不是要顺手跑掉的东西**。

## 对外服务

| 脚本 | 用途 |
|------|------|
| `setup-external.sh` | 可选外部服务/依赖（tmux / SearXNG 原生或容器 / whisper 指引 / fd-rg shim） |
| `setup-windows-git.ps1` | **Windows/exFAT 上让 git 能操作本仓库**（每台新机器一次）：登记外层仓库与 `vendor/pi` 的 `safe.directory`（exFAT 不记录属主，git 会因 "dubious ownership" 拒读；git 有意忽略仓库自身配置，故无法随盘携带），并校验 Node 版本（>= 22.19）与构建状态。`build.sh` 在 clone `vendor/pi` 后会自动登记它，本脚本用于**首次引导之前**与体检。详见 `docs/operations/BUILD-PORTABILITY.md` §4 |
| `run-my-pi.ps1` | **Windows 终端里的启动器**：自动选对 git-bash（避开被 WSL 抢走的 `bash`）与满足 >= 22.19 的 Node，再执行 `./my-pi.sh`。Windows 终端不能直接执行 `.sh`——PowerShell 里敲 `./my-pi.sh` 不会跑 shebang，必须显式 `bash my-pi.sh`；本脚本免去这层歧义。用法：`powershell -ExecutionPolicy Bypass -File scripts\run-my-pi.ps1 [参数]` |
| `searxng-config.sh` | 生成 SearXNG `settings.yml`（禁用不可达引擎、bing 指向 cn.bing.com；`--force/--probe`） |

## 运行期自愈与运维

| 脚本 | 用途 |
|------|------|
| `web-terminal.sh` | 浏览器终端启动器：在 pty 里拉起 `my-pi.sh`，起 HTTP/WS 服务（只绑 127.0.0.1，远程走 SSH 隧道）；见 [custom/web-terminal/README.md](../custom/web-terminal/README.md) |
| `pi-supervisor.sh` | 崩溃自愈外壳（分类/修复者 pi/健康检查/熔断）；`MY_PI_NO_SUPERVISOR=1` 直启 |
| `test-supervisor.sh` | supervisor 纯函数行为测试（崩溃分类 / admin state 解析含 **ownerPid 实例隔离**与**丢失请求归属判定** / `recovery_args` / 恢复日志 / `record_round` 轮转；库模式 source + stub CLI 端到端，无需网络/provider；**111 项**） |
| `memory-store.mjs` | 记忆入库（零 LLM，直调 memory 逻辑层 `storeEntry`，内置标题去重）；`--json`/`--file`/stdin，`--dry-run`，`--source manual`（人工写入，治理层受保护；默认 `auto`＝自动流程） |
| `memory-lifecycle.mjs` | 记忆生命周期只读报告（零 LLM，调 `analyzeLifecycle`：淘汰/升格/冲突/垃圾/聚合候选）；`--json`/`--limit`；headless 下替代 `/memory lifecycle` |
| `memory-backup-prune.mjs` | **记忆备份保留策略**（2026-10-11）：`portable/memory/backups/` 会随"改动前先备份"的约定无限堆积；本脚本按**最近 N 份（默认 10）+ 最近 D 天内（默认 30）**保留，其余**目录**可清理。**默认 dry-run**，`--apply` 才真删；★ **路径守卫**：目标 resolve 后必须以 `portable/memory/backups/` 为前缀且**恰好一层**，否则**拒绝并非零退出**；**只删目录**、绝不删文件、绝不碰 `entries.json`/`notes.json`；备份目录不存在/为空 ⇒ 优雅退出。`--keep`/`--days`/`--json`，`--self-check` **双向自证**路径守卫（含"永远放行"假实现必然翻车的反证） |
| `reseed-seeds.mjs` | 把 `scheduled-seeds.json` 的定义显式应用到已存在的同名任务（种子对账只补缺失不覆盖；改提示词后用它；保留 id/enabled/lastRun/runCount/history，默认预演，`--apply` 先备份） |
| `daily-health.mjs` | 每日健康检查（**加权命中率/未命中每次/输出占比/前缀前端变更次数/首段分叉/中后段分叉/冷启动次数**/**压缩回本**（p50 回本轮数，P2）/记忆库/种子失配/守门脏改/**子代理池**（复用率与起进程次数，P9）/**子代理返工**（父级在 N 个回合内是否又改同一文件，P8-A 第二步）/**运行时状态异常与警告**（调 `lib-state-audit.mjs`，error→alert、warning→留痕）/**重启与崩溃恢复轮次计数**（recovery/rounds.jsonl）；阈值 `PI_HEALTH_HIT_FLOOR`=0.97、`PI_HEALTH_UNCACHED_CEIL`=3000、`PI_HEALTH_COLDSTART_CEIL`=8。数据源是每轮用量 `.usage-diag.jsonl` 与 `prefix-fingerprints.jsonl`——**不要改用工具级台账 `usage.jsonl`**，它没有缓存字段，会让命中率恒为 n/a） |
| `knowledge-fetch.py` | 知识源抓取（落 `portable/memory/knowledge/`） |
| `knowledge-ingest.mjs` | 知识订阅入库（零 LLM，`storeEntry` 内置去重） |
| `tool-stats-sync.mjs` | 工具使用统计汇总（`usage.jsonl` → 跨设备计数） |
| `task-summarizer.mjs` | 任务记录批量总结（游标聚合 → digest，`--spawn` 可选入库） |
| `sync-memory.sh` | 记忆/选定会话的 age 加密同步（`init/push/pull/verify/status`）；`verify` 校验可解密性 + `age.pub` 与私钥一致性 + 清单一致 + JSON 有效，`--no-key` 仅查密文完整性 |

## 相关

- 脚本清单与职责总览：[../STRUCTURE.md](../STRUCTURE.md)
- 构建/同步/体检深入：[../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)

## 外部依赖（非 npm，需手动安装）

本目录下有两个 Python 脚本，它们的可选外部依赖**不在 npm/package.json 里**，
缺了不影响主流程，但相关子命令会降级或跳过：

| 依赖 | 用途 | 缺了会怎样 | 安装 |
|---|---|---|---|
| **PyMuPDF** | `books.py` 解析 PDF（页数/目录/文字层；`probe` / `index` / `read`） | `selftest` **跳过**并说明；PDF 类子命令不可用 | `python3 -m pip install pymupdf` |
| **tesseract** | `books.py` 的 OCR（扫描件按需识别） | 扫描件提取跳过（自检里已有对应用例断言"缺则跳过"） | 系统包：`apt install tesseract-ocr` / Windows 装 UB-Mannheim 版 |

> 注意 PyMuPDF 有两个导入名（新版 `pymupdf`、旧名 `fitz`），`books.py` 依次尝试。
> 两者都缺时抛 `MissingPdfLib`，是**可预期的降级**，不是崩溃。
