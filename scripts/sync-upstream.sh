#!/bin/bash
# sync-upstream.sh — 上游同步 + 自动修复
#
# 用法:
#   bash scripts/sync-upstream.sh          # 同步到最新上游
#   bash scripts/sync-upstream.sh <commit> # 同步到指定 commit
#   PI_SYNC_DRY_RUN=1 bash scripts/sync-upstream.sh   # 只读预演
#
# 模型：patches/ 是唯一真值。vendor 分支 = 上游基线 + 每个补丁一个本地 commit。
# 同步时在临时 worktree 里把 patches/ 重新应用到目标基线，全部成功才移动 vendor 分支；
# 任一补丁失配则 vendor 保持不变（不留半完成状态），并明确报出失败的补丁。
#
# 流程（更新 pi 后自动修复）:
#   1. 校验 vendor/pi 为独立 git 仓库且工作树干净
#   2. fetch 上游（超时保护）→ 确定目标 commit
#   3. 在临时 worktree 上 checkout 目标基线 → 幂等应用并提交 patches/
#   4. 成功后把 vendor/main 指向新补丁栈，更新 LAST_SYNC_POINT
#   5. 重建 vendor/pi dist，并刷新崩溃自愈的“好 pi”缓存
#   6. 类型检查 custom/（上游 API 变更的第一道防线）
#
# 环境变量：
#   PI_SYNC_DRY_RUN=1        只读预演（不改动任何内容）
#   PI_SKIP_REBUILD=1        跳过第 5 步重建
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

# 上游默认分支自适应（main/master）
if [ -n "${1:-}" ]; then
    TARGET_COMMIT="$1"
elif git rev-parse --verify -q upstream/main >/dev/null; then
    TARGET_COMMIT=$(git rev-parse upstream/main)
elif git rev-parse --verify -q upstream/master >/dev/null; then
    TARGET_COMMIT=$(git rev-parse upstream/master)
else
    echo "❌ 无法确定上游默认分支（既无 upstream/main 也无 upstream/master）" >&2
    exit 1
fi
TARGET_COMMIT=$(git rev-parse "$TARGET_COMMIT^{commit}")
echo "目标 commit: $TARGET_COMMIT ($(git describe --tags "$TARGET_COMMIT" 2>/dev/null || echo 'no-tag'))"

# 只读预演
if [ "${PI_SYNC_DRY_RUN:-0}" = "1" ]; then
    echo "[dry-run] 当前 HEAD $(git rev-parse --short HEAD)，基线 $LAST_SYNC → 目标 $TARGET_COMMIT（未改动任何内容）"
    echo "[dry-run] 将在此基线上重新应用 patches/：$(ls "$ROOT"/patches/*.patch 2>/dev/null | wc -l | tr -d ' ') 个"
    git --no-pager log --oneline -5 "$TARGET_COMMIT" 2>/dev/null || true
    exit 0
fi

# 要求 vendor 工作树干净（避免与临时 worktree 操作冲突）
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ vendor/pi 有未提交改动，请先处理（git -C vendor/pi status）。" >&2
    exit 1
fi

# ── 在临时 worktree 上重建补丁栈（全部成功才移动 vendor 分支）──
if [ "$TARGET_COMMIT" = "$LAST_SYNC" ] && git merge-base --is-ancestor "$LAST_SYNC" HEAD 2>/dev/null; then
    echo "基线未变，跳过补丁栈重建（仅重建/刷缓存）"
else
    TMP_BASE="$(mktemp -d /tmp/my-pi-sync.XXXXXX)"
    TMP_WT="$TMP_BASE/wt"
    cleanup_wt() { git -C "$VENDOR_PI" worktree remove --force "$TMP_WT" >/dev/null 2>&1 || true; rm -rf "$TMP_BASE"; }
    trap cleanup_wt EXIT

    echo "🧱 在目标基线上重建补丁栈（临时 worktree）..."
    git worktree add -q --detach "$TMP_WT" "$TARGET_COMMIT"
    if ! vendor_apply_patches "$ROOT" "$TMP_WT" 1; then
        echo "❌ 有补丁无法应用到 $TARGET_COMMIT。请更新 patches/ 后重试。" >&2
        echo "   提示：对比目标基线与补丁（git -C vendor/pi show $TARGET_COMMIT -- <文件>）；vendor 未被改动。" >&2
        exit 1
    fi
    NEW_STACK="$(git -C "$TMP_WT" rev-parse HEAD)"
    cleanup_wt
    trap - EXIT

    git checkout -q -B main "$NEW_STACK"
    echo "$TARGET_COMMIT" > "$LAST_SYNC_FILE"
    vendor_exclude_local "$VENDOR_PI"
    echo "✅ 补丁栈已重建：$(git rev-parse --short HEAD)（基线 $TARGET_COMMIT）"
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
