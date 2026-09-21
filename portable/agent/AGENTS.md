# my-pi 项目环境描述

my-pi 是基于 pi 框架的私人 AI 助手（硬分叉）。本目录 `portable/agent/` 是 **pi 的运行时根目录（agentDir，由 `PI_CODING_AGENT_DIR` 指向）**。按 pi 的 agentDir 约定，这里除配置外还承载**技能（`skills/`）、会话（`sessions/`）与安装的扩展（`extensions/`、`npm/`、`git/`）**。

边界是：**my-pi 自身的代码不放此处**（代码在 `custom/`，改动经 `adapters/` 接入），此处也不放任何符号链接。

## 目录结构

```
portable/agent/           # pi 的运行时根目录（agentDir）：配置 + 技能 + 会话 + 扩展
portable/agent/skills/    # 技能目录（pi 从 agentDir/skills 发现，随仓库分发）
portable/memory/           # 自定义功能数据（note-store 笔记、工具输出归档）
vendor/pi/                 # 上游 Pi 代码（独立 clone，只读）
custom/                    # 自定义层（adapters/core/features/bootstrap.ts）
packs/                     # 外部技能包（按需读取，不注入系统提示词）
docs/                      # 项目文档
scripts/                   # 10 个运维脚本
patches/                   # 上游补丁
```

## 分层架构

```
Layer 3 ─ 功能层 ───────────── custom/features/（12 个扩展，logic.ts 为纯逻辑出口；大功能按职责分子包）
    ↑
Layer 2 ─ 适配器层 ─────────── custom/adapters/（唯一允许 import vendor/pi）
    ↑
Layer 1 ─ 服务层 ───────────── custom/core/（config 路径解析、registry 注册表）
    ↑
Layer 0 ─ 基础层 ───────────── vendor/pi/（上游代码，永不修改）
```

**依赖规则**：`features/` 的逻辑层（`index.ts` 与 `__tests__/` 除外）零 Pi 依赖；仅 `adapters/` 可 runtime import `vendor/pi`（`import type` 除外）。
大功能的实现按职责分组（`memory/{store,recall,mine}`、`voice/{audio,stt,tts}`、`autopilot/{store,run}`、`subagent/{core,ui}`、`plan-mode/{core,ui}`、`context/budget`），`logic.ts` 仅作 barrel。

## 关键配置

### PI_CODING_AGENT_DIR

pi 通过此环境变量定位运行时根目录（agentDir），默认 `~/.pi/agent`。my-pi 由 `my-pi.sh` / `scripts/dev.sh` 指向 `portable/agent`：

```bash
export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/agent"   # pi 识别（agentDir）
export PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"         # custom/ 的 note-store 识别
```

**运行时数据布局**：pi 只识别 `PI_CODING_AGENT_DIR`（另有 `PI_PACKAGE_DIR`），技能/会话/扩展都挂在 agentDir 下，因此：

- 技能：`portable/agent/skills/`（= `agentDir/skills`，随仓库分发）；`settings.json` 的 `"skills"` 数组是相对 `agentDir` 的覆盖模式（如 `+skills/pi-backup/SKILL.md`）
- 会话：`portable/agent/sessions/<转义 cwd>/*.jsonl`
- 第三方扩展：`portable/agent/extensions/`（自动发现）或 `./my-pi.sh install` 装入 `portable/agent/{npm,git}/`
- 自定义功能数据：`portable/memory/`（`PI_MEMORY_DIR`；工具输出归档走 `PI_OUTPUT_ARCHIVE_DIR`，默认 `portable/memory/tool-outputs/`）

运行时数据全部收敛到 `portable/`，实现便携（U 盘即插即用，无符号链接）。

## 关键约定

- **上游隔离**：`vendor/pi/` 不直接修改，改动通过 `patches/` 记录。
- **接口隔离**：Pi API 只出现在 `custom/adapters/`。
- **缓存友好**：system prompt 注入禁止时间戳/精确数值。
- **git 提交**：暂存显式路径，只提交本次会话更改的文件；不提交 `auth.json` 等敏感配置。

## 验证与命令

```bash
npm run check                      # 隔离边界验证（scripts/check-isolation.sh）
npx tsc --noEmit -p custom/        # 自定义层类型检查
bash scripts/dev.sh                # 开发模式（tsx 直接运行 TS）
bash scripts/build.sh              # 构建 vendor/pi(coding-agent)；vendor 缺失时自动引导（custom/ 不编译）
./my-pi.sh                         # 便携启动
bash scripts/sync-upstream.sh      # 上游同步（vendor/pi 为独立 git clone，上游 earendil-works/pi-mono）
```

修订代码后运行 `npm run check`；类型检查用 `npx tsc --noEmit -p custom/`。

## 深度文档

| 主题 | 文档 |
|------|------|
| 文档索引 | `docs/README.md` |
| 目录结构说明 | `STRUCTURE.md` |
| 架构进度 | `PROGRESS.md` |
| 架构决策 | `DECISIONS.md` |
| 项目总览 | `README.md` |
| 外部技能包 | `packs/README.md` |
| Pi 官方文档 | https://pi.dev/docs/latest |
