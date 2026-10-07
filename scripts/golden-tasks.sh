#!/bin/bash
# golden-tasks.sh — 行为防退化基准（VISION P2）
#
# 确定性的结构/类型/单测/边界守门，作为结构性改动的回归安全网。
# 用法：
#   bash scripts/golden-tasks.sh            # 确定性检查（无网络/无 LLM）
#   bash scripts/golden-tasks.sh --fast     # 跳过 tsc/vitest/web-term（pre-commit 用，秒级）
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

step "12. 浏览器终端（鉴权 + 传输）"
# 安全边界（令牌换 cookie、Host/Origin 栅栏、穿越防护）与 pty 传输（双向数据、resize→SIGWINCH）
# 都是单测覆盖不到的进程级行为。缺 script/stty 时该脚本显式 SKIP 并 exit 0。
if [ "$FAST" = "1" ]; then
  skip "web-terminal 守门（--fast 跳过；pre-push 对纯数据推送走 --fast，其余全量）"
elif node scripts/test-web-terminal.mjs >/tmp/golden-webterm.log 2>&1; then pass "$(tail -1 /tmp/golden-webterm.log)"; else fail "web-terminal 守门（见 /tmp/golden-webterm.log）"; tail -15 /tmp/golden-webterm.log; fi

step "13. 用量度量口径（成本告警的有效性）"
# 度量读错数据源会让所有阈值告警静默失效（2026-09-26..29 日报连续 n/a，命中率跌到 80.66%
# 也没告警）。这里用合成数据驱动真实 daily-health，锁定命中率来源与前端变更告警。
if node scripts/test-usage-metrics.mjs >/tmp/golden-usage.log 2>&1; then pass "$(tail -1 /tmp/golden-usage.log)"; else fail "用量度量守门（见 /tmp/golden-usage.log）"; tail -15 /tmp/golden-usage.log; fi

step "14. 约定守门（状态不入库 / 敏感文件 / 代码规范）"
# P4 升格通道第一批：把 AGENTS.md 里的三条软约定硬化（此前靠人自觉）。
if bash scripts/check-conventions.sh >/tmp/golden-conventions.log 2>&1; then pass "$(tail -1 /tmp/golden-conventions.log)"; else fail "约定守门（见 /tmp/golden-conventions.log）"; cat /tmp/golden-conventions.log; fi

step "15. 书籍知识库框架（探针/索引/按需提取/记录）"
# 用合成 PDF（含内嵌目录 + 纯图像页）验证 probe/index/read/report/run-log 全链路，零网络零 LLM。
if node scripts/test-books.mjs >/tmp/golden-books.log 2>&1; then pass "$(tail -1 /tmp/golden-books.log)"; else fail "书籍框架自检（见 /tmp/golden-books.log）"; tail -15 /tmp/golden-books.log; fi

step "16. 私钥引导包（方案 A：口令加密 / 成员白名单 / 指纹核对）"
# 全程临时密钥：验证 pack/verify/unpack、拒绝仓库内私钥、拒绝夹带非白名单成员；缺 age 时脚本自跳过。
if bash scripts/test-bootstrap.sh >/tmp/golden-bootstrap.log 2>&1; then pass "$(tail -1 /tmp/golden-bootstrap.log)"; else fail "引导包守门（见 /tmp/golden-bootstrap.log）"; tail -15 /tmp/golden-bootstrap.log; fi

step "17. pre-push 门禁范围判定（纯数据降级不得误放代码）"
# prepush-scope.sh 决定 pre-push 跑全量还是快检，判错会静默削弱推送防线 → 用临时仓库锁四类判定。
if bash scripts/test-prepush-scope.sh >/tmp/golden-prepushscope.log 2>&1; then pass "$(tail -1 /tmp/golden-prepushscope.log)"; else fail "pre-push 范围判定（见 /tmp/golden-prepushscope.log）"; tail -15 /tmp/golden-prepushscope.log; fi

step "18. 运行时状态不变量（使用层面静默失效）"
# tsc/vitest 判的是"实现对不对"；这一层判"配置与运行时状态有没有自相矛盾"。实测事故：
# 人设文件缺失被启动器静默吞掉、功能名拼错静默少功能、重启请求写了没落地、重启通知没被消费。
# 用合成状态逐条锁定两侧行为，并校验三处真值不漂移（FIXED_MODES / 功能名清单）。
if node scripts/test-state-audit.mjs >/tmp/golden-stateaudit.log 2>&1; then pass "$(tail -1 /tmp/golden-stateaudit.log)"; else fail "状态体检守门（见 /tmp/golden-stateaudit.log）"; tail -20 /tmp/golden-stateaudit.log; fi

step "19. 模式切换场景（真实 pty + supervisor + pi，约 8 分钟）"
# 唯一一条"用户路径"级检查：在真 pty 里输入 /mode roleplay，断言进程真的重拉、新进程跑在 roleplay
# （人设+命名空间）并把**适配模式**的通知注入会话文件。2026-10-06 的真实故障（切模式后进程直接退出、
# 模式没换）在当时的全部门禁下都是绿的——只有这一层能挡住它。缺 script/stty 或未构建 dist 时自跳过。
# **默认跳过**，用 PI_GOLDEN_SCENARIO=1 开启。理由是可复现的实测约束：本场景约 4 分钟，加上前面
# 的门禁会让 git push 期间那条 SSH 连接在跑到约 7.5 分钟时被远端关闭
# （2026-10-06 实测 "Connection to ssh.github.com closed by remote host"，push 失败，重试同样会失败）。
# 因此默认门禁保持 ~3.5 分钟；改到 mode / supervisor / bootstrap / 通知 这些面时显式开它。
if [ "$FAST" = "1" ]; then
  skip "模式切换场景（--fast 跳过）"
