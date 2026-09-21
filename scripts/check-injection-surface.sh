#!/bin/bash
# check-injection-surface.sh — 系统提示词注入面基线守门（VISION P2）
#
# 对 pi 注入 system prompt 的前缀输入（portable/agent/APPEND_SYSTEM.md + AGENTS.md）
# 取指纹并与基线比对，捕获"无意改动注入面导致缓存前缀断裂/行为漂移"。
# 用法：
#   bash scripts/check-injection-surface.sh            # 比对（失配 exit 1）
#   bash scripts/check-injection-surface.sh --update   # 写入/更新基线（需人工确认）
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$ROOT/portable/agent/injection-baseline.json"
FILES=(
  "portable/agent/APPEND_SYSTEM.md"
  "portable/agent/AGENTS.md"
)

hash_file() {
  local f="$ROOT/$1"
  if [ -f "$f" ]; then sha256sum "$f" | awk '{print $1}'; else echo "missing"; fi
}

combined=""
for f in "${FILES[@]}"; do
  combined="${combined}$(hash_file "$f")  $f"$'\n'
done
combined_hash="$(printf '%s' "$combined" | sha256sum | awk '{print $1}')"

if [ "${1:-}" = "--update" ]; then
  {
    echo "{"
    echo "  \"combined\": \"$combined_hash\","
    echo "  \"files\": {"
    first=1
    for f in "${FILES[@]}"; do
      [ "$first" = "1" ] || echo ","
      first=0
      printf '    "%s": "%s"' "$f" "$(hash_file "$f")"
    done
    echo ""
    echo "  }"
    echo "}"
  } > "$BASELINE"
  echo "✓ 注入面基线已更新: $BASELINE"
  exit 0
fi

if [ ! -f "$BASELINE" ]; then
  echo "⚠ 注入面基线不存在（首次）：运行 bash scripts/check-injection-surface.sh --update 建立"
  exit 0
fi

if grep -q "\"combined\": \"$combined_hash\"" "$BASELINE"; then
  echo "✓ 注入面基线一致（$combined_hash）"
  exit 0
else
  echo "❌ 注入面与基线不一致（system prompt 前缀可能变化，影响缓存命中）" >&2
  echo "  当前: $combined_hash" >&2
  grep '"combined"' "$BASELINE" | sed 's/^/  基线: /' >&2
  echo "  确认改动符合预期后运行: bash scripts/check-injection-surface.sh --update" >&2
  exit 1
fi
