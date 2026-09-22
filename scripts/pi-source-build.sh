#!/usr/bin/env bash
# pi-source-build.sh — 构建 vendor/pi 并缓存已知良好产物（供崩溃自愈的 pi_self 路径）
#
# my-pi 的源码即 vendor/pi（独立 git clone）。本脚本等价于 pi-tools 的
# L4「源码缓存」：构建 coding-agent 后把 dist 复制到
# portable/agent/recovery/cache/dist，作为修复损坏 dist 的“好 pi”。
#
# 用法：bash scripts/pi-source-build.sh [--force] [--no-build]
#   --no-build  跳过 scripts/build.sh（仅把现有 dist 缓存为“好 pi”，供 build.sh --cache 复用）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor/pi"
DIST="$VENDOR/packages/coding-agent/dist"
CACHE="$ROOT/portable/agent/recovery/cache"
DO_BUILD=1
for arg in "$@"; do
  [ "$arg" = "--no-build" ] && DO_BUILD=0
done

ok() { echo "  ✓ $1"; }
info() { echo "  → $1"; }

if [ "$DO_BUILD" = "1" ]; then
  info "构建 vendor/pi（scripts/build.sh）..."
  bash "$ROOT/scripts/build.sh"
fi

[ -f "$DIST/cli.js" ] || { echo "❌ 构建产物缺失: $DIST/cli.js" >&2; exit 1; }

info "缓存 dist 到 $CACHE/dist"
rm -rf "$CACHE/dist"
mkdir -p "$CACHE"
cp -r "$DIST" "$CACHE/dist"
cp "$VENDOR/packages/coding-agent/package.json" "$CACHE/package.json" 2>/dev/null || true

VERSION=$(node -e "console.log(require('$VENDOR/packages/coding-agent/package.json').version)" 2>/dev/null || echo unknown)
GIT_HASH=$(git -C "$VENDOR" rev-parse --short HEAD 2>/dev/null || echo unknown)
cat > "$CACHE/version.json" <<EOF
{
  "version": "$VERSION",
  "gitHash": "$GIT_HASH",
  "buildTs": $(date +%s),
  "buildDate": "$(date -Iseconds)"
}
EOF

[ -f "$CACHE/dist/cli.js" ] && ok "源码缓存已更新: $CACHE/dist/cli.js（v$VERSION @ $GIT_HASH）"
