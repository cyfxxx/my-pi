#!/bin/bash
# scripts/sync-upstream.sh — 上游同步脚本
#
# 用法:
#   bash scripts/sync-upstream.sh          # 同步到最新上游
#   bash scripts/sync-upstream.sh <commit> # 同步到指定 commit
#
# 说明:
#   上游同步要求 vendor/pi 是独立 git 仓库（见 STRUCTURE.md）。
#   若 vendor/pi 由主仓库追踪，脚本会直接报错退出，避免误操作主仓库。

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_PI="$ROOT/vendor/pi"
LAST_SYNC_FILE="$VENDOR_PI/LAST_SYNC_POINT"
UPSTREAM_URL="${PI_UPSTREAM_URL:-https://github.com/earendil-works/pi-mono.git}"

# 安全检查：vendor/pi 必须是独立 git 仓库
if [ ! -d "$VENDOR_PI/.git" ]; then
    echo "❌ vendor/pi 不是独立 git 仓库，拒绝执行同步。"
    echo "   当前 vendor/pi 由主仓库追踪，直接在此运行 git 命令会误操作主仓库。"
    echo "   如需同步，请先将 vendor/pi 转为独立 clone（见 STRUCTURE.md）。"
    exit 1
fi

if [ ! -f "$LAST_SYNC_FILE" ]; then
    echo "❌ 找不到 $LAST_SYNC_FILE"
    exit 1
fi

LAST_SYNC=$(grep -v '^#' "$LAST_SYNC_FILE" | head -1 | awk '{print $1}')
echo "上次同步点: $LAST_SYNC"

cd "$VENDOR_PI"

# 配置 upstream remote
if ! git remote get-url upstream >/dev/null 2>&1; then
    echo "添加 upstream remote: $UPSTREAM_URL"
    git remote add upstream "$UPSTREAM_URL"
fi

echo "🔄 拉取上游..."
git fetch upstream

if [ -n "$1" ]; then
    TARGET_COMMIT="$1"
else
    TARGET_COMMIT=$(git rev-parse upstream/main)
fi
echo "目标 commit: $TARGET_COMMIT"

if git merge-base --is-ancestor "$TARGET_COMMIT" HEAD 2>/dev/null; then
    echo "已是最新，无需同步。"
    exit 0
fi

# 保存本地修改（任何失败路径都要恢复，避免改动遗留在 stash）
DID_STASH=0
STASH_RESTORED=0
restore_stash() {
    rc=$?
    if [ "$DID_STASH" -eq 1 ] && [ "$STASH_RESTORED" -eq 0 ]; then
        echo "↩ 恢复本地改动（git stash pop）..."
        if git stash pop; then
            STASH_RESTORED=1
        else
            echo "⚠ git stash pop 失败：本地改动仍在 stash 中（git stash list），请手动处理" >&2
        fi
    fi
    exit "$rc"
}
trap restore_stash EXIT

if ! git diff --quiet; then
    git stash
    DID_STASH=1
fi

echo "合并上游..."
git merge --no-edit "$TARGET_COMMIT"

# 应用本地补丁
for patch in "$ROOT/patches"/*.patch; do
    [ -e "$patch" ] || continue
    echo "应用补丁：$patch"
    git apply --3way "$patch" || {
        echo "❌ 补丁应用失败：$patch"
        echo "   请手动解决冲突后重新运行。"
        exit 1
    }
done

if [ "$DID_STASH" -eq 1 ]; then
    echo "↩ 恢复本地改动（git stash pop）..."
    if git stash pop; then
        STASH_RESTORED=1
    else
        echo "❌ git stash pop 冲突：本地改动仍在 stash 中，请手动解决后重试" >&2
        exit 1
    fi
fi

# 仅在合并、补丁与本地改动全部就绪后写同步点，保证标记与工作树一致
git rev-parse HEAD > LAST_SYNC_POINT

echo "🔨 类型检查 custom/..."
cd "$ROOT"
npx tsc --noEmit -p custom/

echo "✅ 上游同步完成"
