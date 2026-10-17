#!/bin/bash
# my-pi.sh — 便携启动脚本
# 无论从何处调用，都能正确解析项目根目录

set -e

MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 一条指令，两种底座 ───────────────────────────────────────────────────────
#   bash my-pi.sh                → **TUI**（pi 基座，默认行为，与主分支一致）
#   bash my-pi.sh tui [args…]    → 同上（显式写法）
#   bash my-pi.sh web [--port N] → **Web UI**（DSH 基座；默认端口 3099，避开正在跑的 3080）
#   bash my-pi.sh headless "任务" → DSH 基座一次性执行
#   bash my-pi.sh acp [args…]    → DSH 基座 ACP（编辑器/客户端用）
# DSH 路径的宿主/状态/产物解析全在 scripts/dsh-launch.sh 里（仓内优先 + 便携）。
case "${1:-}" in
  tui)      shift ;;
  web|headless|acp)
    exec bash "$MY_PI_ROOT/scripts/dsh-launch.sh" "$@" ;;
esac

# ── 便携运行时（单一事实来源）──────────────────────────────────────────────
# `lib-portable.sh` 负责：平台判定、把仓内 Node/Python 前置进 PATH、把 npm/pip 缓存与
# pycache 指到仓库内。**不装也能跑**（退回系统 node/python3），但"完全便携"要靠
# `bash scripts/portable-runtime.sh all` 把运行时装进 `<repo>/runtime/<平台>/`。
# shellcheck source=scripts/lib-portable.sh
ROOT="$MY_PI_ROOT"
. "$MY_PI_ROOT/scripts/lib-portable.sh"
pi_portable_env

# 导出环境变量
# pi 只识别 PI_CODING_AGENT_DIR；技能（config/skills）与会话（config/sessions）都在其下。
# PI_MEMORY_DIR 由 custom/core/config.ts 解析（记忆/工具归档等数据落点）。
export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/agent"
export PI_MEMORY_DIR="${PI_MEMORY_DIR:-$MY_PI_ROOT/portable/memory}"

# 确保目录存在（config/sessions 由 pi 自行创建）
mkdir -p "$PI_CODING_AGENT_DIR" "$PI_MEMORY_DIR"

# 检查 vendor/pi 是否已构建
CLI="$MY_PI_ROOT/vendor/pi/packages/coding-agent/dist/cli.js"
if [ ! -f "$CLI" ]; then
    echo "❌ 未找到 $CLI"
    echo "   请先运行：bash scripts/build.sh"
    exit 1
fi

# 崩溃自愈 supervisor（分类/修复者 pi/健康检查/熔断）；MY_PI_NO_SUPERVISOR=1 可直启
exec bash "$MY_PI_ROOT/scripts/pi-supervisor.sh" "$@"