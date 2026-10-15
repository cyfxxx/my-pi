#!/usr/bin/env bash
# dsh-smoke-profile.sh — 验证"my-pi 插件能被**真实 dsh launcher** 组合进 profile"
#
# 为什么要有它：spike（scripts/dsh-spike.sh）证的是"适配层在最小 cordis harness 里能跑"，
# 但那不是 DSH 真正的加载路径 —— launcher 走的是 `$DSH_HOME/profiles/<name>` +
# `cordis.patch.yml` 的组合。本脚本用**隔离的 DSH_HOME** 做这件事的干跑：
#
#   ① bash scripts/dsh-build.sh --no-smoke            # 产出 dsh/plugin/dist/my-pi-plugin.mjs
#   ② 隔离 DSH_HOME 下从内置模板建一个 profile        # --from-default-profile headless --dump-config
#   ③ `--patch dsh/profile/my-pi.patch.yml --dump-config` ⇒ 组合结果里**必须出现我们的插件条目**
#
# **不启动 Host**（只 `--dump-config`）：既避开"打扰正在运行的 dsh web"，也避开凭据/内存问题。
#
# 用法：bash scripts/dsh-smoke-profile.sh
#   DSH_BIN=<path>   指定 dsh 可执行文件（默认 PATH，其次 npx 缓存）
#   SKIP 条件：找不到 dsh ⇒ 记 SKIP 并以 0 退出（**不假装通过**）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

DSH_BIN="${DSH_BIN:-$(command -v dsh 2>/dev/null || true)}"
if [ -z "$DSH_BIN" ]; then
  for cand in "$HOME"/.npm/_npx/*/node_modules/.bin/dsh; do
    [ -x "$cand" ] && DSH_BIN="$cand" && break
  done
fi
if [ -z "$DSH_BIN" ] || [ ! -e "$DSH_BIN" ]; then
  echo "· SKIP：未找到 dsh 可执行文件（设 DSH_BIN=… 或先装 DSH）"
  exit 0
fi
echo "=== DSH profile 组合冒烟 ==="
echo "dsh: $DSH_BIN（$(node "$DSH_BIN" --version 2>/dev/null || echo '?')）"

ARTIFACT="$ROOT/dsh/plugin/dist/my-pi-plugin.mjs"
if [ ! -f "$ARTIFACT" ]; then
  echo "→ 产物不存在，先构建…"
  bash "$ROOT/scripts/dsh-build.sh" --no-smoke || { echo "❌ 构建失败" >&2; exit 2; }
fi
echo "✓ 插件产物：$ARTIFACT（$(du -h "$ARTIFACT" | awk '{print $1}')）"

SMOKE_HOME="${DSH_SMOKE_HOME:-/tmp/my-pi-dsh-smoke-home}"
PROFILE="${DSH_SMOKE_PROFILE:-mypi-smoke}"
rm -rf "$SMOKE_HOME"
mkdir -p "$SMOKE_HOME"
echo "→ 隔离 DSH_HOME：$SMOKE_HOME（不动正在跑的 profile）"

TEMPLATE="${DSH_SMOKE_TEMPLATE:-headless}"
if ! DSH_HOME="$SMOKE_HOME" timeout 300 node "$DSH_BIN" --profile "$PROFILE" --from-default-profile "$TEMPLATE" --dump-config >/tmp/dsh-smoke-base.txt 2>/tmp/dsh-smoke-base.err; then
  echo "❌ 从模板 $TEMPLATE 建 profile 失败：" >&2
  tail -3 /tmp/dsh-smoke-base.err >&2
  exit 2
fi
echo "✓ 已建 profile（模板 $TEMPLATE，基线条目 $(grep -c '^- id:' /tmp/dsh-smoke-base.txt) 条）"

if ! DSH_HOME="$SMOKE_HOME" timeout 300 node "$DSH_BIN" --profile "$PROFILE" --patch "$ROOT/dsh/profile/my-pi.patch.yml" --dump-config >/tmp/dsh-smoke-patched.txt 2>/tmp/dsh-smoke-patched.err; then
  echo "❌ 叠加 my-pi 覆盖层失败：" >&2
  tail -3 /tmp/dsh-smoke-patched.err >&2
  exit 1
fi

if grep -q 'id: my-pi' /tmp/dsh-smoke-patched.txt; then
  echo "✓ 组合树里出现 my-pi 插件条目："
  grep -A2 '^- id: my-pi' /tmp/dsh-smoke-patched.txt | sed 's/^/    /'
else
  echo "❌ 组合树里没有 my-pi 条目 ⇒ 覆盖层没生效" >&2
  exit 1
fi

if grep -qE 'entry "my-pi" not found|error:' /tmp/dsh-smoke-patched.err; then
  echo "⚠ launcher 有告警：" >&2
  tail -3 /tmp/dsh-smoke-patched.err >&2
fi

rm -rf "$SMOKE_HOME"
echo "🎉 DSH profile 组合冒烟通过（插件已被真实 launcher 接受进 profile；未启动 Host）"
