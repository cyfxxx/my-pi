# my-pi 目录结构说明

## 顶层目录

```
my-pi/
├── vendor/
│   ├── pi/              # 上游 Pi 代码（独立 git clone，主仓库 .gitignore 排除）
│   └── PINNED_COMMIT    # vendor 锁定的上游 commit（引导用）
├── custom/              # my-pi 的自定义代码
├── portable/            # my-pi 的运行时数据/配置（所有用户数据收敛于此，无 .pi 目录）
├── packs/               # 外部技能包仓库（迁移自 pi-tools，按需读取，不注入系统提示词）
├── docs/                # 项目文档（使用/开发/运维）
├── deploy/              # 可选系统级部署产物（systemd 等）
├── patches/             # 上游补丁
├── scripts/             # 32 个运维脚本（含共享库 lib-vendor.sh）
├── my-pi.sh             # 便携启动脚本
├── package.json         # 依赖和 piConfig 配置
├── README.md            # 项目简介
└── STRUCTURE.md         # 本文件
```

## 各目录职责

### `vendor/pi/`
上游 Pi 代码，**独立 git clone**，由主仓库 `.gitignore` 排除（不纳入主仓库版本控制）。
**永不直接修改**，所有改动通过 `patches/` 管理。

- 上游 remote：`upstream` = `https://github.com/earendil-works/pi-mono.git`
- 锁定 commit：`vendor/PINNED_COMMIT`（当前 `d201760ff`，版本 v0.87.0）
- `LAST_SYNC_POINT`：上次同步的上游 commit SHA
- 本地补丁以 commit 形式叠加在上游之上；通过 `scripts/sync-upstream.sh` 更新

**引导（fresh checkout）**：`vendor/pi` 不随主仓库分发。克隆主仓库后运行 `scripts/build.sh`
会自动安装根工作区依赖、从上游 clone、checkout `PINNED_COMMIT`、幂等应用并提交 `patches/`、
构建 vendor 工作区（含模型数据生成；等价的一次性入口，新设备可复现）。也可手动：

```bash
git clone https://github.com/earendil-works/pi-mono.git vendor/pi
git -C vendor/pi checkout "$(cat vendor/PINNED_COMMIT)"
for p in patches/*.patch; do git -C vendor/pi apply --3way "$p"; done
```

> 补丁以本地 commit 形式落盘，使 vendor 工作树保持干净（`check-isolation` 要求）；
> `scripts/sync-upstream.sh` 据此在更新上游后自动 merge + 补齐补丁 + 重建 dist + 刷新自愈缓存。
> 环境体检与缺口修复用 `bash scripts/doctor.sh [--fix]`。

### `custom/`
my-pi 的自定义代码。三层结构：

- `adapters/`：唯一允许 runtime import `vendor/pi/` 的地方（`import type` 除外）
- `core/`：路径解析、功能注册表，以及纯工具 `secrets.ts`（脱敏）、`atomic-write.ts`（原子写）、`net-guard.ts`（SSRF 防护）
- `features/`：每个功能必须包含 `logic.ts`（纯逻辑出口/barrel，零 Pi 依赖）和 `index.ts`（通过 adapter 注册）；`__tests__/` 为 vitest 单测
  - 小功能直接把模块铺在功能根目录（如 `tmux/logic.ts`、`browser/impl.ts`）
  - 大功能在功能根下按职责建一层子包，`logic.ts` 仅作 barrel：`memory/{store,recall,mine}`、`voice/{audio,stt,tts}`、`autopilot/{store,run,tools}`、`subagent/{core,ui}`、`plan-mode/{core,ui}`、`context/{budget,usage-diag}`、`web-search/{config,search,fetch,concurrency}`、`link/{types,config,net,card,guards,state,display,protocol}`
  - 子包内互引用用相对路径；跨功能引用只走对方 `logic.ts`
- `bootstrap.ts`：入口，组装所有功能
- 另有 `package.json`、`tsconfig.json`（工作区与编译配置），`dist/`（构建产物，gitignored）

运行测试：`npm test`（vitest）。

### `portable/`
运行时数据与配置。2 个目录：

