# 开发规范索引

本文件为索引。pi 自动读取的开发规范位于：

**[.pi/AGENTS.md](.pi/AGENTS.md)** — 项目环境描述、分层架构、关键约定、验证命令、深度文档索引

## 快速参考

### 对话风格
- 保持回答简短精炼，不使用 emoji
- 只使用技术性语言，直接了当
- 用户提问时，先回答问题再进行编辑

### 代码质量
- 大范围更改前完整阅读文件
- 不使用 `any`，检查 node_modules 获取外部 API 类型
- 禁止内联导入，只使用顶层导入

### Git 规范
- 只提交本次会话更改的文件
- 暂存显式路径，永远不要 `git add -A`
- 提交消息格式：`{feat,fix,docs}: <消息>`

### 命令
- 代码更改后运行 `npm run check`
- 除非用户要求，不运行 `npm run build` 或 `npm test`

## 架构原则

### 三隔离一收敛

- **上游隔离**：`vendor/pi/` 永不修改，上游更新通过同步脚本自动合并
- **逻辑隔离**：`custom/features/*/logic.ts` 零 Pi 依赖，纯逻辑永远不会因上游变更而崩溃
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点，上游 API 变更只需修改适配器
- **数据收敛**：所有运行时数据通过配置重定向和符号链接收敛到 `portable/` 目录

### 目录职责

| 目录 | 职责 | 可修改 |
|------|------|--------|
| `vendor/pi/` | 上游 vendored 代码 | ❌ 只读 |
| `custom/adapters/` | 适配器层（隔离 Pi API） | ✅ 唯一允许 import vendor/pi |
| `custom/features/` | 功能模块（从 pi-tools 迁移） | ✅ 零 Pi 依赖 |
| `custom/core/` | 核心服务（路径解析/注册表） | ✅ |
| `portable/` | 运行时数据 | ✅ |

### 添加新功能

1. 在 `custom/features/` 下创建新目录
2. 创建 `types.ts` - 类型定义
3. 创建 `logic.ts` - 纯逻辑（零 Pi 依赖）
4. 创建 `tool.ts` - 工具注册（使用适配器）
5. 创建 `index.ts` - 入口（`init`/`destroy` 导出）

### 上游同步

```bash
# 同步到最新上游
bash scripts/sync-upstream.sh

# 同步到指定 commit
bash scripts/sync-upstream.sh <commit-sha>
```
