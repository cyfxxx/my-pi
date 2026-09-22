#!/bin/bash
# golden-tasks.sh — 行为防退化基准（VISION P2）
#
# 确定性的结构/类型/单测/边界守门，作为结构性改动的回归安全网。
# 用法：
#   bash scripts/golden-tasks.sh            # 确定性检查（无网络/无 LLM）
#   bash scripts/golden-tasks.sh --smoke    # 追加无头会话冒烟（需已配置 provider）
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
FAIL=0

step() { echo ""; echo "=== $1 ==="; }
pass() { echo "  ✓ $1"; }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

step "1. 隔离边界"
if bash scripts/check-isolation.sh >/tmp/golden-isolation.log 2>&1; then pass "check-isolation"; else fail "check-isolation（见 /tmp/golden-isolation.log）"; tail -5 /tmp/golden-isolation.log; fi

step "2. 功能注册面"
if bash scripts/check-features.sh >/tmp/golden-features.log 2>&1; then pass "check-features"; else fail "check-features（见 /tmp/golden-features.log）"; tail -5 /tmp/golden-features.log; fi

step "3. 类型检查"
if npx tsc --noEmit -p custom/ >/tmp/golden-tsc.log 2>&1; then pass "tsc"; else fail "tsc（见 /tmp/golden-tsc.log）"; tail -10 /tmp/golden-tsc.log; fi

step "4. 单元测试"
if npm test >/tmp/golden-test.log 2>&1; then pass "vitest"; grep -E "Test Files|Tests " /tmp/golden-test.log | sed 's/^/    /'; else fail "vitest（见 /tmp/golden-test.log）"; tail -10 /tmp/golden-test.log; fi

step "5. 补丁状态"
if [ -d vendor/pi ]; then
  ok=1
  for p in "$ROOT"/patches/*.patch; do
    [ -e "$p" ] || continue
    if git -C vendor/pi apply --check --reverse "$p" >/dev/null 2>&1 || git -C vendor/pi apply --check "$p" >/dev/null 2>&1; then
      :
    else
      ok=0; fail "补丁状态未知：$(basename "$p")"
    fi
  done
  [ "$ok" = "1" ] && pass "patches 全部可应用/已应用（$(ls patches/*.patch 2>/dev/null | wc -l | tr -d ' ') 个）"
else
  echo "  ⚠ vendor/pi 不存在（跳过）"
fi

step "6. 注入面基线"
if bash scripts/check-injection-surface.sh >/tmp/golden-inject.log 2>&1; then pass "$(tail -1 /tmp/golden-inject.log)"; else fail "注入面失配（见 /tmp/golden-inject.log）"; cat /tmp/golden-inject.log; fi

step "7. 文档链接"
if node scripts/check-doc-links.mjs >/tmp/golden-docs.log 2>&1; then pass "$(tail -1 /tmp/golden-docs.log)"; else fail "文档链接（见 /tmp/golden-docs.log）"; cat /tmp/golden-docs.log; fi

if [ "${1:-}" = "--smoke" ]; then
  step "8. 无头会话冒烟"
  if timeout 90 ./my-pi.sh -p "回复 OK" >/tmp/golden-smoke.log 2>&1; then pass "headless smoke"; else fail "headless smoke（见 /tmp/golden-smoke.log）"; tail -10 /tmp/golden-smoke.log; fi
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 golden tasks 全部通过"
  exit 0
fi
echo "❌ golden tasks 失败 $FAIL 项"
exit 1
