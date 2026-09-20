# .pi/ — Pi 运行时配置目录

本目录是 my-pi 的 Pi 运行时配置目录，**只放配置**：不放代码、不放运行时数据、不放符号链接。

运行时数据（会话、扩展、技能、记忆）统一收敛到项目根目录的 `portable/`，由 `my-pi.sh` 通过环境变量重定向。

## 内容

```
.pi/
├── settings.json              # 主配置（provider/model/thinking 等）
├── models.json                # 模型配置
├── models-store.json          # 模型存储（gitignored）
├── modes.json                 # 模式配置（full/light/quick）
├── keybindings.json           # TUI 快捷键绑定
├── auth.json                  # API 凭证（gitignored）
├── trust.json                 # 信任设置（gitignored）
├── scheduled-seeds.json       # 定时种子
├── pi-link-*.json             # Pi-link 状态（gitignored）
├── .pi-autopilot-*.json       # Autopilot 运行时状态（gitignored）
├── AGENTS.md                  # 项目环境描述（本目录开发规范）
└── APPEND_SYSTEM.md           # 系统提示追加内容
```

## 环境变量

pi 通过 `PI_CODING_AGENT_DIR` 定位配置目录，默认 `~/.pi/agent`。my-pi 启动脚本将其重定向到 `portable/config`：

```bash
export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/config"
export PI_SESSION_DIR="$MY_PI_ROOT/portable/sessions"
export PI_EXTENSION_DIR="$MY_PI_ROOT/portable/extensions"
export PI_SKILLS_DIR="$MY_PI_ROOT/portable/skills"
export PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"
```

## 多环境支持

本仓库在 Termux/Android、WSL2、Linux 等环境间同步。配置层每环境独立，不跨机覆盖；会话等运行时数据不入库。

## 相关链接

- [项目根 README](../README.md)
- [目录结构说明](../STRUCTURE.md)
- [自定义层](../custom/README.md)
