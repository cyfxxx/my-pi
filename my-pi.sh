#!/bin/bash
# my-pi.sh — 便携启动脚本

# 解析脚本所在目录（无论从何处调用）
MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 所有数据目录指向项目内的 portable/
export MY_PI_CONFIG_DIR="$MY_PI_ROOT/portable/config"
export MY_PI_SESSION_DIR="$MY_PI_ROOT/portable/sessions"
export MY_PI_EXTENSION_DIR="$MY_PI_ROOT/portable/extensions"
export MY_PI_SKILLS_DIR="$MY_PI_ROOT/portable/skills"
export MY_PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"

# 覆盖 Pi 的配置目录环境变量
export PI_CODING_AGENT_DIR="$MY_PI_CONFIG_DIR"

# 覆盖包目录（用于便携版二进制）
export PI_PACKAGE_DIR="$MY_PI_ROOT/vendor/pi"

# 选择启动方式：优先使用便携版二进制，否则使用 node 版本
if [ -x "$MY_PI_ROOT/portable/bin/my-pi" ]; then
    exec "$MY_PI_ROOT/portable/bin/my-pi" "$@"
else
    exec "$MY_PI_ROOT/vendor/pi/node_modules/.bin/pi" "$@"
fi
