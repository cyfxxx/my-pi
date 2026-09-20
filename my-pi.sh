#!/bin/bash
# my-pi.sh — 便携启动脚本
# 无论从何处调用，都能正确解析项目根目录

set -e

MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 导出环境变量
# pi 只识别 PI_CODING_AGENT_DIR；技能（config/skills）与会话（config/sessions）都在其下。
# PI_MEMORY_DIR 由 custom/core/note-store.ts 读取。
export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/config"
export PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"

# 确保目录存在（config/sessions 由 pi 自行创建）
mkdir -p "$PI_CODING_AGENT_DIR" "$PI_MEMORY_DIR"

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