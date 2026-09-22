#!/bin/bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 开发模式：直接运行 TypeScript 源码，不构建 custom/
cd "$ROOT"

# pi 只识别 PI_CODING_AGENT_DIR；PI_MEMORY_DIR 由 custom/core/config.ts 解析
export PI_CODING_AGENT_DIR="$ROOT/portable/agent"
export PI_MEMORY_DIR="$ROOT/portable/memory"

CLI_SRC="$ROOT/vendor/pi/packages/coding-agent/src/cli.ts"
[ -f "$CLI_SRC" ] || { echo "❌ 未找到 $CLI_SRC，请先运行：bash scripts/build.sh" >&2; exit 1; }

# 优先用 vendor 自带的 tsx（build.sh 已在 vendor 安装），避免新设备无网络时 npx 拉取失败
TSX="$ROOT/vendor/pi/node_modules/.bin/tsx"
if [ -x "$TSX" ]; then
    exec "$TSX" "$CLI_SRC" --extension "$ROOT/custom/bootstrap.ts" "$@"
fi
exec npx --yes tsx "$CLI_SRC" --extension "$ROOT/custom/bootstrap.ts" "$@"
