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
├── patches/             # 上游补丁
├── scripts/             # 13 个运维脚本
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
- 锁定 commit：`vendor/PINNED_COMMIT`（当前 `71dca871b`，版本 v0.85.1）
- `LAST_SYNC_POINT`：上次同步的上游 commit SHA
- 本地补丁以 commit 形式叠加在上游之上；通过 `scripts/sync-upstream.sh` 更新

**引导（fresh checkout）**：`vendor/pi` 不随主仓库分发。克隆主仓库后运行 `scripts/build.sh`
会自动从上游 clone 并 checkout `PINNED_COMMIT`、应用 `patches/`；也可手动：

```bash
git clone https://github.com/earendil-works/pi-mono.git vendor/pi
git -C vendor/pi checkout "$(cat vendor/PINNED_COMMIT)"
for p in patches/*.patch; do git -C vendor/pi apply --3way "$p"; done
```

### `custom/`
my-pi 的自定义代码。三层结构：

- `adapters/`：唯一允许 runtime import `vendor/pi/` 的地方（`import type` 除外）
- `core/`：路径解析、功能注册表，以及纯工具 `secrets.ts`（脱敏）、`atomic-write.ts`（原子写）、`net-guard.ts`（SSRF 防护）
- `features/`：每个功能必须包含 `logic.ts`（纯逻辑出口/barrel，零 Pi 依赖）和 `index.ts`（通过 adapter 注册）；`__tests__/` 为 vitest 单测
  - 小功能直接把模块铺在功能根目录（如 `web-search/logic.ts`、`browser/impl.ts`）
  - 大功能在功能根下按职责建一层子包，`logic.ts` 仅作 barrel：`memory/{store,recall,mine}`、`voice/{audio,stt,tts}`、`autopilot/{store,run}`、`subagent/{core,ui}`、`plan-mode/{core,ui}`、`context/budget`
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
  - `auth.json`、`models.json`、`models-store.json`、`modes.json`、`trust.json`、`pi-link-*.json`、`scheduled-seeds.json`：每环境独立、不入库
- `memory/`：my-pi 自定义功能的数据（note-store 的 `notes.json`、`checkpoints/`，以及工具输出归档 `tool-outputs/`）

`my-pi.sh` / `scripts/dev.sh` 只导出 `PI_CODING_AGENT_DIR`（pi 识别）与 `PI_MEMORY_DIR`（`custom/` 识别）；项目根不再有 `.pi/` 目录。

### `packs/`
外部技能包仓库（迁移自 pi-tools）。每个包是 `packs/<name>/SKILL.md` 入口 + 附属资源（`bin/`、`references/`、`workflows/`、`skills/` 等），部分包自带二级技能。

**不注入系统提示词**：packs 不放入 `portable/agent/skills/`，需要时按需读取 `packs/<name>/SKILL.md`（防提示词膨胀）。索引见 `packs/INDEX.md`，约定与整合纪律见 `packs/README.md`。

### `docs/`
项目文档，按读者任务分类：`FAQ.md`/`TROUBLESHOOTING.md`（使用与排障）、`development/`（扩展与 SDK 开发、技能维护）、`operations/`（多环境、Termux、终端/tmux）。索引与来源说明见 `docs/README.md`。

### `patches/`
对 `vendor/pi/` 的补丁。每个补丁记录一个明确的修改：

- `001-branding.patch`：品牌化（`package.json` name/piConfig）
- `002-local-pi-mods.patch`：本地 pi 源码改动（config 项目级 `.pi` 发现、secrets 脱敏、Google TOO_MANY_TOOL_CALLS、离线跳过 model-data 校验、tsconfig 排除 src/custom、packages/README）
- `003-tab-completion-fix.patch`：`handleTabCompletion` 斜杠命令上下文统一走 `handleSlashCommandCompletion()`，使子命令参数补全在 Tab 时可见

### `scripts/`
仅 10 个脚本：

- `build.sh`：构建 vendor/pi（vendor 缺失时自动引导）；`custom/` 不编译，由 pi 的扩展加载器直接加载 TypeScript
- `dev.sh`：开发模式运行
- `sync-upstream.sh`：从上游同步
- `check-isolation.sh`：验证隔离边界
- `check-features.sh`：对照 pi-tools 注册面检查工具/命令/快捷键/钩子/补丁完整性
- `setup-external.sh`：可选外部服务/依赖（tmux / SearXNG 容器 / whisper 指引 / fd-rg 链接）
- `patch-playwright-core.mjs`：Termux 下把 playwright-core 的 linux 平台分支扩展至 android（幂等）
- `golden-tasks.sh`：行为防退化基准（隔离/注册面/类型/单测/补丁/注入面，`--smoke` 追加无头冒烟）
- `check-injection-surface.sh`：system prompt 注入面前缀指纹基线守门（`--update` 更新基线）
- `check-doc-links.mjs`：文档内部相对链接一致性校验

## 数据流向

```
my-pi.sh
  ↓ 设置环境变量
PI_CODING_AGENT_DIR=portable/agent   # pi 识别（agentDir：技能/会话/扩展都在其下）
PI_MEMORY_DIR=portable/memory         # custom/ 的 note-store 识别
  ↓ 启动
vendor/pi/packages/coding-agent/dist/cli.js
  ↓ 加载
custom/bootstrap.ts
  ↓ 注册
custom/features/*/index.ts
  ↓ 调用
custom/features/*/logic.ts
```

## 已知偏离

- **pi 只识别 `PI_CODING_AGENT_DIR` 与 `PI_PACKAGE_DIR`**（vendor/pi v0.85.1 `config.ts`）：不存在 `PI_SKILLS_DIR`/`PI_EXTENSION_DIR`；会话目录的可覆盖变量是 `PI_CODING_AGENT_SESSION_DIR`（或 `--session-dir`）。my-pi 因此统一用 `portable/agent/`（agentDir）承载技能、会话与扩展，启动器不再导出无效变量。
- **项目级配置目录是 `.pi` 而非 `.my-pi`**：`CONFIG_DIR_NAME` 取自运行时加载的 `vendor/pi/packages/coding-agent/package.json` 的 `piConfig.configDir`（值为 `.pi`），根 `package.json` 的 `.my-pi` 不参与运行时。故项目级设置/项目级扩展会落在 `<cwd>/.pi/`——my-pi 不使用项目级资源，`pi install` 也应避免 `-l/--local`。
- **会话默认在 `portable/agent/sessions/`**：即 `agentDir/sessions/<转义 cwd>/`。若希望会话与配置分离，可在启动器加 `--session-dir "$MY_PI_ROOT/portable/sessions"`（当前未启用）。

## 便携性保证

- 所有数据在 `portable/` 下，跟随项目移动
- 无符号链接，跨平台兼容
- `my-pi.sh` 动态解析项目根目录
