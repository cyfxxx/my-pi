#!/bin/bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_PI="$ROOT/vendor/pi"
PIN_FILE="$ROOT/vendor/PINNED_COMMIT"
UPSTREAM_URL="${PI_UPSTREAM_URL:-https://github.com/earendil-works/pi-mono.git}"

# vendor/pi 是独立 git 仓库，不纳入主仓库。若缺失则从上游引导。
if [ ! -d "$VENDOR_PI/.git" ]; then
    echo "📥 vendor/pi 不存在，从上游引导..."
    rm -rf "$VENDOR_PI"
    git clone "$UPSTREAM_URL" "$VENDOR_PI"

    PIN="$(grep -v '^#' "$PIN_FILE" 2>/dev/null | head -1 | awk '{print $1}')"
    if [ -n "$PIN" ]; then
        echo "锁定到 $PIN"
        git -C "$VENDOR_PI" checkout "$PIN"
    fi

    for patch in "$ROOT/patches"/*.patch; do
        [ -e "$patch" ] || continue
        echo "应用补丁：$(basename "$patch")"
        git -C "$VENDOR_PI" apply --3way "$patch"
    done

    git -C "$VENDOR_PI" rev-parse HEAD > "$VENDOR_PI/LAST_SYNC_POINT"
fi

echo "🔨 构建 vendor/pi (coding-agent)..."
cd "$VENDOR_PI/packages/coding-agent"
npm install
npm run build

# custom/ 不编译：pi 的扩展加载器内置 jiti，直接加载 custom/bootstrap.ts（TypeScript）。
# 类型检查用 `npx tsc --noEmit -p custom/`（见 npm run check 与文档）。
echo "✅ 构建完成（custom/ 以 TypeScript 源码由 pi 加载，无需编译）"
