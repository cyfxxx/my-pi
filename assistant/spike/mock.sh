#!/usr/bin/env bash
# 起/停 mock 端点，用 pidfile 管理（避免 pgrep -f 匹配到调用者自己）
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$ROOT/.run/mock.pid"
LOG="${2:-$ROOT/.spike/mock-requests.log}"
case "${1:-start}" in
  stop)
    [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
    ;;
  start)
    [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null && sleep 0.5
    : >"$LOG"
    setsid node "$ROOT/spike/mock-openai.mjs" 11435 "$LOG" "我是本地模型，在你机器上跑。" \
      >"$ROOT/.spike/mock.out" 2>&1 < /dev/null &
    echo $! >"$PIDFILE"
    sleep 1
    curl -sf http://127.0.0.1:11435/v1/models >/dev/null && echo "mock ok" || { echo "mock failed"; tail -3 "$ROOT/.spike/mock.out"; exit 1; }
    ;;
esac
