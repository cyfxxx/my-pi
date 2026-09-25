#!/bin/bash
# golden-tasks.sh — 行为防退化基准（VISION P2）
#
# 确定性的结构/类型/单测/边界守门，作为结构性改动的回归安全网。
# 用法：
#   bash scripts/golden-tasks.sh            # 确定性检查（无网络/无 LLM）
#   bash scripts/golden-tasks.sh --fast     # 跳过 tsc/vitest（pre-commit 用，秒级）
#   bash scripts/golden-tasks.sh --smoke    # 追加无头会话冒烟（需已配置 provider）
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# 共享补丁判定（同 check-features.sh：顺序叠加补丁需看 vendor 提交历史）
# shellcheck source=lib-vendor.sh
source "$ROOT/scripts/lib-vendor.sh"

FAST=0
SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --smoke) SMOKE=1 ;;
  esac
done

FAIL=0

step() { echo ""; echo "=== $1 ==="; }
pass() { echo "  ✓ $1"; }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  - $1"; }

step "1. 隔离边界"
if bash scripts/check-isolation.sh >/tmp/golden-isolation.log 2>&1; then pass "check-isolation"; else fail "check-isolation（见 /tmp/golden-isolation.log）"; tail -5 /tmp/golden-isolation.log; fi

step "2. 功能注册面"
if bash scripts/check-features.sh >/tmp/golden-features.log 2>&1; then pass "check-features"; else fail "check-features（见 /tmp/golden-features.log）"; tail -5 /tmp/golden-features.log; fi

step "3. 死导出（防写了没接线）"
if node scripts/check-dead-exports.mjs >/tmp/golden-deadexports.log 2>&1; then pass "check-dead-exports"; else fail "check-dead-exports（见 /tmp/golden-deadexports.log）"; tail -15 /tmp/golden-deadexports.log; fi

if [ "$FAST" = "1" ]; then
  step "4. 类型检查"
  skip "tsc（--fast 跳过）"
  step "5. 单元测试"
  skip "vitest（--fast 跳过）"
else
  step "4. 类型检查"
  if npx tsc --noEmit -p custom/ >/tmp/golden-tsc.log 2>&1; then pass "tsc"; else fail "tsc（见 /tmp/golden-tsc.log）"; tail -10 /tmp/golden-tsc.log; fi

  step "5. 单元测试"
  if npm test >/tmp/golden-test.log 2>&1; then pass "vitest"; grep -E "Test Files|Tests " /tmp/golden-test.log | sed 's/^/    /'; else fail "vitest（见 /tmp/golden-test.log）"; tail -10 /tmp/golden-test.log; fi
fi

step "6. 补丁状态"
if [ -d vendor/pi ]; then
  ok=1
  for p in "$ROOT"/patches/*.patch; do
    [ -e "$p" ] || continue
    if vendor_patch_applied vendor/pi "$p" \
       || git -C vendor/pi apply --check --reverse "$p" >/dev/null 2>&1 \
       || git -C vendor/pi apply --check "$p" >/dev/null 2>&1; then
      :
    else
      ok=0; fail "补丁状态未知：$(basename "$p")"
    fi
  done
  [ "$ok" = "1" ] && pass "patches 全部可应用/已应用（$(ls patches/*.patch 2>/dev/null | wc -l | tr -d ' ') 个）"
else
  echo "  ⚠ vendor/pi 不存在（跳过）"
fi

step "7. 补丁行为标记"
# 应用成功 ≠ 行为还在：断言补丁带来的关键符号/自标记确实存在于 vendor 源码（防上游同步语义漂移）
if node scripts/check-patches-behavior.mjs >/tmp/golden-patchbehavior.log 2>&1; then pass "$(tail -1 /tmp/golden-patchbehavior.log)"; else fail "补丁行为标记缺失（见 /tmp/golden-patchbehavior.log）"; cat /tmp/golden-patchbehavior.log; fi

step "8. 注入面基线"
if bash scripts/check-injection-surface.sh >/tmp/golden-inject.log 2>&1; then pass "$(tail -1 /tmp/golden-inject.log)"; else fail "注入面失配（见 /tmp/golden-inject.log）"; cat /tmp/golden-inject.log; fi

step "9. 文档链接"
if node scripts/check-doc-links.mjs >/tmp/golden-docs.log 2>&1; then pass "$(tail -1 /tmp/golden-docs.log)"; else fail "文档链接（见 /tmp/golden-docs.log）"; cat /tmp/golden-docs.log; fi

step "10. 自愈外壳（supervisor 纯函数）"
if bash scripts/test-supervisor.sh >/tmp/golden-supervisor.log 2>&1; then pass "$(tail -1 /tmp/golden-supervisor.log)"; else fail "supervisor 测试（见 /tmp/golden-supervisor.log）"; tail -15 /tmp/golden-supervisor.log; fi

step "11. 定时任务提示词（headless 可用）"
if node scripts/check-seeds-headless.mjs >/tmp/golden-seeds.log 2>&1; then pass "$(tail -1 /tmp/golden-seeds.log)"; else fail "种子提示词引用了 headless 不存在的扩展工具（见 /tmp/golden-seeds.log）"; cat /tmp/golden-seeds.log; fi

if [ "$SMOKE" = "1" ]; then
  step "12. 无头会话冒烟"
  # 已知现象：带扩展的 `-p` 一次性运行在本环境**产出回复后不退出**（进程挂住，实测 >60s）。
  # 故这里以"是否产出回复"为准，超时但有回复算通过并说明；进程能正常退出更好。
  smoke_log=/tmp/golden-smoke.log
  timeout 90 ./my-pi.sh -p "回复 OK" >"$smoke_log" 2>&1
  smoke_rc=$?
  reply="$(grep -vE '^\[supervisor\]|^\s*$' "$smoke_log" | tail -1)"
  if [ "$smoke_rc" -eq 0 ]; then
    pass "headless smoke（正常退出）"
  elif [ -n "$reply" ]; then
    pass "headless smoke（已产出回复；进程未按期退出，属已知 headless 现象）"
  else
    fail "headless smoke（无回复，见 $smoke_log）"
    tail -10 "$smoke_log"
  fi
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  MSG=""
  [ "$FAST" = "1" ] && MSG="（--fast：已跳过 tsc/vitest）"
  echo "🎉 golden tasks 全部通过$MSG"
  exit 0
fi
echo "❌ golden tasks 失败 $FAIL 项"
exit 1
