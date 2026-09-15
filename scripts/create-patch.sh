#!/bin/bash
# scripts/create-patch.sh - 创建补丁脚本

set -e

if [ $# -lt 2 ]; then
    echo "用法: $0 <模块> <描述>"
    echo "示例: $0 ai-tool-extend '扩展工具系统'"
    exit 1
fi

MODULE=$1
DESCRIPTION=$2

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
echo "描述文件: ${PATCH_FILE}.description"
