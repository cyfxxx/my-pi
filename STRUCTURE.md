# my-pi 目录结构说明

## 顶层目录

```
my-pi/
├── vendor/
│   ├── pi/              # 上游 Pi 代码（独立 git clone，主仓库 .gitignore 排除）
│   └── PINNED_COMMIT    # vendor 锁定的上游 commit（引导用）
├── custom/              # my-pi 的自定义代码
├── portable/            # my-pi 的运行时数据/配置（所有用户数据收敛于此，无 .pi 目录）
├── patches/             # 上游补丁
├── scripts/             # 4 个运维脚本
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
- `core/`：路径解析、功能注册表，以及纯工具 `secrets.ts`（脱敏）、`atomic-write.ts`、`note-store.ts`（笔记持久化）
- `features/`：每个功能包含 `logic.ts`（纯逻辑，零 Pi 依赖）和 `index.ts`（通过 adapter 注册）；`context/` 含 token 预算模块，`__tests__/` 为 vitest 单测
- `bootstrap.ts`：入口，组装所有功能
- 另有 `package.json`、`tsconfig.json`（工作区与编译配置），`dist/`（构建产物，gitignored）

运行测试：`npm test`（vitest）。

### `portable/`
运行时数据与配置。5 个目录：

- `config/`：**Pi 运行时配置目录**（`PI_CODING_AGENT_DIR` 指向此处）。含 `settings.json`、`AGENTS.md`、`APPEND_SYSTEM.md`、`keybindings.json` 等；`models.json`/`auth.json`/`modes.json`/`trust.json` 等每环境独立、不入库
- `sessions/`：会话历史
- `extensions/`：扩展安装目录
- `skills/`：技能目录
- `memory/`：记忆数据

通过 `my-pi.sh` / `scripts/dev.sh` 中的环境变量重定向到此；项目根不再有 `.pi/` 目录。

### `patches/`
对 `vendor/pi/` 的补丁。每个补丁记录一个明确的修改：

- `001-branding.patch`：品牌化（`package.json` name/piConfig）
- `002-local-pi-mods.patch`：本地 pi 源码改动（config 项目级 `.pi` 发现、secrets 脱敏、Google TOO_MANY_TOOL_CALLS、离线跳过 model-data 校验、tsconfig 排除 src/custom、packages/README）

### `scripts/`
仅 4 个脚本：

- `build.sh`：构建 vendor/pi 和 custom/（vendor 缺失时自动引导）
- `dev.sh`：开发模式运行
- `sync-upstream.sh`：从上游同步
- `check-isolation.sh`：验证隔离边界

## 数据流向

```
my-pi.sh
  ↓ 设置环境变量
PI_CODING_AGENT_DIR=portable/config
PI_SESSION_DIR=portable/sessions
PI_EXTENSION_DIR=portable/extensions
PI_SKILLS_DIR=portable/skills
PI_MEMORY_DIR=portable/memory
  ↓ 启动
vendor/pi/packages/coding-agent/dist/cli.js
  ↓ 加载
custom/bootstrap.ts
  ↓ 注册
custom/features/*/index.ts
  ↓ 调用
custom/features/*/logic.ts
```

## 便携性保证

- 所有数据在 `portable/` 下，跟随项目移动
- 无符号链接，跨平台兼容
- `my-pi.sh` 动态解析项目根目录
