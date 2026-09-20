# my-pi 项目环境描述

my-pi 是基于 pi 框架的私人 AI 助手（硬分叉）。本目录 `.pi/` 是 **Pi 运行时配置目录**，只放配置，不放代码、不放数据、不放符号链接。

## 目录结构

```
.pi/                       # 运行时配置（settings/models/auth/keybindings/AGENTS 等）
portable/                  # 运行时数据（config/sessions/extensions/skills/memory）
vendor/pi/                 # 上游 Pi 代码（只读）
custom/                    # 自定义层（adapters/core/features/bootstrap.ts）
scripts/                   # 4 个运维脚本
patches/                   # 上游补丁
```

## 分层架构

```
Layer 3 ─ 功能层 ───────────── custom/features/（12 个扩展，logic.ts 零 Pi 依赖）
    ↑
Layer 2 ─ 适配器层 ─────────── custom/adapters/（唯一允许 import vendor/pi）
    ↑
Layer 1 ─ 服务层 ───────────── custom/core/（config 路径解析、registry 注册表）
    ↑
Layer 0 ─ 基础层 ───────────── vendor/pi/（上游代码，永不修改）
```

**依赖规则**：`features/*/logic.ts` 零 Pi 依赖；仅 `adapters/` 可 runtime import `vendor/pi`（`import type` 除外）。

## 关键配置

### PI_CODING_AGENT_DIR

pi 通过此环境变量定位配置目录，默认 `~/.pi/agent`。my-pi 由 `my-pi.sh` / `scripts/dev.sh` 重定向到项目 `portable/`：

```bash
export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/config"
export PI_SESSION_DIR="$MY_PI_ROOT/portable/sessions"
export PI_EXTENSION_DIR="$MY_PI_ROOT/portable/extensions"
export PI_SKILLS_DIR="$MY_PI_ROOT/portable/skills"
export PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"
```

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
bash scripts/build.sh              # 构建 vendor/pi(coding-agent) 与 custom/
./my-pi.sh                         # 便携启动
bash scripts/sync-upstream.sh      # 上游同步（要求 vendor/pi 为独立 git 仓库）
```

构建后运行 `npm run build`。修订代码后运行 `npm run check`。

## 深度文档

| 主题 | 文档 |
|------|------|
| 目录结构说明 | `STRUCTURE.md` |
| 架构进度 | `PROGRESS.md` |
| 架构决策 | `DECISIONS.md` |
| 项目总览 | `README.md` |
| Pi 官方文档 | https://pi.dev/docs/latest |