- `agent/`：**pi 的运行时根目录（agentDir，`PI_CODING_AGENT_DIR` 指向此处）**，几乎所有运行时数据都在其下：
  - `settings.json`、`AGENTS.md`、`APPEND_SYSTEM.md`、`keybindings.json`：跟踪的共享配置
  - `skills/`：**技能目录**（pi 从 `agentDir/skills` 自动发现；`settings.json` 的 `"skills"` 数组是相对 `agentDir` 的覆盖模式，如 `+skills/pi-backup/SKILL.md`）。随仓库分发，已在 `.gitignore` 加白名单
  - `sessions/`：会话历史（`sessions/<转义 cwd>/*.jsonl`，pi 自动创建，不入库）
  - `extensions/`：第三方扩展目录（`agentDir/extensions` 自动发现，放 `<name>/index.ts` 即生效）
  - `npm/`、`git/`：`./my-pi.sh install` 安装的 npm / git 扩展包（来源记入 `settings.json` 的 `packages`）
  - `auth.json`、`models.json`、`models-store.json`、`trust.json`、`pi-link-*.json`：每环境独立、不入库（`modes.json`、`scheduled-seeds.json` 已白名单入库）
- `memory/`：my-pi 自定义功能的数据（memory 功能的 `notes.json`、`checkpoints/`，以及工具输出归档 `tool-outputs/`）

`my-pi.sh` / `scripts/dev.sh` 只导出 `PI_CODING_AGENT_DIR`（pi 识别）与 `PI_MEMORY_DIR`（`custom/` 识别）；项目根不再有 `.pi/` 目录。

### `packs/`
外部技能包仓库（迁移自 pi-tools）。每个包是 `packs/<name>/SKILL.md` 入口 + 附属资源（`bin/`、`references/`、`workflows/`、`skills/` 等），部分包自带二级技能。

**不注入系统提示词**：packs 不放入 `portable/agent/skills/`，需要时按需读取 `packs/<name>/SKILL.md`（防提示词膨胀）。索引见 `packs/INDEX.md`，约定与整合纪律见 `packs/README.md`。

### `docs/`
项目文档，按读者任务分类：`FAQ.md`/`TROUBLESHOOTING.md`（使用与排障）、`design/`（愿景与落地路线）、`development/`（扩展与 SDK 开发、技能维护、迁移审计与上下文对比）、`operations/`（多环境、Termux、终端/tmux）。索引与来源说明见 `docs/README.md`。

### `patches/`
对 `vendor/pi/` 的补丁。每个补丁记录一个明确的修改：

- `001-branding.patch`：品牌化（`package.json` name/piConfig）
- `002-local-pi-mods.patch`：本地 pi 源码改动（config 项目级 `.pi` 发现、secrets 脱敏、离线跳过 model-data 校验、tsconfig 排除 src/custom、packages/README）
- `003-tab-completion-fix.patch`：`handleTabCompletion` 斜杠命令上下文统一走 `handleSlashCommandCompletion()`，使子命令参数补全在 Tab 时可见
- `004-footer-tweaks.patch`：TUI footer 四项调整（实时上下文 token、双指标着色、CH 实时/会话命中率、`Σ/↑/↓` 字段与 `¥` 成本、>40% `⚠` 重启提示）
- `005-footer-speed-and-scrollback.patch`：输出速度并入 footer stats 行；regular 模式不再清空 scrollback
- `006-footer-cost-and-cache-window.patch`：成本汇率与缓存命中率窗口调整（20 轮）

### `scripts/`
共 32 个运维脚本（含 1 个共享库 `lib-vendor.sh`；另有 4 个非脚本文件：`README.md`、`dead-exports-allowlist.txt`、`registration-baseline.json`、`task-summarizer.d.mts` 类型声明）：

