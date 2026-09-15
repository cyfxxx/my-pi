# 补丁管理

## 1. 概述

本文档描述如何管理对 `packages/` 目录的修改。当必须修改 pi 上游代码时，使用补丁管理来：
- 追踪修改
- 支持上游同步
- 保持修改可追溯

## 2. 补丁目录结构

```
patches/
├── 001-ai-tool-extend.patch
├── 002-session-stats.patch
├── 003-coding-agent-api.patch
└── README.md
```

## 3. 补丁命名规范

### 3.1 命名格式

```
{序号}-{模块}-{功能描述}.patch
```

### 3.2 示例

- `001-ai-tool-extend.patch` - 扩展 AI 工具系统
- `002-session-stats.patch` - 添加会话统计功能
- `003-coding-agent-api.patch` - 扩展编码代理 API

## 4. 补丁生成

### 4.1 生成流程

```bash
# 1. 修改 packages/ 中的文件
# 例如：修改 packages/ai/src/auth/helpers.ts

# 2. 生成补丁
git diff packages/ai > patches/001-ai-tool-extend.patch

# 3. 记录原因
cat > patches/001-ai-tool-extend.patch.description << EOF
日期: 2026-09-15
原因: 扩展工具系统，添加自定义工具拦截器
影响: ai/src/auth/helpers.ts
上游状态: 不打算提 PR
EOF
```

### 4.2 补丁描述文件

每个补丁文件对应一个 `.description` 文件，记录：

```markdown
日期: YYYY-MM-DD
原因: 修改原因
影响: 影响的文件和功能
上游状态: 是否打算提 PR
```

## 5. 补丁应用

### 5.1 应用单个补丁

```bash
git apply patches/001-ai-tool-extend.patch
```

### 5.2 应用所有补丁

```bash
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
```

### 5.3 检查补丁

```bash
# 检查补丁是否可以应用
git apply --check patches/001-ai-tool-extend.patch
```

## 6. 补丁冲突解决

### 6.1 冲突原因

- pi 上游修改了相同文件
- 补丁依赖的代码已变化

### 6.2 解决流程

```bash
# 1. 尝试应用补丁
git apply patches/001-ai-tool-extend.patch

# 2. 如果失败，手动解决冲突
# 查看冲突文件
git status

# 编辑冲突文件
vim packages/ai/src/auth/helpers.ts

# 3. 重新生成补丁
git diff packages/ai > patches/001-ai-tool-extend.patch

# 4. 更新描述文件
cat > patches/001-ai-tool-extend.patch.description << EOF
日期: 2026-09-15 (更新)
原因: 扩展工具系统，添加自定义工具拦截器
影响: ai/src/auth/helpers.ts
上游状态: 不打算提 PR
冲突解决: 2026-09-16 手动解决
EOF
```

## 7. 补丁删除

### 7.1 删除流程

```bash
# 1. 删除补丁文件
rm patches/001-ai-tool-extend.patch
rm patches/001-ai-tool-extend.patch.description

# 2. 重新编号（可选）
# 如果删除中间的补丁，需要重新编号后续补丁
```

## 8. 补丁查看

### 8.1 查看所有补丁

```bash
ls -la patches/*.patch
```

### 8.2 查看补丁内容

```bash
cat patches/001-ai-tool-extend.patch
```

### 8.3 查看补丁描述

```bash
cat patches/001-ai-tool-extend.patch.description
```

## 9. 补丁管理脚本

### 9.1 创建补丁

```bash
#!/bin/bash
# scripts/create-patch.sh

set -e

MODULE=$1
DESCRIPTION=$2

if [ -z "$MODULE" ] || [ -z "$DESCRIPTION" ]; then
    echo "用法: $0 <模块> <描述>"
    echo "示例: $0 ai-tool-extend '扩展工具系统'"
    exit 1
fi

# 生成序号
SEQUENCE=$(ls patches/*.patch 2>/dev/null | wc -l)
SEQUENCE=$(printf "%03d" $((SEQUENCE + 1)))

# 生成补丁文件名
PATCH_FILE="patches/${SEQUENCE}-${MODULE}.patch"

# 生成补丁
git diff "packages/${MODULE%%-*}" > "$PATCH_FILE"

# 生成描述文件
cat > "${PATCH_FILE}.description" << EOF
日期: $(date +%Y-%m-%d)
原因: $DESCRIPTION
影响: packages/${MODULE%%-*}/
上游状态: 不打算提 PR
EOF

echo "补丁已创建: $PATCH_FILE"
```

### 9.2 应用所有补丁

```bash
#!/bin/bash
# scripts/apply-patches.sh

set -e

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

echo "=== 补丁应用完成 ==="
```

## 10. 最佳实践

### 10.1 补丁原则

1. **最小化修改**：只修改必要的代码
2. **清晰描述**：每个补丁都有清晰的描述
3. **及时更新**：上游同步后及时更新补丁
4. **定期清理**：删除不再需要的补丁

### 10.2 补丁大小

- 小补丁：修改 1-3 个文件
- 中补丁：修改 4-10 个文件
- 大补丁：修改 10+ 个文件（考虑拆分）

### 10.3 补丁依赖

- 避免补丁之间的依赖
- 如果必须依赖，按顺序应用
