#!/bin/bash
# run-ts.sh — 以 vendor tsx 运行"需要加载 my-pi TypeScript 逻辑"的脚本
#
# 背景：`custom/` 的 TS 使用无扩展名导入（`from './env'`），Node 的类型剥离**不会**帮你解析它们，
# 因此 `node scripts/memory-store.mjs` / `node scripts/knowledge-ingest.mjs` 这类脚本裸跑会报
# `Cannot find module '.../custom/features/memory/env'`。它们必须经 tsx（会解析 TS/无扩展名导入）运行。
#
# headless（autopilot 任务、cron）里没有扩展工具可用，这类脚本是写入记忆的唯一途径，
# 故提供本统一入口，避免每个调用点各自拼 tsx 路径。
#
# 用法：
#   bash scripts/run-ts.sh scripts/memory-store.mjs --json '[...]'
#   bash scripts/run-ts.sh scripts/knowledge-ingest.mjs <md> 3
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "$#" -eq 0 ]; then
  echo "用法: bash scripts/run-ts.sh <script.ts|mjs> [args...]" >&2
  exit 2
fi

TSX="$ROOT/vendor/pi/node_modules/.bin/tsx"
if [ -x "$TSX" ]; then
  exec "$TSX" "$@"
fi

if command -v npx >/dev/null 2>&1; then
  echo "⚠ vendor tsx 不存在（先运行 bash scripts/build.sh），回退 npx tsx（需网络）" >&2
  exec npx --yes tsx "$@"
fi

echo "❌ 找不到 tsx：请先运行 bash scripts/build.sh（vendor 内置 tsx），或安装 npx" >&2
exit 1
