#!/bin/bash
# web-terminal.sh — 用浏览器访问 my-pi（只绑定 127.0.0.1）
#
# 与 my-pi.sh 的关系：my-pi.sh 是交互式 TUI 入口；本脚本起一个 HTTP/WS 服务，
# 由它在一个 pty 里拉起 `bash my-pi.sh`，浏览器用 xterm.js 接管那个终端。
# 因此这里导入的环境变量与 my-pi.sh 完全一致（同一份 agentDir / memoryDir）。
#
# 远程访问请走 SSH 隧道，不要改绑定地址（见 custom/web-terminal/README.md）：
#   ssh -N -L 7717:127.0.0.1:7717 <user>@<host>
set -e

MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PI_CODING_AGENT_DIR="$MY_PI_ROOT/portable/agent"
export PI_MEMORY_DIR="$MY_PI_ROOT/portable/memory"

mkdir -p "$PI_CODING_AGENT_DIR" "$PI_MEMORY_DIR"

CLI="$MY_PI_ROOT/vendor/pi/packages/coding-agent/dist/cli.js"
if [ ! -f "$CLI" ]; then
    echo "❌ 未找到 $CLI"
    echo "   请先运行：bash scripts/build.sh"
    exit 1
fi

if [ ! -d "$MY_PI_ROOT/node_modules/@xterm/xterm" ] || [ ! -d "$MY_PI_ROOT/node_modules/ws" ]; then
    echo "❌ 缺少前端依赖（@xterm/xterm、ws）"
    echo "   请在项目根运行：npm install"
    exit 1
fi

exec bash "$MY_PI_ROOT/scripts/run-ts.sh" "$MY_PI_ROOT/custom/web-terminal/main.ts" "$@"
