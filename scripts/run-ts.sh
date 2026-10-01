#!/bin/bash
# run-ts.sh — 以 tsx 运行"需要加载 my-pi TypeScript 逻辑"的脚本
#
# 背景：`custom/` 的 TS 使用无扩展名导入（`from './env'`），Node 的类型剥离**不会**帮你解析它们，
# 因此 `node scripts/memory-store.mjs` / `node scripts/knowledge-ingest.mjs` 这类脚本裸跑会报
# `Cannot find module '.../custom/features/memory/env'`。它们必须经 tsx（会解析 TS/无扩展名导入）运行。
#
# tsx 的真值来源是 `custom/package.json` 的 "tsx" 依赖（npm workspace 提升到根 `node_modules`）。
# 此前用的是 `vendor/pi/node_modules/.bin/tsx`——那是上游 v0.87 时代 vendor 自带的 devDependency；
# 上游 v0.99.0 起改用 Node 内置类型剥离并删除了该依赖，本地那份只是升级残留，fresh `npm ci` 后消失，
# 会让换机/离线引导后的 headless 写记忆静默失效（autopilot 的 daily-review / knowledge-subscribe 都走这里）。
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

TSX="$ROOT/node_modules/.bin/tsx"
if [ -x "$TSX" ]; then
  exec "$TSX" "$@"
fi

# 兼容旧布局：上游 v0.99.0 起 vendor/pi 不再依赖 tsx（改为 Node 内置类型剥离），
# vendor 下那份只是升级前的残留，fresh `npm ci` 后必然消失。因此只作为兜底，
# 真值来源是 custom/package.json 的 "tsx" 依赖（npm 提升到根 node_modules）。
VENDOR_TSX="$ROOT/vendor/pi/node_modules/.bin/tsx"
if [ -x "$VENDOR_TSX" ]; then
  echo "⚠ 未找到根 node_modules/.bin/tsx，回退 vendor 残留副本（运行 npm install 修正）" >&2
  exec "$VENDOR_TSX" "$@"
fi

if command -v npx >/dev/null 2>&1; then
  echo "⚠ 未找到 tsx（先运行 npm install），回退 npx tsx（需网络）" >&2
  exec npx --yes tsx "$@"
fi

echo "❌ 找不到 tsx：请运行 npm install（tsx 由 custom/package.json 声明）或 bash scripts/build.sh" >&2
exit 1
