#!/usr/bin/env bash
# dsh-baseline.sh — DSH 侧基线：工具声明面的测量 / 漂移守门 / 更新
#
# P6（基线重建）的第一块。旧纪律：**"没有守门的地方，错误不会被发现，只会被传播"** ⇒
# 换底座后必须重建"工具面字节账"，否则工具悄悄膨胀没人知道。
#
# 用法：
#   bash scripts/dsh-baseline.sh            # 测量并打印（不改文件）
#   bash scripts/dsh-baseline.sh --check    # 与基线比对（任一漂移 ⇒ exit 1）
#   bash scripts/dsh-baseline.sh --update   # 更新基线（**需人工确认**后提交）
#   bash scripts/dsh-baseline.sh --tools    # 只量工具声明面
#   bash scripts/dsh-baseline.sh --prompt   # 只量注入面（system prompt）
#
# 两块基线：
#   ① 工具声明面 dsh/baseline/tool-surface.json（口径见 dsh/spike/measure-surface.mjs 文件头）
#   ② 注入面     dsh/baseline/system-prompt.json（口径见 dsh/spike/measure-prompt.mjs 文件头）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

# 参数解析：**可组合**（`--prompt --check`、`--tools --update`……）。
# ★ 曾经写成一个位置参数的三选一 switch —— 于是 `--prompt` 会把 `--check` 丢掉，
#   命令"看起来在守门"实际只是测量（**虚假绿**）。探针（改源文件后 check）当场发现了它。
ARGS=()
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --check|check) ARGS+=(--check) ;;
    --update|update) ARGS+=(--update) ;;
    --tools) ONLY=tools ;;
    --prompt) ONLY=prompt ;;
    ""|measure) : ;;
    *) echo "用法: $0 [--check|--update] [--tools|--prompt]" >&2; exit 2 ;;
  esac
done
if [ "${#ARGS[@]}" -gt 1 ]; then
  echo "❌ --check 与 --update 不能同时给" >&2
  exit 2
fi

ARTIFACT="$ROOT/dsh/plugin/dist/my-pi-plugin.mjs"
if [ ! -f "$ARTIFACT" ]; then
  echo "→ 插件产物不存在，先构建…"
  bash "$ROOT/scripts/dsh-build.sh" --no-smoke || { echo "❌ 构建失败" >&2; exit 2; }
fi

if [ ! -d "$ROOT/dsh/spike/node_modules/@deepseek-ai/dsh-tools" ]; then
  echo "❌ 缺 spike 依赖（@deepseek-ai/*）；先跑 bash scripts/dsh-spike.sh（它会安装）" >&2
  exit 2
fi

run_one() { # $1 = 标签，$2 = 脚本
  echo "── $1 ──"
  node "$ROOT/dsh/spike/$2" "${ARGS[@]}"
  local rc=$?
  [ "$rc" -ne 0 ] && FAILED=1
  return 0
}

FAILED=0
[ -n "$ONLY" ] && [ "$ONLY" != "tools" ] || run_one "工具声明面" measure-surface.mjs
[ -n "$ONLY" ] && [ "$ONLY" != "prompt" ] || run_one "注入面（system prompt）" measure-prompt.mjs

if [ "$FAILED" = "1" ]; then
  echo "❌ 基线守门失败（见上面的漂移明细）" >&2
  exit 1
fi
