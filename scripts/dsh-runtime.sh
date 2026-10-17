#!/usr/bin/env bash
# dsh-runtime.sh — 把 **DSH 宿主**装进仓内，实现"跟主分支一样"的完全便携
#
# 为什么需要：`dsh` CLI 原来只存在于 npm 的 npx 缓存（`~/.npm/_npx/<hash>/`）里 —— 那是**仓外**、
# 会被 `npm cache clean` 清掉、换机器就没有。主分支的便携化约定是"运行时进 `runtime/<平台>/`"
# （gitignored，由脚本装），这里照同一套把宿主装到 `runtime/<平台>/ext/dsh/`。
#
# 用法：
#   bash scripts/dsh-runtime.sh install    # 装宿主（走仓内 npm/node；需要一次网络，带重试）
#   bash scripts/dsh-runtime.sh install --from-npx
#                                         # 从**已有的完整 npx 安装**搬运（同样是完全便携：实测那套里
#                                         # 没有任何绝对符号链接；网络不好时首选这条）
#   bash scripts/dsh-runtime.sh verify     # 校验：可执行、版本对得上、能 resolve 自己的 bin
#   bash scripts/dsh-runtime.sh status     # 只报告：装没装 / 版本 / 落点 / 解析来源
#   bash scripts/dsh-runtime.sh path       # 打印仓内宿主 node_modules 的路径（给别的脚本用）
#
# 解析顺序（**仓内优先**，与主分支 node/python 的策略一致）：
#   ① runtime/<平台>/ext/dsh        ← 本脚本装的（完全便携）
#   ② command -v dsh                ← 系统/自定义安装
#   ③ ~/.npm/_npx/*/node_modules/.bin/dsh  ← npx 缓存（**非便携**，只作兜底）
#
# 版本钉死：`DSH_VERSION`。换版本必须同时重跑 `bash scripts/dsh-runtime.sh install` 与
# `bash scripts/dsh-build.sh`（产物的 `@deepseek-ai/*` 是 external，由宿主提供）。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
# shellcheck source=scripts/lib-portable.sh
. "$ROOT/scripts/lib-portable.sh"

DSH_VERSION="0.2.0-rc.2"

host_root() { printf '%s/ext/dsh' "$(pi_runtime_root)"; }
host_bin() { printf '%s/node_modules/.bin/dsh' "$(host_root)"; }
host_modules() { printf '%s/node_modules' "$(host_root)"; }

cmd_status() {
  echo "=== DSH 宿主（仓内）==="
  echo "  期望版本：$DSH_VERSION"
  echo "  安装落点：$(host_root)"
  if [ -x "$(host_bin)" ]; then
    local have
    have="$("$(host_bin)" --version 2>/dev/null | tr -d '[:space:]')"
    echo "  已安装  ：是（$have）"
    [ "$have" = "$DSH_VERSION" ] && echo "  版本匹配：✓" || echo "  版本匹配：✗（期望 $DSH_VERSION）"
  else
    echo "  已安装  ：否（跑 bash scripts/dsh-runtime.sh install）"
  fi
  echo "=== 解析顺序实际命中 ==="
  local hit
  hit="$(resolve_dsh_bin 2>/dev/null || true)"
  if [ -n "$hit" ]; then
    case "$hit" in
      "$(host_root)"/*) echo "  → 仓内宿主（完全便携）：$hit" ;;
      /npx/*|*_npx/*)   echo "  → **npx 缓存（非便携）**：$hit" ;;
      *)                echo "  → 系统/自定义：$hit" ;;
    esac
  else
    echo "  → 未找到任何 dsh（先 install）"
  fi
}

# 解析宿主可执行文件（仓内优先；不做网络/安装副作用）
resolve_dsh_bin() {
  if [ -x "$(host_bin)" ]; then printf '%s' "$(host_bin)"; return 0; fi
  local system
  system="$(command -v dsh 2>/dev/null || true)"
  if [ -n "$system" ]; then printf '%s' "$system"; return 0; fi
  local cand
  for cand in "$HOME"/.npm/_npx/*/node_modules/.bin/dsh; do
    [ -x "$cand" ] && { printf '%s' "$cand"; return 0; }
  done
  return 1
}

