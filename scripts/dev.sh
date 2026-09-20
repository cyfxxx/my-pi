#!/bin/bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 开发模式：直接运行，不构建 custom/
# 使用 tsx 或 ts-node 加载 TypeScript 源码
cd "$ROOT"

export PI_CODING_AGENT_DIR="$ROOT/portable/config"
export PI_SESSION_DIR="$ROOT/portable/sessions"
export PI_EXTENSION_DIR="$ROOT/portable/extensions"
export PI_SKILLS_DIR="$ROOT/portable/skills"
export PI_MEMORY_DIR="$ROOT/portable/memory"

npx tsx vendor/pi/packages/coding-agent/src/cli.ts \
    --extension "$ROOT/custom/bootstrap.ts" \
    "$@"
