#!/usr/bin/env bash
# dsh-baseline.sh — DSH 侧基线：工具声明面的测量 / 漂移守门 / 更新
#
# P6（基线重建）的第一块。旧纪律：**"没有守门的地方，错误不会被发现，只会被传播"** ⇒
# 换底座后必须重建"工具面字节账"，否则工具悄悄膨胀没人知道。
#
# 用法：
#   bash scripts/dsh-baseline.sh            # 测量并打印（不改文件）
#   bash scripts/dsh-baseline.sh --check    # 与基线比对（漂移 ⇒ exit 1）
#   bash scripts/dsh-baseline.sh --update   # 更新基线（**需人工确认**后提交）
#
# 口径与不可比说明见 dsh/spike/measure-surface.mjs 文件头。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

MODE="${1:-measure}"
case "$MODE" in
  measure) ARGS=() ;;
  --check|check) ARGS=(--check) ;;
  --update|update) ARGS=(--update) ;;
  *) echo "用法: $0 [--check|--update]" >&2; exit 2 ;;
esac

ARTIFACT="$ROOT/dsh/plugin/dist/my-pi-plugin.mjs"
if [ ! -f "$ARTIFACT" ]; then
  echo "→ 插件产物不存在，先构建…"
  bash "$ROOT/scripts/dsh-build.sh" --no-smoke || { echo "❌ 构建失败" >&2; exit 2; }
fi

if [ ! -d "$ROOT/dsh/spike/node_modules/@deepseek-ai/dsh-tools" ]; then
  echo "❌ 缺 spike 依赖（@deepseek-ai/*）；先跑 bash scripts/dsh-spike.sh（它会安装）" >&2
  exit 2
fi

node "$ROOT/dsh/spike/measure-surface.mjs" "${ARGS[@]}"
