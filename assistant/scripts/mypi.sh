#!/usr/bin/env bash
# 一条指令：mypi.sh [tui|web|stop|status]
#  - tui（默认）：确保宿主在跑，然后进终端前端
#  - web        ：确保宿主在跑，打印（可选的）浏览器地址
#  - stop/status：管宿主进程
#
# 宿主 = 仓内 vendored DSH（完全便携）；本脚本只做进程管理，不碰模型/工具逻辑。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
RUN_DIR="$ROOT/.run"
LOG="$RUN_DIR/host.log"
TOKEN_FILE="$RUN_DIR/url"
PORT="${MYPI_PORT:-3099}"
HOST_HOME="${MYPI_HOME:-$ROOT/.run/home}"
# 默认把我们自己的插件挂进宿主（它是产品的一部分）；要跑"裸宿主"对比时设 MYPI_NO_PLUGIN=1。
# 产物不进 git（仓库约定 dist/ 忽略）⇒ 缺了就现构建；没有 esbuild 就明确跳过，不静默。
if [ -z "${MYPI_NO_PLUGIN:-}" ] && [ ! -f "$ROOT/plugin/dist/plugin.mjs" ] && [ -x "$REPO/node_modules/.bin/esbuild" ]; then
  echo "→ 构建 assistant 插件（缺产物）…"
  ( cd "$REPO" && node_modules/.bin/esbuild assistant/plugin/entry.ts --bundle --format=esm \
      --platform=node --packages=external --outfile=assistant/plugin/dist/plugin.mjs --log-level=warning )
fi
if [ -z "${MYPI_NO_PLUGIN:-}" ] && [ -f "$ROOT/plugin/dist/plugin.mjs" ]; then
  case ":${MY_PI_DSH_EXTRA_PATCH:-}:" in
    *":$ROOT/plugin/mount.patch.yml:"*) : ;;
    *) MY_PI_DSH_EXTRA_PATCH="$ROOT/plugin/mount.patch.yml${MY_PI_DSH_EXTRA_PATCH:+:$MY_PI_DSH_EXTRA_PATCH}" ;;
  esac
fi
export MY_PI_DSH_EXTRA_PATCH="${MY_PI_DSH_EXTRA_PATCH:-}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少依赖：$1" >&2; exit 1; }; }
need node

start_host() {
  mkdir -p "$RUN_DIR"
  echo "→ 起宿主（$PORT，home=$HOST_HOME）…"
  setsid env MY_PI_DSH_HOME="$HOST_HOME" MY_PI_DSH_PORT="$PORT" \
    bash "$REPO/scripts/dsh-launch.sh" web >"$LOG" 2>&1 </dev/null &
  local i
  for i in $(seq 1 240); do
    if grep -qE '^dsh web: http' "$LOG" 2>/dev/null; then break; fi
    sleep 0.5
  done
  local url
  url="$(grep -aoE '^dsh web: https?://[^ ]+' "$LOG" | tail -1 | sed 's/^dsh web: //')"
  if [ -z "$url" ]; then
    echo "✗ 宿主没起来，看日志：$LOG" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  printf '%s' "$url" >"$TOKEN_FILE"
  echo "✓ 宿主就绪：$url"
}

host_url() {
  if [ -f "$TOKEN_FILE" ] && curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    # 401 也算活着：curl -f 会把 401 当失败，所以用 -o /dev/null -w
    :
  fi
}

ensure_host() {
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    if [ -f "$TOKEN_FILE" ]; then
      return 0
    fi
  fi
  start_host
}

case "${1:-tui}" in
  tui)
    ensure_host
    exec node "$ROOT/bin/tui.mjs" "$(cat "$TOKEN_FILE")"
    ;;
  web)
    ensure_host
    echo "浏览器打开：$(cat "$TOKEN_FILE")"
    ;;
  status)
    if curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
      echo "宿主在跑：$PORT"
      [ -f "$TOKEN_FILE" ] && echo "地址：$(cat "$TOKEN_FILE")"
    else
      echo "宿主没在跑（$PORT）"
    fi
    ;;
  stop)
    local_pids="$(pgrep -f "mypi-web.*--port $PORT" || true)"
    if [ -n "$local_pids" ]; then
      # shellcheck disable=SC2086
      kill $local_pids 2>/dev/null || true
      echo "已停止：$local_pids"
    else
      echo "没有找到 $PORT 上的宿主"
    fi
    rm -f "$TOKEN_FILE"
    ;;
  *)
    echo "用法：$0 [tui|web|status|stop]" >&2
    exit 2
    ;;
esac
