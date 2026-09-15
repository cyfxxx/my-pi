# 补丁管理

本目录包含对 `packages/` 目录的修改补丁。

## 文件结构

```
patches/
├── 001-ai-tool-extend.patch
├── 001-ai-tool-extend.patch.description
├── 002-session-stats.patch
├── 002-session-stats.patch.description
└── README.md
```

## 补丁命名规范

```
{序号}-{模块}-{功能描述}.patch
```

示例：
- `001-ai-tool-extend.patch` - 扩展 AI 工具系统
- `002-session-stats.patch` - 添加会话统计功能

## 补丁描述文件

每个补丁文件对应一个 `.description` 文件，记录：

```markdown
日期: YYYY-MM-DD
原因: 修改原因
影响: 影响的文件和功能
上游状态: 是否打算提 PR
```

## 使用方法

### 创建补丁

```bash
./scripts/create-patch.sh ai-tool-extend '扩展工具系统'
```

### 应用所有补丁

```bash
./scripts/apply-patches.sh
```

### 从上游同步

```bash
./scripts/sync-upstream.sh
```

## 最佳实践

1. **最小化修改**：只修改必要的代码
2. **清晰描述**：每个补丁都有清晰的描述
3. **及时更新**：上游同步后及时更新补丁
4. **定期清理**：删除不再需要的补丁
