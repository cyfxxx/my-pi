#!/bin/bash
# my-pi.sh — 便携启动脚本
# 无论从何处调用，都能正确解析项目根目录

set -e

MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 导出所有路径到环境变量
export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/config"
export PI_SESSION_DIR="$MY_PI_ROOT/portable/sessions"
export PI_EXTENSION_DIR="$MY_PI_ROOT/portable/extensions"
export PI_SKILLS_DIR="$MY_PI_ROOT/portable/skills"
export PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"

# 确保目录存在
mkdir -p "$PI_CODING_AGENT_DIR" "$PI_SESSION_DIR" "$PI_EXTENSION_DIR" "$PI_SKILLS_DIR" "$PI_MEMORY_DIR"

# 检查 vendor/pi 是否已构建
CLI="$MY_PI_ROOT/vendor/pi/packages/coding-agent/dist/cli.js"
if [ ! -f "$CLI" ]; then
    echo "❌ 未找到 $CLI"
    echo "   请先运行：bash scripts/build.sh"
    exit 1
fi

exec node "$CLI" \
    --extension "$MY_PI_ROOT/custom/bootstrap.ts" \
    "$@"