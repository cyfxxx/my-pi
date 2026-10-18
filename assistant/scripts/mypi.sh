#!/usr/bin/env bash
# 一条指令：mypi.sh [tui|web|status|stop|model online|local]
#   宿主管理交给 host/launch.mjs（自包含，不依赖本仓 DSH 那条线的脚本）。
#   过渡开关：MYPI_WITH_FACADE=1 时额外挂旧 my-pi 适配层（仅用于对照，M0.2 后默认不挂）。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

cmd="${1:-tui}"
launcher=(node host/launch.mjs)

running() {
  "${launcher[@]}" status >/dev/null 2>&1
}

ensure_host() {
  if running; then return 0; fi
  "${launcher[@]}" start ${MYPI_WITH_FACADE:+--with-facade}
}

case "$cmd" in
  tui)
    TUI_BIN="$DSH_HOME/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js"
    if [ -f "$TUI_BIN" ] && [ "${MYPI_TUI:-community}" = "community" ]; then
      exec node "$TUI_BIN" "$@"
    fi
    ensure_host
    exec node bin/tui.mjs "$("${launcher[@]}" url)"
    ;;
  web)
    ensure_host
    echo "浏览器打开：$("${launcher[@]}" url)"
    ;;
  status|stop)
    "${launcher[@]}" "$cmd"
    ;;
  model)
    ensure_host
    exec node bin/model.mjs "${2:-}"
    ;;
  *)
    echo "用法：$0 [tui|web|status|stop]" >&2
    exit 2
    ;;
esac
