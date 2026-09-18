# Pi 项目环境描述

Pi 本地配置仓库：自定义扩展、共享库、技能、生命周期脚本。

## 目录结构

```
core/             Layer 0 基础层（config, registry, hook-registry, secrets）
services/         Layer 1 服务层（token-budget, diagnostics）
extensions/       Layer 2 扩展层（12 个独立扩展）
skills/           Layer 3 技能层（6 个内置技能）
scripts/          符号链接 → 项目 scripts/
data/             运行时数据（memory/logs/plans，gitignored）
```

## 分层架构

```
Layer 4 ─ Agent 编排层 ─────── (由 pi 内置调度)
    ↑
Layer 3 ─ 技能层 ───────────── skills/ packs/
    ↑
Layer 2 ─ 扩展层 ───────────── extensions/ (每个扩展独立)
    ↑
Layer 1 ─ 服务层 ───────────── services/ (token-budget, diagnostics)
    ↑
Layer 0 ─ 基础层 ───────────── core/ (config, registry, secrets)
```

**依赖规则**：单向（下层不能依赖上层）+ 同层独立（扩展之间禁止相互依赖）

## 关键配置

### PI_CODING_AGENT_DIR

pi 框架通过此环境变量定位配置目录。默认值 `~/.pi/agent/`，本项目设置为项目 `.pi/` 目录。

```bash
# /usr/local/bin/mypi
export PI_CODING_AGENT_DIR="$HOME/my-pi/.pi"
```

**重要**：`agent/` 目录是 pi 框架特殊设计，不能修改。通过环境变量重定向配置读取。

### 配置文件位置

```
.pi/
├── settings.json      # 主配置（provider=freellmapi, model=auto）
├── models.json        # 模型配置（freellmapi + local-llama）
├── auth.json          # API 凭证（gitignored）
├── modes.json         # 模式配置（full/light/quick）
├── keybindings.json   # 快捷键配置
└── extensions/        # 扩展目录
```

## 多环境

本仓库在 Termux/Android、WSL2、Linux 等环境间同步。**配置层每环境独立**。

| 规则 | 说明 |
|------|------|
| 配置隔离 | settings.json/models.json/auth.json 每环境独立 |
| 共享配置 | .pi-autopilot-config.json 入库共享（无密钥） |
| 运行时隔离 | sessions/logs/stats 不入库 |

环境差异详情：`docs/operations/ENVIRONMENTS.md`

## 关键约定

### 扩展注册
pi 0.83+ 自动发现 `extensions/` 下含 index.ts 的子目录。settings.json 的 extensions 数组仅作覆盖模式（`!` 排除 / `+` 强制包含）。

### 缓存友好（跨扩展）
- system prompt 注入禁止时间戳/精确数值
- 压力提示按档位（<75% 不注入、≥75%/≥90% 固定文案）
- 估算统一用 `services/token-budget/` 的 estimateTokens

### 后台任务（禁止阻塞前台）
tmux_run 启动后**立即结束回合**。同轮内禁止 tmux_wait；确需等待只用 pattern= 匹配且 timeout≤60s。

### git push
remote 含 token 时先 `git remote set-url origin` 恢复无凭证 URL。勿提交 auth.json/settings.json/models.json。

## 验证

```bash
bash scripts/test/test-all.sh          # 全量回归
bash scripts/test/test-all.sh --only=<ext1>,<ext2>  # 分层快检
bash scripts/test/test-all.sh --fast   # 快速模式
```

## 深度文档

| 主题 | 文档 |
|------|------|
| 扩展清单与目录详情 | `docs/development/AGENTS-DETAILS.md` |
| 扩展开发规范 | `docs/development/PI-EXT-DEV-NOTES.md` |
| SDK 扩展开发 | `docs/development/PI-SDK-EXTENSION.md` |
| 多环境差异 | `docs/operations/ENVIRONMENTS.md` |
| 迁移经验 | `docs/maintenance/LESSONS-LEARNED.md` |
| 模块化方案 | `docs/maintenance/MODULARIZATION-PLAN.md` |
| Pi 官方文档 | https://pi.dev/docs/latest |

## 已知噪音

pi-voice 回车键冲突警告属设计行为，无需处理。详见 `docs/development/AGENTS-DETAILS.md` → 已知噪音

## 旧名称（禁止引用）

旧扩展名：pi-web-toolkit / pi-router / pi-admin / pi-scheduler
旧命令名：/tts、/planclear、/planresume、/planview、/todos、/auto:*、/admin:restart