- `build.sh`：一键重建/引导（Node 检查 → 根依赖 `npm ci` → vendor 引导与补丁幂等提交 → 工作区按依赖顺序构建（模型数据缺失时联网生成）；可选 fd-rg shim / 自愈缓存）；`custom/` 不编译，由 pi 的扩展加载器直接加载 TypeScript
- `doctor.sh`：本地环境 vs 仓库体检（依赖/vendor/补丁/dist 新鲜度/自愈缓存/shim/外部工具/类型/本地 vs origin），`--fix` 自动修复可修复项，`--full`/`--no-net`
- `dev.sh`：开发模式运行（优先 vendor 内置 tsx）
- `sync-upstream.sh`：上游同步 + 自动修复（merge → 幂等补丁 → 重建 dist → 刷新自愈缓存 → 类型检查；`PI_SYNC_DRY_RUN=1` 只读预演）
- `lib-vendor.sh`：被 build/sync/doctor source 的共享逻辑（补丁幂等应用、依赖一致性判断）
- `check-isolation.sh`：验证隔离边界
- `check-features.sh`：功能完整性（12 功能目录 + 生成式注册面基线 + 适配器 API + 钩子事件 + 配置/脚本/补丁）
- `gen-registrations.mjs`：从代码生成/校验注册面基线（`registration-baseline.json`；`--update` 刷新）——替代原先手写清单，防漂移
- `check-dead-exports.mjs`：死导出守门（抓"写了没接线"，如曾经的 `pruneThinkingBudget`），白名单见 `dead-exports-allowlist.txt`
- `check-patches-behavior.mjs`：补丁"行为存在性"守门（断言补丁关键符号/自标记仍在 vendor 源码，防上游同步语义漂移）
- `check-seeds-headless.mjs`：定时任务提示词的 headless 可用性守门（提示词里不得引用 `--no-extensions` 下不存在的扩展工具/斜杠命令，如 `memory_store`、`/memory`）
- `run-ts.sh`：以 vendor tsx 运行「需要加载 my-pi TypeScript 逻辑」的脚本（`custom/` 用无扩展名导入，Node 类型剥离解析不了，必须走 tsx）——headless 里写记忆/入库的唯一入口
- `memory-store.mjs`：记忆入库（零 LLM，直接调 memory 逻辑层 `storeEntry`，内置标题去重）；`--json`/`--file`/stdin，`--dry-run`
- `reseed-seeds.mjs`：把 `scheduled-seeds.json` 的种子定义显式应用到已存在的同名任务（种子对账是「只补缺失不覆盖」，改提示词后需本脚本；保留 id/enabled/lastRun/runCount/history，默认预演，`--apply` 先备份）
- `install-hooks.sh`：启用 `.githooks/`（pre-commit 跑 `golden --fast`，pre-push 跑全量；本地无 CI，钩子是唯一自动防线）
- `vendor-bundle.sh`：vendor/pi 离线归档 `create|restore|status`（bundle 不入库，`doctor` 会提示缺失）
- `check-injection-surface.sh`：system prompt 注入面前缀指纹基线守门（`--update` 更新基线）
- `check-doc-links.mjs`：文档内部相对链接一致性校验
- `golden-tasks.sh`：行为防退化基准（隔离/注册面/死导出/类型/单测/补丁/补丁行为/注入面/文档/supervisor/定时任务提示词；`--fast` 跳过 tsc+vitest，`--smoke` 追加无头冒烟）
- `patch-playwright-core.mjs`：Termux 下把 playwright-core 的 linux 平台分支扩展至 android（幂等）
- `setup-external.sh`：可选外部服务/依赖（tmux / SearXNG 原生或容器 / whisper 指引 / fd-rg shim）
- `searxng-config.sh`：生成 SearXNG `settings.yml`（禁用不可达引擎、bing 指向 cn.bing.com；`--force/--probe`）
- `pi-supervisor.sh` / `pi-source-build.sh`：崩溃自愈外壳与源码缓存构建（`--no-build` 仅缓存现有 dist）
- `test-supervisor.sh`：supervisor 纯函数行为测试（崩溃分类 / admin state 解析；库模式 source，无需网络/provider）
- `daily-health.mjs`：每日健康检查（命中率/记忆库/种子失配/守门脏改）
- `memory-lifecycle.mjs`：记忆生命周期只读报告（零 LLM，调 `analyzeLifecycle` 出淘汰/升格/冲突/垃圾/聚合五类候选；`--json`/`--limit`；供 `daily-review` 定时任务消费，headless 下无 `/memory lifecycle` 命令）
- `knowledge-fetch.py`：知识源抓取（落 `portable/memory/knowledge/`）
- `knowledge-ingest.mjs`：知识订阅入库（零 LLM，`storeEntry` 内置去重）
- `tool-stats-sync.mjs`：工具使用统计汇总（`usage.jsonl` → 跨设备计数）
- `task-summarizer.mjs`：任务记录批量总结（游标聚合 → digest，`--spawn` 可选入库）
- `sync-memory.sh`：记忆/会话的 age 加密同步（`init/push/pull/verify/status`；`verify` 校验可解密性、公钥一致性、清单一致与 JSON 有效）

