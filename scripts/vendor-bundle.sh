#!/bin/bash
# vendor-bundle.sh — vendor/pi 的离线归档（防止上游 commit 消失导致无法引导）
#
# 背景：`vendor/pi` 是 gitignore 的独立 clone，仓库里只留 `vendor/PINNED_COMMIT`。
# 上游若改写历史/删库，fresh bootstrap 就失效。本脚本提供离线归档与恢复。
#
# bundle 是二进制且体积较大（完整历史），**不纳入主仓库**（见 .gitignore 的 vendor/*.bundle）；
# 请自行保存到仓库外（外部硬盘 / 私有对象存储 / release asset）。
#
# 用法：
#   bash scripts/vendor-bundle.sh create [输出路径]   # 归档当前 PINNED_COMMIT
#   bash scripts/vendor-bundle.sh restore <bundle>    # 从归档恢复 vendor/pi
#   bash scripts/vendor-bundle.sh status              # 查看 PINNED/归档状态
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

VENDOR="$ROOT/vendor/pi"
PINNED_FILE="$ROOT/vendor/PINNED_COMMIT"
UPSTREAM_URL="https://github.com/earendil-works/pi-mono.git"

pinned() {
  [ -f "$PINNED_FILE" ] && tr -d '[:space:]' < "$PINNED_FILE" || echo ""
}

default_bundle() {
  local sha; sha="$(pinned)"
  echo "$ROOT/vendor/pi-${sha:0:12}.bundle"
}

cmd_create() {
  local out="${1:-$(default_bundle)}"
  local sha; sha="$(pinned)"
  [ -n "$sha" ] || { echo "❌ 缺少 vendor/PINNED_COMMIT" >&2; exit 1; }
  [ -d "$VENDOR/.git" ] || { echo "❌ vendor/pi 不是 git 仓库，无法归档" >&2; exit 1; }
  git -C "$VENDOR" cat-file -e "${sha}^{commit}" 2>/dev/null || {
    echo "❌ vendor/pi 中不存在 commit $sha（先运行 scripts/build.sh 或 sync-upstream.sh）" >&2; exit 1; }

  # git bundle 需要 ref（裸 SHA 会报 "Refusing to create empty bundle"）：临时建 ref 再删。
  local ref="refs/heads/_my_pi_bundle"
  local abs; abs="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
  echo "归档 $sha → $abs"
  git -C "$VENDOR" update-ref "$ref" "$sha" || exit 1
  if ! git -C "$VENDOR" bundle create "$abs" "$ref"; then
    git -C "$VENDOR" update-ref -d "$ref"
    echo "❌ 归档失败" >&2
    exit 1
  fi
  git -C "$VENDOR" update-ref -d "$ref"
  local size; size=$(du -h "$abs" | cut -f1)
  echo "✓ 归档完成（$size）"
  echo "  提示：bundle 不入库（.gitignore 已忽略 vendor/*.bundle），请另存到仓库外。"
}

cmd_restore() {
  local bundle="${1:-}"
  [ -n "$bundle" ] && [ -f "$bundle" ] || { echo "用法：bash scripts/vendor-bundle.sh restore <bundle>" >&2; exit 1; }
  local sha; sha="$(pinned)"
  [ -n "$sha" ] || { echo "❌ 缺少 vendor/PINNED_COMMIT" >&2; exit 1; }
  local abs; abs="$(cd "$(dirname "$bundle")" && pwd)/$(basename "$bundle")"

  if [ -d "$VENDOR/.git" ]; then
    echo "vendor/pi 已存在，跳过初始化（如需重建请先移走该目录）"
  else
    mkdir -p "$(dirname "$VENDOR")"
    git init -q "$VENDOR"
    git -C "$VENDOR" remote add upstream "$UPSTREAM_URL" 2>/dev/null || true
  fi
  echo "从归档取回 $sha ..."
  if ! git -C "$VENDOR" fetch -q "$abs" "refs/heads/_my_pi_bundle:refs/heads/_my_pi_bundle"; then
    echo "❌ 从归档 fetch 失败：$abs" >&2
    exit 1
  fi
  git -C "$VENDOR" checkout -q "$sha" || { echo "❌ checkout $sha 失败" >&2; exit 1; }
  echo "✓ vendor/pi 已恢复到 $sha"
  echo "  下一步：bash scripts/build.sh（幂等应用 patches/）"
}

cmd_status() {
  local sha; sha="$(pinned)"
  echo "PINNED_COMMIT: ${sha:-（缺失）}"
  if [ -d "$VENDOR/.git" ]; then
    if [ -n "$sha" ] && git -C "$VENDOR" cat-file -e "${sha}^{commit}" 2>/dev/null; then
      echo "vendor/pi: 存在且含该 commit ✅"
    else
      echo "vendor/pi: 存在但不含该 commit ⚠"
    fi
  else
    echo "vendor/pi: 不存在（fresh checkout，需引导）"
  fi
  local found=0
  for b in "$ROOT"/vendor/*.bundle; do
    [ -e "$b" ] || continue
    found=1
    echo "离线归档: $b（$(du -h "$b" | cut -f1)）"
  done
  [ "$found" = "0" ] && echo "离线归档: 无 ⚠（上游若改写历史将无法引导；建议 bash scripts/vendor-bundle.sh create 并另存）"
}

case "${1:-status}" in
  create) shift; cmd_create "${1:-}" ;;
  restore) shift; cmd_restore "${1:-}" ;;
  status) cmd_status ;;
  *) echo "用法：bash scripts/vendor-bundle.sh {create [out]|restore <bundle>|status}" >&2; exit 1 ;;
esac
