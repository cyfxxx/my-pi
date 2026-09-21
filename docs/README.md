# my-pi 文档

本目录是 my-pi 的项目文档。文档按读者任务分类：日常使用与排障、扩展/技能开发、多环境运维。

## 元信息

| 属性 | 值 |
|------|-----|
| 更新日期 | 2026-09-21 |
| 适用范围 | my-pi 项目文档索引 |
| 相关文档 | [README.md](../README.md)、[STRUCTURE.md](../STRUCTURE.md)、[DECISIONS.md](../DECISIONS.md) |

---

## 文档索引

### 使用与排障

| 文档 | 内容 |
|------|------|
| [FAQ.md](FAQ.md) | 安装/启动/配置/技能与 packs/备份/性能的常见问答 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 系统化故障诊断：启动、功能加载、配置、网络、性能、数据 |

### 开发

| 文档 | 内容 |
|------|------|
| [development/PI-EXT-DEV-NOTES.md](development/PI-EXT-DEV-NOTES.md) | pi 扩展开发实测经验：保留键、参数补全语义、UI API、缓存友好约定、黑盒开发流程 |
| [development/PI-SDK-EXTENSION.md](development/PI-SDK-EXTENSION.md) | pi SDK 深度定制方案：纯函数增强、工具工厂、类型突破、命令上下文、自定义 Provider |
| [development/SKILLS-MAINTENANCE.md](development/SKILLS-MAINTENANCE.md) | 技能使用后改进机制：偏差记录、合并节奏、packs 外部包处理 |

### 运维

| 文档 | 内容 |
|------|------|
| [operations/ENVIRONMENTS.md](operations/ENVIRONMENTS.md) | 多环境（Termux/WSL2/Linux/macOS）识别、配置分层与数据隔离 |
| [operations/TERMUX-DEV-NOTES.md](operations/TERMUX-DEV-NOTES.md) | Termux/Android（PRoot）实测经验：录音链路、系统特性、终端输入、sshd、本地转写 |
| [operations/alacritty-tmux-setup.md](operations/alacritty-tmux-setup.md) | WSL2 + Alacritty + tmux 部署问题与修复汇总 |

### 设计与目标

| 文档 | 内容 |
|------|------|
| [design/VISION.md](design/VISION.md) | 项目愿景、三大核心功能判据、软硬结合方法论、记忆治理规则、度量差距与落地路线 |

### 项目主文档（仓库根）

| 文档 | 内容 |
|------|------|
| [README.md](../README.md) | 项目总览与快速开始 |
| [STRUCTURE.md](../STRUCTURE.md) | 目录结构说明 |
| [AGENTS.md](../AGENTS.md) | 开发规范索引 |
| [../portable/agent/AGENTS.md](../portable/agent/AGENTS.md) | Pi 运行时环境描述、分层架构、关键约定、验证命令 |
| [PROGRESS.md](../PROGRESS.md) | 迁移与架构修复进度 |
| [DECISIONS.md](../DECISIONS.md) | 架构决策记录 |

---

## 来源与迁移说明

本目录文档迁移自 pi-tools 项目（`https://github.com/cyfxxx/pi-tools`）的 `docs/`，并按 my-pi 硬分叉的实际结构逐篇检查、改写：路径、命令、子系统引用全部对齐 my-pi（`custom/`、`scripts/`、`patches/`、`portable/`），pi-tools 专有的 `agent/extensions`、`agent/services`、`scripts/rebuild.sh`、`searxng/`、`deploy/`、wrapper/systemd 等内容已删除或改写为 my-pi 对应物。

**未迁移**（pi-tools 专有的一次性报告、路线图或已消失子系统的描述，保留在 pi-tools 仓库中）：

- `DOCUMENTATION-COMPLETE.md`、`DOCUMENTATION-PROGRESS.md`、`DOCUMENTATION-TEMPLATE.md` — pi-tools 文档整理的一次性报告与模板
- `design/SELF-OPTIMIZING-BASELINE.md`、`design/SELF-OPTIMIZING-ROADMAP.md` — pi-tools 的自我优化基线与执行路线图（my-pi 的落地路线已并入 [design/VISION.md](design/VISION.md) §6）
- `development/AGENTS-DETAILS.md` — pi-tools `agent/` 目录（extensions/services/lib）的细节索引，对应子系统在 my-pi 已重组
- `maintenance/GIT-HISTORY-REWRITE.md`、`maintenance/MODULARIZATION-PLAN.md`、`maintenance/OPTIMIZATION-LOG.md` — pi-tools 的历史重写、模块化方案与优化日志

my-pi 的架构决策与迁移进度分别记录在 [DECISIONS.md](../DECISIONS.md) 与 [PROGRESS.md](../PROGRESS.md)。
