#!/usr/bin/env bash
# 一条指令：mypi.sh [tui|web|status|stop|doctor|model online|local]
#   宿主管理交给 host/launch.mjs（自包含，不依赖本仓 DSH 那条线的脚本）。
#   过渡开关：MYPI_WITH_FACADE=1 时额外挂旧 my-pi 适配层（仅用于对照，M0.2 后默认不挂）。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

cmd="${1:-tui}"
# 与 host/launch.mjs 解析方式保持一致（否则 tui 找不到 community 安装）
HOME_DIR="${MYPI_HOME:-$ROOT/.run/home}"
launcher=(node host/launch.mjs)

running() { "${launcher[@]}" status >/dev/null 2>&1; }
ensure_host() { running || "${launcher[@]}" start ${MYPI_WITH_FACADE:+--with-facade}; }
host_url() { "${launcher[@]}" url 2>/dev/null || true; }

# 社区 TUI 可能装在三个位置：我们的 home、显式 DSH_HOME、用户默认 ~/.dsh
tui_bin() {
  local candidates=(
    "$HOME_DIR/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js"
    "${DSH_HOME:-/nonexistent}/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js"
    "$HOME/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

case "$cmd" in
  tui)
    if [ "${MYPI_TUI:-community}" = "community" ] && bin="$(tui_bin)"; then
      # 委托给 TUI 自己的 profile：DSH_HOME 必须是 bin 往上 5 层（…/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/x.js）
      export DSH_HOME="${HOME_DIR}"
      exec node "$bin" "$@"
    fi
    if [ "${MYPI_TUI:-community}" = "community" ]; then
      echo "提示：没找到社区 TUI（先跑 assistant/scripts/setup-tui.sh），改用自带 pi-tui 客户端。" >&2
    fi
    ensure_host
    url="$(host_url)"
    [ -n "$url" ] || { echo "✗ 宿主没起来。看日志：$ROOT/.run/host.log；停止：$0 stop" >&2; exit 1; }
    exec node bin/tui.mjs "$url"
    ;;
  web)
    ensure_host
    echo "浏览器打开：$(host_url)"
    echo "关闭：$0 stop   （状态：$0 status）"
    ;;
  status) "${launcher[@]}" status ;;
  stop)
    "${launcher[@]}" stop
    ;;
  doctor) exec bash scripts/doctor-mypi.sh ;;
  model)
    ensure_host
    exec node bin/model.mjs "${2:-}"
    ;;
  *)
    echo "用法：$0 [tui|web|status|stop|doctor|model online|local]" >&2
    exit 2
    ;;
esac
