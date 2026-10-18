#!/usr/bin/env bash
# 体检：一眼看清"谁在跑、端口、URL、TUI 装没装、数据在哪、为什么不工作"。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${MYPI_HOME:-$ROOT/.run/home}"

say() { printf '\n=== %s ===\n' "$1"; }

say "宿主"
node "$ROOT/host/launch.mjs" status 2>&1 || echo "（未运行）"
url="$(node "$ROOT/host/launch.mjs" url 2>/dev/null || true)"
[ -n "$url" ] && echo "URL：$(printf '%s' "$url" | sed 's/token=[^&]*/token=***/')"

say "端口"
for port in $(printf '%s\n' "${MYPI_PORT:-3099}" 3099 3080 | awk '!seen[$0]++'); do
  state="$(node -e '
const net = require("node:net");
const socket = net.connect(Number(process.argv[1]), "127.0.0.1");
socket.setTimeout(500);
socket.on("connect", () => { console.log("被占用"); socket.destroy(); });
socket.on("timeout", () => { console.log("空闲"); socket.destroy(); });
socket.on("error", () => console.log("空闲"));
' "$port" 2>/dev/null)"
  echo "端口 $port：${state:-未知}"
done

say "TUI"
for candidate in \
  "$HOME_DIR/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js" \
  "${DSH_HOME:-/nonexistent}/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js" \
  "$HOME/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js"; do
  [ -f "$candidate" ] && echo "✓ 社区 TUI：$candidate" || true
done
[ -f "$ROOT/bin/tui.mjs" ] && echo "✓ 自带 pi-tui 客户端：$ROOT/bin/tui.mjs（回退用）"

say "数据"
[ -f "$HOME_DIR/memory/entries.json" ] && echo "记忆（home 内）：$(node -e "console.log(require('$HOME_DIR/memory/entries.json').entries.length)" 2>/dev/null) 条" || true
[ -f "$ROOT/memory/entries.json" ] && echo "记忆（仓内）：$(node -e "console.log(require('$ROOT/memory/entries.json').entries.length)" 2>/dev/null) 条"
[ -d "$HOME_DIR/sessions" ] && echo "会话：$(find "$HOME_DIR/sessions" -type f 2>/dev/null | wc -l) 个文件"
echo "home：$HOME_DIR"

say "常见处置"
echo "关闭：$ROOT/scripts/mypi.sh stop"
echo "强杀残留：pkill -f '^node .*--profile mypi'"
echo "看日志：tail -50 $HOME_DIR/../host.log 2>/dev/null || tail -50 $ROOT/.run/host.log"
