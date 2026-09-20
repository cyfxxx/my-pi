# 贡献指南

本指南适用于 my-pi 私人 AI 助手项目。

## 核心原则

### 三隔离一收敛

- **上游隔离**：`vendor/pi/` 永不修改，上游更新通过同步脚本自动合并
- **逻辑隔离**：`custom/features/*/logic.ts` 零 Pi 依赖
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点
- **数据收敛**：所有运行时数据收敛到 `portable/` 目录

## 开发流程

### 添加新功能

1. 在 `custom/features/` 下创建新目录
2. 创建 `types.ts` - 类型定义
3. 创建 `logic.ts` - 纯逻辑（零 Pi 依赖）
4. 创建 `tool.ts` - 工具注册（使用适配器）
5. 创建 `index.ts` - 入口（`init`/`destroy` 导出）

### 代码质量

- 大范围更改前完整阅读文件
- 不使用 `any`，检查 node_modules 获取外部 API 类型
- 禁止内联导入，只使用顶层导入
- `custom/features/*/logic.ts` 必须零 Pi 依赖

### Git 规范

- 只提交本次会话更改的文件
- 暂存显式路径，永远不要 `git add -a`
- 提交消息格式：`{feat,fix,docs}: <消息>`

## 构建与测试

```bash
# 构建 vendor/pi
cd vendor/pi && npm run build:offline

# 检查 custom/ 类型
cd custom && npx tsc --noEmit

# 测试运行
./my-pi.sh --help
```

## 上游同步

```bash
# 同步到最新上游
bash scripts/sync-upstream.sh

# 同步到指定 commit
bash scripts/sync-upstream.sh <commit-sha>
```

## 便携化

### 构建便携版二进制

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 构建便携版
~/.bun/bin/bun build --compile ./vendor/pi/packages/coding-agent/src/cli.ts --outfile ./portable/bin/my-pi
```

### U 盘使用流程

```bash
# 1. 初始化便携环境
bash scripts/init-portable.sh

# 2. 启动
./my-pi.sh
```

## 文档

- [修改计划](/storage/emulated/0/Documents/修改计划.md)
- [变更日志](CHANGELOG.md)
