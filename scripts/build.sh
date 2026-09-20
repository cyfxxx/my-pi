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

echo "🔨 构建 custom/..."
cd "$ROOT"
npx tsc --project custom/ --outDir custom/dist --noEmit false

echo "✅ 构建完成"
