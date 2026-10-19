#!/usr/bin/env bash
# vendor-dsh.sh — 把 DSH 宿主装进仓内 `runtime/<平台>/ext/dsh`（自包含，不依赖老项目的 lib-portable.sh）。
#
# 干净仓库（从 my-pi 导出后）只需要这一个脚本就能拿到运行时：
#   bash assistant/scripts/vendor-dsh.sh install     # 装 DSH_VERSION 指定的版本
#   bash assistant/scripts/vendor-dsh.sh verify      # 校验版本 + 入口可解析
#   bash assistant/scripts/vendor-dsh.sh status
#
# 为什么不是 npm 依赖：宿主由启动器以子进程方式跑（`runtime/<平台>/ext/dsh/node_modules/.bin/dsh`），
# 这样 profile、凭据、会话都落在仓内 home，做到"整目录搬走就能跑"。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
# 版本钉：升级时只改这一行
DSH_VERSION="${DSH_VERSION:-0.2.0-rc.2}"

platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$os" in darwin) os=darwin ;; *) os=linux ;; esac
  arch="$(uname -m)"
  case "$arch" in aarch64|arm64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; esac
  printf '%s-%s' "$os" "$arch"
}
HOST_ROOT="$REPO/runtime/$(platform)/ext/dsh"
HOST_BIN="$HOST_ROOT/node_modules/.bin/dsh"
CACHE="$REPO/runtime/npm-cache"

cmd_install() {
  mkdir -p "$HOST_ROOT" "$CACHE" || { echo "✗ 无法创建 $HOST_ROOT" >&2; return 2; }
  echo "→ 安装 @deepseek-ai/dsh@$DSH_VERSION 到 $HOST_ROOT"
  if ! npm --prefix "$HOST_ROOT" install "@deepseek-ai/dsh@$DSH_VERSION" \
      --no-audit --no-fund --loglevel=error --cache "$CACHE" \
      --fetch-timeout=600000 --fetch-retries=5 --fetch-retry-maxtimeout=120000; then
    echo "✗ 安装失败（网络/registry）。可重试；或把已装好的 runtime/ 目录直接拷过来。" >&2
    return 2
  fi
  cmd_verify
}

cmd_verify() {
  local fail=0
  [ -x "$HOST_BIN" ] || { echo "✗ 缺少可执行文件：$HOST_BIN" >&2; fail=1; }
  if [ "$fail" = "0" ]; then
    local have
    have="$("$HOST_BIN" --version 2>/dev/null | tr -d '[:space:]')"
    if [ "$have" = "$DSH_VERSION" ]; then
      echo "✓ 版本匹配：$have"
    else
      echo "✗ 版本不匹配：装的是 '$have'，期望 '$DSH_VERSION'" >&2
      fail=1
    fi
    if node --input-type=module -e "
import { createRequire } from 'node:module';
createRequire('$HOST_ROOT/node_modules/').resolve('@deepseek-ai/dsh/lib/bin.js');
" 2>/dev/null; then
      echo "✓ 入口可解析：@deepseek-ai/dsh/lib/bin.js"
    else
      echo "✗ 入口解析失败（安装不完整）" >&2
      fail=1
    fi
  fi
  return "$fail"
}

cmd_status() {
  echo "版本钉：$DSH_VERSION"
  echo "落点  ：$HOST_ROOT"
  if [ -x "$HOST_BIN" ]; then
    echo "已安装：$("$HOST_BIN" --version 2>/dev/null || echo '?')"
  else
    echo "未安装"
  fi
}

case "${1:-status}" in
  install) cmd_install ;;
  verify) cmd_verify ;;
  status) cmd_status ;;
  *) echo "用法：$0 [install|verify|status]" >&2; exit 2 ;;
esac
