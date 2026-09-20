#!/bin/bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 开发模式：直接运行，不构建 custom/
# 使用 tsx 加载 TypeScript 源码
cd "$ROOT"

# pi 只识别 PI_CODING_AGENT_DIR；PI_MEMORY_DIR 由 custom/ 的 note-store 读取
export PI_CODING_AGENT_DIR="$ROOT/portable/agent"
export PI_MEMORY_DIR="$ROOT/portable/memory"

npx tsx vendor/pi/packages/coding-agent/src/cli.ts \
    --extension "$ROOT/custom/bootstrap.ts" \
    "$@"
