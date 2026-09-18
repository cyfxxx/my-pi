#!/bin/bash
# scripts/tools/sync-upstream.sh - 从 pi 上游同步

set -e

echo "=== 从 pi 上游同步 ==="

# 检查是否配置了 upstream remote
if ! git remote get-url upstream > /dev/null 2>&1; then
    echo "添加 upstream remote..."
    git remote add upstream git@github.com:earendil-works/pi.git
fi

# 拉取上游
git fetch upstream

# 备份当前 packages/
git stash push -m "backup packages before sync"

# 同步 packages/
git checkout upstream/main -- packages/

# 应用补丁
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

# 重新构建
echo "=== 重新构建 ==="
npm run build:offline

echo "=== 同步完成 ==="
