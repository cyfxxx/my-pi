# 上游同步

> **注意**：`patches/` 目录当前仅包含 `README.md`，尚无实际补丁文件。补丁管理脚本（`create-patch.sh`、`apply-patches.sh`）已就绪。

## 1. 概述

本文档描述如何从 pi 上游同步更新到 my-pi 项目。同步策略：
- 只同步 `packages/` 目录
- 重新应用补丁
- 手动解决冲突

## 2. 同步策略

### 2.1 同步频率

- **定期同步**：每月检查一次 pi 上游更新
- **按需同步**：当 pi 修复了重要 bug 或添加了重要功能时

### 2.2 同步范围

- **同步**：`packages/` 目录
- **不同步**：`custom/` 目录（保持独立）

## 3. 同步流程

### 3.1 首次同步

```bash
# 1. 添加上游 remote
git remote add upstream git@github.com:earendil-works/pi.git

# 2. 拉取上游
git fetch upstream

# 3. 同步 packages/
git checkout upstream/main -- packages/

# 4. 提交同步
git add packages/
git commit -m "sync: 从 pi 上游同步 packages/"
```

### 3.2 后续同步

```bash
# scripts/tools/sync-upstream.sh
#!/bin/bash

set -e

echo "=== 从 pi 上游同步 ==="

# 1. 拉取上游
git fetch upstream

# 2. 备份当前 packages/
git stash push -m "backup packages before sync"

# 3. 同步 packages/
git checkout upstream/main -- packages/

# 4. 应用补丁
echo "=== 应用补丁 ==="
for patch in patches/*.patch; do
    if [ -f "$patch" ]; then
        echo "应用: $patch"
        git apply --check "$patch" 2>/dev/null && git apply "$patch" || {
            echo "补丁冲突: $patch"
            echo "需要手动解决"
            exit 1
        }
    fi
done

# 5. 重新构建
echo "=== 重新构建 ==="
npm run build:offline

echo "=== 同步完成 ==="
```

## 4. 冲突解决

### 4.1 冲突类型

| 类型 | 说明 | 解决方式 |
|------|------|----------|
| **简单冲突** | 同一行修改 | 手动合并 |
| **复杂冲突** | 多处修改 | 分析意图，手动合并 |
| **结构性冲突** | 文件结构变化 | 重新实现补丁 |

### 4.2 解决流程

```bash
# 1. 尝试同步
./scripts/tools/sync-upstream.sh

# 2. 如果有冲突，查看冲突文件
git status

# 3. 手动解决冲突
vim packages/ai/src/auth/helpers.ts

# 4. 重新生成补丁
git diff packages/ai > patches/001-ai-tool-extend.patch

# 5. 更新描述文件
cat > patches/001-ai-tool-extend.patch.description << EOF
日期: 2026-09-15 (更新)
原因: 扩展工具系统，添加自定义工具拦截器
影响: ai/src/auth/helpers.ts
上游状态: 不打算提 PR
冲突解决: 2026-09-16 手动解决
EOF

# 6. 提交
git add packages/ patches/
git commit -m "sync: 解决上游同步冲突"
```

## 5. 同步检查

### 5.1 同步前检查

```bash
# 检查是否有未提交的修改
git status

# 检查补丁状态
for patch in patches/*.patch; do
    echo "检查: $patch"
    git apply --check "$patch" 2>/dev/null && echo "OK" || echo "冲突"
done
```

### 5.2 同步后检查

```bash
# 检查构建
npm run build:offline

# 检查测试
npm test

# 检查 TypeScript
npx tsgo --noEmit -p custom/tsconfig.json
```

## 6. 回滚方案

### 6.1 回滚到同步前

```bash
# 1. 查看同步前的提交
git log --oneline -10

# 2. 回滚到同步前
git revert HEAD

# 3. 重新应用补丁
for patch in patches/*.patch; do
    git apply "$patch"
done
```

### 6.2 回滚到特定版本

```bash
# 1. 查看历史版本
git log --oneline -20

# 2. 回滚到特定版本
git checkout <commit-hash> -- packages/

# 3. 重新应用补丁
for patch in patches/*.patch; do
    git apply "$patch"
done
```

## 7. 同步记录

### 7.1 记录格式

```markdown
## 同步记录

### 2026-09-15
- **版本**: pi v0.85.1 → v0.85.2
- **补丁**: 3 个补丁重新应用
- **冲突**: 无
- **状态**: 成功

### 2026-09-01
- **版本**: pi v0.85.0 → v0.85.1
- **补丁**: 2 个补丁重新应用
- **冲突**: 1 个补丁需要手动解决
- **状态**: 成功
```

### 7.2 记录文件

在 `patches/SYNC-LOG.md` 中记录同步历史。

## 8. 最佳实践

### 8.1 同步原则

1. **定期同步**：避免积累太多修改
2. **小步快跑**：每次同步小版本，避免大版本跳跃
3. **及时解决冲突**：发现冲突立即解决
4. **充分测试**：同步后充分测试

### 8.2 补丁维护

1. **及时更新**：上游同步后及时更新补丁
2. **定期清理**：删除不再需要的补丁
3. **清晰记录**：每个补丁都有清晰的描述

### 8.3 风险管理

1. **备份**：同步前备份当前状态
2. **回滚方案**：准备好回滚方案
3. **渐进式**：先同步小版本，验证后再同步大版本
