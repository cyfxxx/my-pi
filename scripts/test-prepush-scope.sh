#!/bin/bash
# test-prepush-scope.sh — pre-push 门禁范围判定守门
#
# 为什么值得单独守：scripts/prepush-scope.sh 决定 pre-push 跑全量还是快检，判错会**静默**
# 削弱推送防线（把含代码的推送也降级）。这里在临时仓库里造真实提交，锁定四类判定：
#   · 纯 portable/memory/stats/ 改动 → fast
#   · 任何代码/配置/文档改动        → full
#   · 数据 + 代码混合               → full（不能只看"含白名单路径"）
#   · 远端对象不可得/全 0/空 diff    → full（拿不准保守）
set -u

ORIG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

REPO="$TMP/repo"
mkdir -p "$REPO/portable/memory/stats" "$REPO/scripts" "$REPO/custom"
cd "$REPO" || exit 1
git init -q .
git config user.email t@example.com
git config user.name t
git config commit.gpgsign false

printf '{}\n' > portable/memory/stats/tool-count-x.json
printf 'echo hi\n' > scripts/thing.sh
mkdir -p custom
printf 'export const a = 1;\n' > custom/a.ts
git add -A && git commit -qm base
BASE="$(git rev-parse HEAD)"

# 1) 纯数据
printf '{"a":1}\n' > portable/memory/stats/tool-count-x.json
git add -A && git commit -qm data
DATA="$(git rev-parse HEAD)"

# 2) 纯代码
printf 'export const a = 2;\n' > custom/a.ts
git add -A && git commit -qm code
CODE="$(git rev-parse HEAD)"

# 3) 数据 + 代码混合
printf '{"a":2}\n' > portable/memory/stats/tool-count-x.json
printf 'echo hi2\n' > scripts/thing.sh
git add -A && git commit -qm mixed
MIXED="$(git rev-parse HEAD)"

PASS=0
FAIL=0
check() { # check <期望> <说明> <remote> <local>
  local want="$1" desc="$2" got
  got="$(bash "$ORIG/scripts/prepush-scope.sh" "$3" "$4")"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS + 1))
    echo "  ✓ $desc（$got）"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ $desc（期望 $want，实际 $got）"
  fi
}

echo "=== prepush-scope（临时仓库 $REPO）==="
check fast "纯统计改动 → fast" "$BASE" "$DATA"
check full "含代码改动 → full" "$BASE" "$CODE"
check full "数据+代码混合 → full" "$BASE" "$MIXED"
check full "远端对象未知（不存在）→ full" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$DATA"
check full "新分支（远端全 0）→ full" "0000000000000000000000000000000000000000" "$DATA"
check full "空 diff（同一提交）→ full" "$DATA" "$DATA"
check full "删除 ref（本地全 0）→ full" "$BASE" "0000000000000000000000000000000000000000"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 prepush-scope 测试通过（$PASS 项）"
  exit 0
fi
echo "❌ prepush-scope 测试失败 $FAIL 项（通过 $PASS 项）"
exit 1
