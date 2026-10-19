#!/usr/bin/env bash
# 构建本仓产物：插件（entry.ts → plugin/dist/plugin.mjs）+ 四个 headless 脚本（scripts/*.ts → dist/*.mjs）。
# 干净仓库/新机器上：先跑 vendor-dsh.sh install 拿宿主，再跑本脚本。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
ESBUILD="${ESBUILD:-$REPO/node_modules/.bin/esbuild}"
[ -x "$ESBUILD" ] || ESBUILD="$(command -v esbuild || true)"
[ -n "$ESBUILD" ] && [ -x "$ESBUILD" ] || { echo "✗ 找不到 esbuild（npm i -g esbuild 或在本仓 npm i -D esbuild）" >&2; exit 1; }

build() {
  local entry="$1" out="$2"
  "$ESBUILD" "$entry" --bundle --format=esm --platform=node --packages=external --outfile="$out" --log-level=warning
  echo "✓ $out"
}

build "$ROOT/plugin/entry.ts" "$ROOT/plugin/dist/plugin.mjs"
for name in memory-store knowledge-ingest memory-lifecycle lesson-miner import-memory; do
  build "$ROOT/scripts/$name.ts" "$ROOT/dist/$name.mjs"
done
echo "全部产物已生成。"