## 数据流向

```
my-pi.sh
  ↓ 设置环境变量
PI_CODING_AGENT_DIR=portable/agent   # pi 识别（agentDir：技能/会话/扩展都在其下）
PI_MEMORY_DIR=portable/memory         # custom/ 识别（core/config.ts 的 getMemoryDir）
  ↓ 启动
vendor/pi/packages/coding-agent/dist/cli.js
  ↓ 加载
custom/bootstrap.ts
  ↓ 注册
custom/features/*/index.ts
  ↓ 调用
custom/features/*/logic.ts
```

## 目录内文档

各代码目录附有就近说明文档（`README.md`），读者无需回到根文档即可了解该层职责与约定：

- `custom/core/README.md`、`custom/adapters/README.md`、`custom/features/README.md`：三层底座与规范
- `custom/features/<功能>/README.md`：全部 12 个功能的注册面、文件、数据与配置
- 大功能的子包：`context/{budget,usage-diag}/`、`autopilot/{store,run,tools}/`、`memory/{store,recall,mine}/`、`plan-mode/{core,ui}/`、`subagent/{core,ui}/`、`voice/{audio,stt,tts}/` 各自有 `README.md`
- 语音服务脚本（whisper/sherpa）随仓库分发在 `custom/features/voice/scripts/`，见 `custom/features/voice/README.md`
- `scripts/README.md`：运维脚本分类索引

## 已知偏离

- **pi 只识别 `PI_CODING_AGENT_DIR` 与 `PI_PACKAGE_DIR`**（vendor/pi v0.87.0 `config.ts`）：不存在 `PI_SKILLS_DIR`/`PI_EXTENSION_DIR`；会话目录的可覆盖变量是 `PI_CODING_AGENT_SESSION_DIR`（或 `--session-dir`）。my-pi 因此统一用 `portable/agent/`（agentDir）承载技能、会话与扩展，启动器不再导出无效变量。
- **项目级配置目录是 `.pi` 而非 `.my-pi`**：`CONFIG_DIR_NAME` 取自运行时加载的 `vendor/pi/packages/coding-agent/package.json` 的 `piConfig.configDir`（值为 `.pi`），根 `package.json` 的 `.my-pi` 不参与运行时。故项目级设置/项目级扩展会落在 `<cwd>/.pi/`——my-pi 不使用项目级资源，`pi install` 也应避免 `-l/--local`。
- **会话默认在 `portable/agent/sessions/`**：即 `agentDir/sessions/<转义 cwd>/`。若希望会话与配置分离，可在启动器加 `--session-dir "$MY_PI_ROOT/portable/sessions"`（当前未启用）。

## 平台支持

- **一等目标**：Linux（含 **Termux/Android**，`scripts/patch-playwright-core.mjs` 做 playwright-core android 适配）与 macOS。
- **Windows：仅经 WSL2**。不提供原生单目录便携部署（pi-tools 的 `start.ps1`/`bin/*.ps1`/`tools/tmux/tmux.cmd`/`ca-bundle.crt` 已随 `portable/` 改作运行时数据而移除）；仓库根只有 POSIX 启动器 `my-pi.sh`（bash），原生 Windows shell 不适用。
- 保留的最小 Windows 感知：`features/link/net.ts` 的 WSL 检测（走 `ipconfig.exe` 取物理网卡 IP）、`features/voice` 的 Windows 录音分支判定（能力缺失时明确报错）。dshow 录音、PowerShell 引导、原生 tmux 后端不再补齐。
- 决策记录见 [DECISIONS.md](DECISIONS.md) 的「平台范围」条目。

## 便携性保证

- 所有数据在 `portable/` 下，跟随项目移动
- 无符号链接，跨平台兼容（POSIX：Linux/Termux/macOS）
- `my-pi.sh` 动态解析项目根目录
