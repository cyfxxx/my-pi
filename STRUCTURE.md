# my-pi 目录结构说明

## 顶层目录

```
my-pi/
├── .pi/                 # Pi 运行时配置文件（不含代码、不含数据、不含符号链接）
├── vendor/pi/           # 上游 Pi 代码（只读；当前由主仓库追踪，见「已知偏离」）
├── custom/              # my-pi 的自定义代码
├── portable/            # my-pi 的运行时数据（所有用户数据收敛于此）
├── patches/             # 上游补丁
├── scripts/             # 4 个运维脚本
├── my-pi.sh             # 便携启动脚本
├── package.json         # 依赖和 piConfig 配置
├── README.md            # 项目简介
└── STRUCTURE.md         # 本文件
```

## 各目录职责

### `.pi/`
Pi 运行时需要的配置文件。**只放配置，不放代码、不放数据、不放符号链接**。

包含：`settings.json`、`keybindings.json`、`models-store.json`、`AGENTS.md`、`APPEND_SYSTEM.md`。

### `vendor/pi/`
上游 Pi 代码。**永不修改**。所有修改通过 `patches/` 管理。

- `LAST_SYNC_POINT`：上次同步的上游 commit SHA（当前为 `5afd80c65`，即 vendored 基线的最后一个上游提交）
- 通过 `scripts/sync-upstream.sh` 更新

> **已知偏离**：目标设计为 `vendor/pi/` 作为独立 git clone、由主仓库 `.gitignore` 排除。
> 当前环境无法从 GitHub 克隆（clone 超时，仅 `ls-remote` 元数据可用），且项目需在
> 多设备间同步，因此 `vendor/pi/` 仍由主仓库追踪。`scripts/sync-upstream.sh` 会检测
> 这一状态并拒绝执行（避免误操作主仓库）。详见 `DECISIONS.md`。

### `custom/`
my-pi 的自定义代码。三层结构：

- `adapters/`：唯一允许 runtime import `vendor/pi/` 的地方（`import type` 除外）
- `core/`：路径解析、功能注册表
- `features/`：每个功能包含 `logic.ts`（纯逻辑，零 Pi 依赖）和 `index.ts`（通过 adapter 注册）
- `bootstrap.ts`：入口，组装所有功能
- 另有 `package.json`、`tsconfig.json`（工作区与编译配置），`dist/`（构建产物，gitignored）

### `portable/`
运行时数据。5 个目录：

- `config/`：配置数据
- `sessions/`：会话历史
- `extensions/`：扩展安装目录
- `skills/`：技能目录
- `memory/`：记忆数据

通过 `my-pi.sh` 中的环境变量重定向到此。

### `patches/`
对 `vendor/pi/` 的补丁。每个补丁记录一个明确的修改。

### `scripts/`
仅 4 个脚本：

- `build.sh`：构建 vendor/pi 和 custom/
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
