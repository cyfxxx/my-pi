# .pi/ — Pi 运行时目录

Pi 本地配置仓库，包含自定义扩展、共享库、技能、配置和运行时数据。这是 my-pi 项目的核心运行时目录。

## 分层架构

```
Layer 4 ─ Agent 编排层 ─────── (由 pi 内置调度)
    ↑
Layer 3 ─ 技能层 ───────────── skills/
    ↑
Layer 2 ─ 扩展层 ───────────── extensions/ (12 个独立扩展)
    ↑
Layer 1 ─ 服务层 ───────────── services/ (token-budget, diagnostics)
    ↑
Layer 0 ─ 基础层 ───────────── core/ (config, registry, secrets)
```

**依赖规则**：单向（下层不能依赖上层）+ 同层独立（扩展之间禁止相互依赖）

## 目录结构

```
.pi/
├── core/                     # Layer 0: 基础层（config, registry, hook-registry, secrets）
│   └── [README](core/README.md)
├── services/                 # Layer 1: 服务层（token-budget, diagnostics, note-store）
│   └── [README](services/README.md)
├── extensions/               # Layer 2: 扩展层（12 个独立扩展）
│   └── [README](extensions/README.md)
├── skills/                   # Layer 3: 技能层（4 个内置技能）
│   └── [README](skills/README.md)
├── agent/                    # Agent 运行时状态（settings, sessions）
│   └── [README](agent/README.md)
├── data/                     # 运行时数据（memory/logs/plans，gitignored）
├── memory/                   # 记忆检查点存储
│   └── [README](memory/README.md)
├── sessions/                 # 会话数据（按项目隔离）
├── logs/                     # 运行时日志
├── stats/                    # 运行时统计
│
├── settings.json             # 主配置（provider, model, thinking, skills）
├── models.json               # 模型配置（本地 llama + FreeLLM API）
├── modes.json                # 模式配置（full/light/quick）
├── keybindings.json          # TUI 快捷键绑定（45 个）
├── auth.json                 # API 凭证（gitignored）
├── models-store.json         # 模型存储
│
├── AGENTS.md                 # 项目环境描述
├── APPEND_SYSTEM.md          # 系统提示追加内容
├── trust.json                # 信任设置
├── notify.json               # 通知配置（→ extensions/pi-autopilot/config/）
├── ntfy-relay.json           # Ntfy 中继配置
├── pi-link-active.json       # Pi-link 活跃状态
├── pi-link-state.json        # Pi-link 状态
├── pi-voice.json             # 语音配置
├── scheduled-seeds.json      # 定时种子
└── scheduled-tasks.json      # 定时任务
```

## 核心配置文件

| 文件 | 用途 | 相关文档 |
|------|------|---------|
| `settings.json` | 主配置：默认 provider=freellmapi, model=auto, thinking=max | [架构文档](../docs/architecture.md) |
| `models.json` | 模型配置：local-llama (Qwen3.6 35B) + freellmapi (auto) | [部署指南](../docs/DEPLOYMENT-GUIDE.md) |
| `modes.json` | 模式切换：full（完整）/light（轻量）/quick（极简） | [pi-mode 扩展](extensions/pi-mode/) |
| `keybindings.json` | TUI 快捷键绑定（45 个） | — |

## 多环境支持

本仓库在 Termux/Android、WSL2、Linux 等环境间同步。配置层每环境独立，不跨机覆盖。

| 规则 | 说明 |
|------|------|
| 配置隔离 | settings.json/models.json/auth.json 每环境独立 |
| 共享配置 | .pi-autopilot-config.json 入库共享（无密钥） |
| 记忆过滤 | entries.json 带 environments 字段，按当前环境过滤 |
| 运行时隔离 | sessions/logs/stats 不入库 |

环境差异详情：[ENVIRONMENTS.md](../docs/operations/ENVIRONMENTS.md)

## 相关链接

- [项目根 README](../README.md)
- [自定义层](../custom/README.md)
- [scripts 目录](../scripts/README.md)
- [packs 目录](../packs/README.md)
