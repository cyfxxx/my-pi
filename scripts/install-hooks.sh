#!/bin/bash
# install-hooks.sh — 安装本地 git 钩子（pre-commit 快检 / pre-push 全量）
#
# 本地无 CI（.github/ 已移除），钩子是唯一的自动防线。`.git/config` 的 core.hooksPath
# 不随仓库分发，因此新设备/fresh clone 后需要跑一次本脚本。
#
# 用法：bash scripts/install-hooks.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOOKS_DIR=".githooks"
if [ ! -d "$HOOKS_DIR" ]; then
  echo "❌ 未找到 $HOOKS_DIR/" >&2
  exit 1
fi

for hook in pre-commit pre-push; do
  if [ -f "$HOOKS_DIR/$hook" ]; then
    chmod +x "$HOOKS_DIR/$hook"
  else
    echo "⚠ 缺少 $HOOKS_DIR/$hook" >&2
  fi
done

git config core.hooksPath "$HOOKS_DIR"
echo "✓ 已启用 git 钩子：core.hooksPath=$HOOKS_DIR"
echo "  pre-commit → bash scripts/golden-tasks.sh --fast（秒级结构守门）"
echo "  pre-push   → bash scripts/golden-tasks.sh（含 tsc + vitest 全量）"
echo "  当前状态：$(git config --get core.hooksPath)"