elif [ "${PI_GOLDEN_SCENARIO:-0}" != "1" ]; then
  skip "模式切换场景（默认跳过；PI_GOLDEN_SCENARIO=1 开启 —— 改 mode/supervisor/生命周期 时必须跑）"
elif [ "${PI_SCENARIO_SKIP:-0}" = "1" ]; then
  skip "模式切换场景（PI_SCENARIO_SKIP=1）"
elif node scripts/test-scenario-mode-restart.mjs >/tmp/golden-scenario.log 2>&1; then pass "$(tail -1 /tmp/golden-scenario.log)"; else fail "模式切换场景（见 /tmp/golden-scenario.log）"; tail -20 /tmp/golden-scenario.log; fi

step "20. 两实例隔离场景（真 pty×2 + supervisor×2 + 真 pi×2，约 8 分钟）"
# 多实例是常态（两个 supervisor 共享同一份 state.json / modes-sessions.json / rounds.jsonl）。
# stub CLI 只测得到 ownerPid 纯逻辑；这一层用**真 pi**证明：A 的 /mode 重启不越界到 B（B 的 pid
# 不变、B 的会话零注入），且 B 的 session_start 晚于 A 写下的重启日志时**不会**把它消费掉
# （restart-intent 的 logWrittenAfterStart / logTargetsOtherSession 归属判据的真链验证）。
# 同样**默认跳过**（PI_GOLDEN_SCENARIO=1 开启），理由与第 19 步一致：会显著拉长 push 期间的连接时间。
if [ "$FAST" = "1" ]; then
  skip "两实例隔离场景（--fast 跳过）"
elif [ "${PI_GOLDEN_SCENARIO:-0}" != "1" ]; then
  skip "两实例隔离场景（默认跳过；PI_GOLDEN_SCENARIO=1 开启 —— 改 supervisor/归属判定/生命周期 时必须跑）"
elif [ "${PI_SCENARIO_SKIP:-0}" = "1" ]; then
  skip "两实例隔离场景（PI_SCENARIO_SKIP=1）"
elif node scripts/test-scenario-two-instances.mjs >/tmp/golden-scenario-two.log 2>&1; then pass "$(tail -1 /tmp/golden-scenario-two.log)"; else fail "两实例隔离场景（见 /tmp/golden-scenario-two.log）"; tail -20 /tmp/golden-scenario-two.log; fi

if [ "$SMOKE" = "1" ]; then
  step "21. 无头会话冒烟"
  # 断言"一次性运行必须自己退出"。此前这里容忍挂起，注释写成"已知 headless 现象"——
  # 2026-10-01 查明真因：autopilot 的 session_start 在**无头会话**里也启动调度器并立刻
  # 跑 `runDueTasks`，于是逾期的每日任务（每个都是一次完整子代理会话、数分钟）被凭空触发，
  # "问一句就退出"变成长期挂起。已加 `if (!ctx.hasUI) { 只对账种子; return; }` 网关；
  # 本步骤因此改为**严格要求 rc=0**，以锁住该修复（若再挂住，先查调度器网关）。
  #
  # 2026-10-06：同一提示词在免费 provider（freellmapi）上实测响应 4.6s–145s（一次 v1.0.4 升级后
  # 的复测里连续 3 次超 90s），单次判定会把"provider 慢"误报成"进程没退出"。改为**失败重试一次**：
  # 真挂起（原 bug 是必现的）两次都失败，仍会被拦住；而 provider 抖动不再假红。
  smoke_log=/tmp/golden-smoke.log
  smoke_attempt=0
  smoke_ok=0
  while [ "$smoke_attempt" -lt 2 ]; do
    smoke_attempt=$((smoke_attempt + 1))
    timeout 90 ./my-pi.sh -p "回复 OK" >"$smoke_log" 2>&1
    smoke_rc=$?
    reply="$(grep -vE '^\[supervisor\]|^\s*$' "$smoke_log" | tail -1)"
    if [ "$smoke_rc" -eq 0 ]; then
      smoke_ok=1
      break
    fi
    if [ -n "$reply" ]; then
      echo "  ⚠ 第 $smoke_attempt 次：有回复（${reply:0:40}）但进程未退出"
    else
      echo "  ⚠ 第 $smoke_attempt 次：90s 内无回复"
    fi
    [ "$smoke_attempt" -lt 2 ] && echo "  ↻ provider 抖动/挂起待区分：重试一次"
  done
  if [ "$smoke_ok" -eq 1 ]; then
    pass "headless smoke（正常退出）"
  elif [ -n "$reply" ]; then
    fail "headless smoke（两次都有回复但进程未退出：检查 autopilot 的无头调度网关与未 unref 的句柄）"
    tail -10 "$smoke_log"
  else
    fail "headless smoke（两次均无回复，见 $smoke_log）"
    tail -10 "$smoke_log"
  fi
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  MSG=""
  [ "$FAST" = "1" ] && MSG="（--fast：已跳过 tsc/vitest/web-term）"
  echo "🎉 golden tasks 全部通过$MSG"
  exit 0
fi
echo "❌ golden tasks 失败 $FAIL 项"
exit 1
