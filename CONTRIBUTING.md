# 贡献指南

本指南适用于 my-pi 私人 AI 助手项目。

## 核心原则

### 三隔离一收敛

- **上游隔离**：`vendor/pi/` 是独立 git clone（上游 `earendil-works/pi-mono`），永不直接修改，改动经 `patches/` 管理
- **逻辑隔离**：`custom/features/*/logic.ts` 零 Pi 依赖
- **接口隔离**：`custom/adapters/` 是唯一的 Pi API 接触点
- **数据收敛**：所有运行时数据收敛到 `portable/` 目录（环境变量重定向，无符号链接）

## 开发流程

### 添加新功能

1. 在 `custom/features/` 下创建新目录
2. 创建 `logic.ts` - 纯逻辑（零 Pi 依赖）
3. 创建 `types.ts` - 类型定义（可选）
4. 创建 `index.ts` - 通过 `custom/adapters/` 注册工具/钩子
5. 在 `custom/bootstrap.ts` 的 `FEATURES` 中注册

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
# 构建（vendor/pi 缺失时会自动从上游引导）
bash scripts/build.sh

# 隔离边界检查
npm run check

# custom/ 类型检查
npx tsc --noEmit -p custom/

# 启动
./my-pi.sh
```

## vendor 引导与上游同步

fresh checkout 时 `vendor/pi/` 不存在（已 gitignore），`scripts/build.sh` 会自动
clone 上游、checkout `vendor/PINNED_COMMIT` 并应用 `patches/`。

```bash
# 同步到最新上游
bash scripts/sync-upstream.sh

# 同步到指定 commit
bash scripts/sync-upstream.sh <commit-sha>
```

## 便携化

所有运行时数据通过环境变量重定向到项目内 `portable/`（无符号链接），由 `my-pi.sh` 设置：

```bash
./my-pi.sh          # 直接启动，数据自动落在 portable/
```

## 文档

- [目录结构](STRUCTURE.md)
- [架构进度](PROGRESS.md)
- [架构决策](DECISIONS.md)
- [变更日志](CHANGELOG.md)
