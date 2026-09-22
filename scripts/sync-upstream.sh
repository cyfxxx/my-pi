#!/bin/bash
# sync-upstream.sh — 上游同步 + 自动修复
#
# 用法:
#   bash scripts/sync-upstream.sh          # 同步到最新上游
#   bash scripts/sync-upstream.sh <commit> # 同步到指定 commit
#
# 流程（更新 pi 后自动修复）:
#   1. 校验 vendor/pi 为独立 git 仓库
#   2. fetch 上游 → merge 目标 commit（本地 patches 以 commit 形式保留在分支上）
#   3. 幂等补齐 patches/（上游改动导致个别补丁失配时明确报错，不静默）
#   4. 重建 vendor/pi dist，并刷新崩溃自愈的“好 pi”缓存
#   5. 类型检查 custom/；失败时给出定位提示（多为适配器需随上游 API 调整）
#
# 环境变量：
#   PI_SKIP_REBUILD=1        跳过第 4 步重建
#   PI_SYNC_RUN_GOLDEN=1     额外运行 golden-tasks（较重）
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_PI="$ROOT/vendor/pi"
LAST_SYNC_FILE="$VENDOR_PI/LAST_SYNC_POINT"
UPSTREAM_URL="${PI_UPSTREAM_URL:-https://github.com/earendil-works/pi-mono.git}"
# shellcheck source=scripts/lib-vendor.sh
. "$ROOT/scripts/lib-vendor.sh"

# 安全检查：vendor/pi 必须是独立 git 仓库
if [ ! -d "$VENDOR_PI/.git" ]; then
    echo "❌ vendor/pi 不是独立 git 仓库，拒绝执行同步。"
    echo "   先运行 bash scripts/build.sh 完成引导（见 STRUCTURE.md）。"
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

echo "🔄 拉取上游（超时 ${PI_FETCH_TIMEOUT:-120}s）..."
if ! timeout "${PI_FETCH_TIMEOUT:-120}" git fetch upstream; then
    echo "❌ 拉取上游失败/超时（网络受限？）。未改动 vendor/pi。" >&2
    exit 1
fi

if [ -n "${1:-}" ]; then
    TARGET_COMMIT="$1"
else
    TARGET_COMMIT=$(git rev-parse upstream/main)
fi
echo "目标 commit: $TARGET_COMMIT"

# 只读预演：查看将同步到哪个提交，不做任何改动
if [ "${PI_SYNC_DRY_RUN:-0}" = "1" ]; then
    echo "[dry-run] 当前 HEAD $(git rev-parse --short HEAD) → 目标 $TARGET_COMMIT（未改动任何内容）"
    git --no-pager log --oneline -5 "$TARGET_COMMIT" 2>/dev/null || true
    exit 0
fi

if git merge-base --is-ancestor "$TARGET_COMMIT" HEAD 2>/dev/null; then
    echo "已是最新，无需同步。"
    if [ "${PI_SKIP_REBUILD:-0}" != "1" ]; then
        echo "🔨 仍按需重建并刷新缓存（确保 dist 与源码一致）..."
    else
        exit 0
    fi
else
    # 保存本地未提交修改（任何失败路径都要恢复，避免改动遗留在 stash）
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
    if ! git -c user.name="${MY_PI_COMMIT_NAME:-my-pi}" -c user.email="${MY_PI_COMMIT_EMAIL:-my-pi@localhost}" \
         merge --no-edit "$TARGET_COMMIT"; then
        echo "❌ 合并冲突，以下文件与本地补丁冲突：" >&2
        git diff --name-only --diff-filter=U >&2 || true
        git merge --abort 2>/dev/null || true
        echo "   请手动解决后重试；不改动主仓库，vendor/pi 已回滚到合并前状态。" >&2
        exit 2
    fi

    # 幂等补齐补丁：上游若已包含补丁改动则跳过；失配则明确报错
    echo "核对补丁..."
    if ! vendor_apply_patches "$ROOT" "$VENDOR_PI" 1; then
        echo "❌ 有补丁无法应用到新上游。请检查 patches/ 与目标 commit 的差异（git -C vendor/pi show $TARGET_COMMIT）。" >&2
        exit 1
    fi

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
    echo "$TARGET_COMMIT" > LAST_SYNC_POINT
fi

cd "$ROOT"

# ── 重建 + 刷新自愈缓存（更新 pi 后的自动修复核心）──
if [ "${PI_SKIP_REBUILD:-0}" != "1" ]; then
    echo "🔨 重建 vendor/pi (coding-agent)..."
    PI_SKIP_ROOT_INSTALL=1 bash "$ROOT/scripts/build.sh"
    echo "🗃  刷新崩溃自愈缓存..."
    bash "$ROOT/scripts/pi-source-build.sh" --no-build || echo "⚠ 自愈缓存刷新失败（不影响运行）" >&2
fi

# ── 类型检查（上游 API 变更的第一道防线）──
echo "🔍 类型检查 custom/..."
if ! npx tsc --noEmit -p custom/; then
    echo "❌ 类型检查失败：上游 API 可能已变更，请调整 custom/adapters/（唯一接触 Pi API 的层）。" >&2
    exit 1
fi

if [ "${PI_SYNC_RUN_GOLDEN:-0}" = "1" ]; then
    echo "🧪 运行 golden-tasks..."
    bash "$ROOT/scripts/golden-tasks.sh"
fi

echo "✅ 上游同步完成（已重建并刷新缓存）"
