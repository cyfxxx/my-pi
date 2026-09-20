#!/bin/bash
# scripts/sync-upstream.sh — 上游同步脚本
#
# 用法:
#   bash scripts/sync-upstream.sh          # 同步到最新上游
#   bash scripts/sync-upstream.sh <commit> # 同步到指定 commit

set -e

MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_PI="$MY_PI_ROOT/vendor/pi"
LAST_SYNC_FILE="$MY_PI_ROOT/LAST_SYNC_POINT"

# 读取上次同步点
if [ ! -f "$LAST_SYNC_FILE" ]; then
    echo "错误: 找不到 LAST_SYNC_POINT 文件"
    exit 1
fi

LAST_SYNC=$(head -1 "$LAST_SYNC_FILE" | awk '{print $1}')
echo "上次同步点: $LAST_SYNC"

# 进入 vendor/pi 目录
cd "$VENDOR_PI"

# 检查是否有 upstream remote
if ! git remote get-url upstream >/dev/null 2>&1; then
    echo "添加 upstream remote..."
    git remote add upstream https://github.com/cyfxxx/pi-tools.git
fi

# 拉取上游更新
echo "拉取上游更新..."
git fetch upstream

# 确定目标 commit
if [ -n "$1" ]; then
    TARGET_COMMIT="$1"
else
    TARGET_COMMIT=$(git rev-parse upstream/main)
fi

echo "目标 commit: $TARGET_COMMIT"

# 生成上游变更补丁
echo "生成补丁..."
git format-patch "$LAST_SYNC".."$TARGET_COMMIT" --stdout > /tmp/upstream-changes.patch

# 检查补丁是否为空
if [ ! -s /tmp/upstream-changes.patch ]; then
    echo "没有新的上游变更"
    exit 0
fi

# 应用补丁（三方合并）
echo "应用补丁..."
if git apply --3way /tmp/upstream-changes.patch; then
    echo "补丁应用成功"
    
    # 更新 LAST_SYNC_POINT
    echo "$TARGET_COMMIT $(date +%Y-%m-%d) $(git describe --tags --always $TARGET_COMMIT 2>/dev/null || echo 'unknown')" > "$LAST_SYNC_FILE"
    echo "已更新 LAST_SYNC_POINT"
    
    # 显示变更统计
    echo ""
    echo "变更统计:"
    git diff --stat HEAD
else
    echo "补丁应用失败，需要手动解决冲突"
    echo "解决冲突后运行: git add . && git commit"
    exit 1
fi

# 清理
rm -f /tmp/upstream-changes.patch

echo ""
echo "同步完成!"
echo "建议运行: npm run build:offline && npx tsc --noEmit"
