#!/usr/bin/env bash
# Termux / 陌生环境可行性探针：只读 + 一次"起宿主、拿 URL、停宿主"的自检。
#
# 用法（在目标机器上）：
#   bash assistant/scripts/probe-termux.sh            # 完整（会起一次宿主，约 30–60s）
#   bash assistant/scripts/probe-termux.sh --quick    # 只体检，不起宿主
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
QUICK="${1:-}"
PORT="${MYPI_PROBE_PORT:-3199}"

say() { printf '\n=== %s ===\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1 && echo yes || echo no; }

say "环境"
printf 'uname      : %s\n' "$(uname -a 2>/dev/null)"
printf 'node       : %s (%s)\n' "$(node -v 2>/dev/null || echo 缺失)" "$(command -v node 2>/dev/null || echo -)"
printf 'npm        : %s\n' "$(npm -v 2>/dev/null || echo 缺失)"
printf 'git/tmux   : %s / %s\n' "$(have git)" "$(have tmux)"
printf 'termux 前缀: %s\n' "${PREFIX:-（非 Termux）}"
printf 'libc(glibc): %s\n' "$(getconf GNU_LIBC_VERSION 2>/dev/null || echo 未检出)"
printf 'memtotal   : %s\n' "$(awk '/MemTotal/{printf "%dMB", $2/1024}' /proc/meminfo 2>/dev/null || echo 未知)"
printf 'disk(仓库) : %s\n' "$(df -h "$REPO" 2>/dev/null | awk 'NR==2{print $4}')" 

say "宿主"
DSH_BIN="$REPO/runtime/$(uname -s | tr '[:upper:]' '[:lower:]' | sed 's/darwin/darwin/')-$(uname -m | sed 's/aarch64/arm64/; s/x86_64/x64/')/ext/dsh/node_modules/.bin/dsh"
if [ -x "$DSH_BIN" ]; then
  echo "仓内宿主：$DSH_BIN"
  "$DSH_BIN" --version 2>&1 | head -1 || echo "✗ 宿主起不来（原生依赖/Node 版本问题）"
else
  echo "✗ 仓内没有该平台的宿主：$DSH_BIN"
  command -v dsh >/dev/null 2>&1 && echo "系统里有 dsh：$(command -v dsh)" || echo "系统里也没有 dsh"
fi

if [ "$QUICK" = "--quick" ]; then
  say "已跳过宿主自检（--quick）"
  exit 0
fi

say "起宿主自检（端口 $PORT，临 home）"
TMP_HOME="$(mktemp -d)"
cleanup() { MYPI_PORT="$PORT" MYPI_HOME="$TMP_HOME" node "$ROOT/host/launch.mjs" stop >/dev/null 2>&1; rm -rf "$TMP_HOME"; }
trap cleanup EXIT
if MYPI_PORT="$PORT" MYPI_HOME="$TMP_HOME" timeout 180 node "$ROOT/host/launch.mjs" start >/tmp/probe-start.log 2>&1; then
  URL="$(MYPI_PORT="$PORT" MYPI_HOME="$TMP_HOME" node "$ROOT/host/launch.mjs" url 2>/dev/null)"
  echo "✓ 宿主起来了（URL 长度 ${#URL}）"
  CODE="$(curl -sL -c /tmp/probe-jar -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null || echo 000)"
  echo "✓ Web 入口 HTTP $CODE"
  [ "$CODE" = "200" ] && echo "🎉 该环境可以跑 my-pi（宿主 + Web 都正常）" || echo "⚠️ 宿主起来了但 Web 入口异常（HTTP $CODE）"
else
  echo "✗ 宿主启动失败，日志尾部："
  tail -15 /tmp/probe-start.log 2>/dev/null
fi
