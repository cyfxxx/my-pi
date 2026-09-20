# docs/ — 项目文档

项目文档集合，按职责分类。

## 架构概述

基于 pi 框架的私人 AI 助手，通过硬分叉实现完全受控的 AI 编程体验。

### 核心原则

- **上游隔离**：`vendor/pi/` 保持只读
- **逻辑隔离**：`custom/features/*/logic.ts` 零 Pi 依赖
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点
- **数据收敛**：所有运行时数据收敛到 `portable/` 目录

## 根目录文件

| 文件 | 用途 |
|------|------|
| architecture.md | 架构文档（能力接缝、事件驱动、配置管理） |
| DEPLOYMENT-GUIDE.md | 新设备部署指南 |
| OPTIMIZATION-PLAN.md | 全面优化计划 |
| FIX-REPORT.md | 修复完成报告 |
| PI-TOOLS-README.md | pi-tools 完整说明 |

## 子目录

### design/ — 设计文档

| 文件 | 用途 |
|------|------|
| VISION.md | 项目愿景与进化路线 |
| SELF-OPTIMIZING-BASELINE.md | 自优化基线 |
| SELF-OPTIMIZING-ROADMAP.md | 自优化路线图 |

### development/ — 开发文档

| 文件 | 用途 |
|------|------|
| AGENTS-DETAILS.md | Agent 详细说明 |
| PI-EXT-DEV-NOTES.md | 扩展开发笔记 |
| PI-SDK-EXTENSION.md | SDK 扩展开发指南 |
| SKILLS-MAINTENANCE.md | 技能维护 |

### operations/ — 运维文档

| 文件 | 用途 |
|------|------|
| ENVIRONMENTS.md | 多环境配置差异 |
| TERMUX-DEV-NOTES.md | Termux 开发笔记 |
| alacritty-tmux-setup.md | Alacritty + tmux 配置 |

### maintenance/ — 维护文档

| 文件 | 用途 |
|------|------|
| OPTIMIZATION-LOG.md | 优化日志 |
| MODULARIZATION-PLAN.md | 模块化计划 |
| LESSONS-LEARNED.md | 迁移经验总结 |
| GIT-HISTORY-REWRITE.md | Git 历史重写 |

## 快速链接

- [项目架构](architecture.md)
- [部署指南](DEPLOYMENT-GUIDE.md)
- [开发规范](../AGENTS.md)
- [贡献指南](../CONTRIBUTING.md)