# 从"已有的完整 npx 安装"搬运（不联网）。为什么要这条：这套 DSH 若已在本机跑过，
# npx 缓存里就有一份**完整且版本正确**的树（实测：无绝对符号链接 ⇒ 搬过来仍是便携的）。
cmd_install_from_npx() {
  local src=""
  local cand
  for cand in "$HOME"/.npm/_npx/*/node_modules; do
    [ -f "$cand/@deepseek-ai/dsh/package.json" ] || continue
    local v=""
    v="$(node -e "process.stdout.write(require('$cand/@deepseek-ai/dsh/package.json').version)" 2>/dev/null || true)"
    [ "$v" = "$DSH_VERSION" ] && { src="$cand"; break; }
  done
  if [ -z "$src" ]; then
    echo "❌ 没找到版本为 $DSH_VERSION 的 npx 安装（先跑 install，或换一台有网机器）" >&2
    return 2
  fi
  echo "→ 从 $src 搬运到 $(host_root)（约需 1-2 分钟）"
  rm -rf "$(host_root)/node_modules"
  mkdir -p "$(host_root)"
  # ★ 必须 `cp -a`（保留符号链接且不动源）。**禁止** `cp -al`：硬链接会改到源（本仓有过真实事故）。
  if ! cp -a "$src" "$(host_root)/node_modules"; then
    echo "❌ 复制失败" >&2
    return 2
  fi
  # 便携性自检：不许有指向仓外的绝对符号链接（有的话等于没搬走）
  local abs_links
  abs_links="$(python3 - "$(host_root)/node_modules" <<'PYEOF'
import os, sys
root = sys.argv[1]
bad = 0
for base, dirs, files in os.walk(root):
    for name in dirs + files:
        path = os.path.join(base, name)
        if os.path.islink(path) and os.readlink(path).startswith('/'):
            bad += 1
print(bad)
PYEOF
)"
  if [ "${abs_links:-0}" != "0" ]; then
    echo "❌ 搬运后仍有 $abs_links 个绝对符号链接（会指回仓外 ⇒ 不便携）" >&2
    return 2
  fi
  echo "✓ 无绝对符号链接（搬运是自包含的）"
  cmd_verify
}

cmd_install() {
  if [ "${1:-}" = "--from-npx" ]; then cmd_install_from_npx; return $?; fi
  mkdir -p "$(host_root)" || { echo "❌ 无法创建 $(host_root)" >&2; return 2; }
  # 用仓内 node/npm（lib-portable.sh 会按需前置 PATH）；缓存也指到仓内，避免污染 $HOME
  pi_portable_env >/dev/null 2>&1 || true
  echo "→ 安装 @deepseek-ai/dsh@$DSH_VERSION 到 $(host_root)"
  # 网络慢：给足超时与重试（实测 registry 能拉到 packument、但 tarball 会 ETIMEDOUT）
  if ! npm --prefix "$(host_root)" install "@deepseek-ai/dsh@$DSH_VERSION" \
      --no-audit --no-fund --loglevel=error --cache "$(pi_npm_cache)" \
      --fetch-timeout=600000 --fetch-retries=5 --fetch-retry-maxtimeout=120000; then
    echo "❌ 安装失败（网络/registry？）。可改用：bash scripts/dsh-runtime.sh install --from-npx" >&2
    return 2
  fi
  cmd_verify
}

cmd_verify() {
  local fail=0
  [ -x "$(host_bin)" ] || { echo "❌ 缺少可执行文件：$(host_bin)" >&2; fail=1; }
  if [ "$fail" = "0" ]; then
    local have
    have="$("$(host_bin)" --version 2>/dev/null | tr -d '[:space:]')"
    if [ "$have" = "$DSH_VERSION" ]; then
      echo "✓ 版本匹配：$have"
    else
      echo "❌ 版本不匹配：装的是 '$have'，期望 '$DSH_VERSION'" >&2
      fail=1
    fi
    # 能解析到自己的入口（证明 node_modules 是完整的，不是半个缓存）
    if node --input-type=module -e "
import { createRequire } from 'node:module';
const require = createRequire('$(host_modules)/');
require.resolve('@deepseek-ai/dsh/lib/bin.js');
" 2>/dev/null; then
      echo "✓ 入口可解析：@deepseek-ai/dsh/lib/bin.js"
    else
      echo "❌ 入口解析失败（node_modules 不完整）" >&2
      fail=1
    fi
  fi
  [ "$fail" = "0" ] && { echo "🎉 仓内 DSH 宿主可用（完全便携）"; return 0; }
  return 1
}

case "${1:-status}" in
  install) cmd_install "${2:-}" ;;
  verify)  cmd_verify ;;
  status)  cmd_status ;;
  path)    host_modules ;;
  *) echo "用法: $0 {install|verify|status|path}" >&2; exit 2 ;;
esac
