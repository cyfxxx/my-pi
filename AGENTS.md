# 开发规范索引

本文件为索引。pi 自动读取的开发规范位于：

**[portable/agent/AGENTS.md](portable/agent/AGENTS.md)** — 项目环境描述、分层架构、关键约定、验证命令、深度文档索引

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

- **上游隔离**：`vendor/pi/` 是独立 git clone（上游 `earendil-works/pi-mono`），永不直接修改，改动经 `patches/` 管理；上游更新通过 `scripts/sync-upstream.sh` 合并
- **逻辑隔离**：`custom/features/` 的逻辑层（`index.ts` 与 `__tests__/` 除外）零 Pi 依赖，纯逻辑永远不会因上游变更而崩溃
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点，上游 API 变更只需修改适配器
- **数据收敛**：所有运行时数据通过环境变量重定向收敛到 `portable/` 目录（无符号链接）

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
2. 创建 `logic.ts` - 纯逻辑出口（零 Pi 依赖）；小功能直接放实现，大功能作 barrel
3. 创建 `index.ts` - 入口，通过 `custom/adapters/` 注册工具/钩子
4. `types.ts` - 类型定义（可选）
5. 模块较多时在功能目录下按职责建一层子包（如 `store/`、`recall/`、`ui/`），
   子包内互引用用相对路径；跨功能引用只走对方 `logic.ts`
6. 在 `custom/bootstrap.ts` 中注册该功能

### vendor 引导与上游同步

`vendor/pi/` 不随主仓库分发（已 gitignore）。fresh checkout 后由 `scripts/build.sh`
自动 clone 上游并 checkout `vendor/PINNED_COMMIT`、应用 `patches/`。

```bash
# 同步到最新上游
bash scripts/sync-upstream.sh

# 同步到指定 commit
bash scripts/sync-upstream.sh <commit-sha>
```
