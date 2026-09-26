#!/usr/bin/env bash
# test-supervisor.sh — pi-supervisor.sh 行为测试（承重件的纯函数）
#
# supervisor 是默认启动路径（my-pi.sh 直接 exec 它），但此前**零测试**。
# 本脚本以库模式 source 它，只测不依赖网络/CLI/provider 的纯逻辑：
#   - classify_crash：崩溃分类（transient / external / pi_self），含 ANSI 色码剥离
#   - read_admin_action / clear_admin_action：admin state 的新鲜度与字段解析
#
# 用法：bash scripts/test-supervisor.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
check() { # check <描述> <期望> <实际>
  if [ "$2" = "$3" ]; then
    printf '  ✓ %s\n' "$1"
    PASS=$((PASS + 1))
  else
    printf '  ✗ %s（期望 %q，实际 %q）\n' "$1" "$2" "$3"
    FAIL=$((FAIL + 1))
  fi
}

# 必须先设 admin state 路径：supervisor 在加载时读取该变量
export PI_CODING_AGENT_DIR="$TMP/agent"
export PI_ADMIN_STATE_FILE="$TMP/state.json"
mkdir -p "$TMP/agent"

# 库模式加载：只定义函数，不进入主循环
# shellcheck disable=SC1091
MY_PI_SUPERVISOR_LIB=1 source "$ROOT/scripts/pi-supervisor.sh"

echo "=== classify_crash ==="
clog() { printf '%s\n' "$2" > "$TMP/fixture.log"; classify_crash "$TMP/fixture.log"; }

check "缺失日志文件 → external" "external" "$(classify_crash "$TMP/不存在.log")"
check "HTTP 503 → transient" "transient" "$(clog x 'Error: HTTP 503 Service Unavailable')"
check "429 限流 → transient" "transient" "$(clog x 'status 429 rate limit exceeded')"
check "ECONNREFUSED → transient" "transient" "$(clog x 'Error: connect ECONNREFUSED 127.0.0.1:8889')"
check "socket hang up → transient" "transient" "$(clog x 'Error: socket hang up')"
check "上游 request failed → transient" "transient" "$(clog x 'Upstream request failed')"
check "语法错误 + 自身 dist 路径 → pi_self" "pi_self" \
  "$(clog x 'SyntaxError: Unexpected token in /root/my-pi/vendor/pi/packages/coding-agent/dist/cli.js')"
check "ANSI 色码包裹的自身路径 → pi_self（先剥色码）" "pi_self" \
  "$(clog x "$(printf 'SyntaxError\\x1b[31m at vendor/pi/packages/coding-agent/src/main.ts\\x1b[0m')")"
check "Cannot find module（自身）→ pi_self" "pi_self" \
  "$(clog x 'Error: Cannot find module vendor/pi/packages/coding-agent/dist/x.js')"
check "语法错误但非自身路径 → external" "external" \
  "$(clog x 'SyntaxError: Unexpected token in /some/other/tool/index.js')"
check "普通报错 → external" "external" "$(clog x 'Error: permission denied')"
check "transient 优先于 pi_self（同时命中）" "transient" \
  "$(clog x 'SyntaxError: Unexpected token; ECONNRESET')"

echo ""
echo "=== read_admin_action / clear_admin_action ==="

write_state() { printf '%s' "$1" > "$PI_ADMIN_STATE_FILE"; }
now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }

rm -f "$PI_ADMIN_STATE_FILE"
read_admin_action
check "无 state 文件 → 空动作" "" "$ACT"

write_state "{\"action\":\"none\",\"timestamp\":0}"
read_admin_action
check "action=none → 空动作" "" "$ACT"

write_state "{\"action\":\"restart\",\"timestamp\":$(now_ms)}"
read_admin_action
check "新鲜 restart → ACT=restart" "restart" "$ACT"

OLD=$(( $(now_ms) - 600000 )) # 10 分钟前，超过 5 分钟窗口
write_state "{\"action\":\"restart\",\"timestamp\":$OLD}"
read_admin_action
check "过期 restart → 空动作" "" "$ACT"

write_state "{\"action\":\"switch_session\",\"timestamp\":$(now_ms),\"targetSession\":\"/tmp/s.jsonl\"}"
read_admin_action
check "switch_session → ACT" "switch_session" "$ACT"
check "switch_session → TARGET" "/tmp/s.jsonl" "$TARGET"

write_state "{\"action\":\"set_model\",\"timestamp\":$(now_ms),\"targetProvider\":\"deepseek\",\"targetModel\":\"deepseek-flash\"}"
read_admin_action
check "set_model → PROV" "deepseek" "$PROV"
check "set_model → MODEL" "deepseek-flash" "$MODEL"

write_state '{ 坏 JSON'
read_admin_action
check "坏 JSON → 空动作（不崩）" "" "$ACT"

write_state "{\"action\":\"restart\",\"timestamp\":$(now_ms),\"reason\":\"keep\"}"
clear_admin_action
read_admin_action
check "clear_admin_action → 动作清空" "" "$ACT"
check "clear 保留其它字段" "keep" "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).reason))' "$PI_ADMIN_STATE_FILE")"

echo ""
echo "=== build_admin_args（重启续接参数，绝不能为空）==="
# 回归：曾因主循环每轮开头 EXTRA_ARGS=() 覆盖了 case 分支写入的 --session，
# 重启后 pi 以空参启动并新建会话（用户回不到原会话）。续接参数必须经过
# PENDING_ARGS 跨 continue 传递，且任何分支都不允许产出空数组。
args_of() { build_admin_args "$1" "$2" "$3" "$4"; printf '%s' "${ADMIN_ARGS[*]}"; }

check "restart + 有会话 → --session" "--session /s/cur.jsonl" "$(args_of restart /s/cur.jsonl '' '')"
check "restart 无会话 → --continue 兜底" "--continue" "$(args_of restart '' '' '')"
check "restart_hang 同 restart" "--session /s/cur.jsonl" "$(args_of restart_hang /s/cur.jsonl '' '')"
check "switch_session 有目标" "--session /s/other.jsonl" "$(args_of switch_session /s/other.jsonl '' '')"
check "switch_session 缺目标 → --continue" "--continue" "$(args_of switch_session '' '' '')"
check "set_model 带会话" "--provider deepseek --model deepseek-flash --session /s/cur.jsonl" \
  "$(args_of set_model /s/cur.jsonl deepseek deepseek-flash)"
check "set_model 无会话 → --continue" "--provider deepseek --model deepseek-flash --continue" \
  "$(args_of set_model '' deepseek deepseek-flash)"
check "set_model 缺模型 → 保持空（不空参启动）" "" "$(args_of set_model /s/cur.jsonl deepseek '')"
check "未知动作 → 空" "" "$(args_of none /s/cur.jsonl '' '')"

echo ""
echo "=== 救援 playbook（run_fix_pi 以 --append-system-prompt 追加）==="
RESCUE="$RECOVERY_DIR/rescue-prompt.md"
check "rescue-prompt.md 存在" "yes" "$([ -f "$RESCUE" ] && echo yes || echo no)"
if [ -f "$RESCUE" ]; then
  # 内容必须指向 my-pi 的真实路径，否则修复者会被误导
  for token in 'vendor/pi' 'portable/agent/recovery/cache' 'scripts/build.sh' 'scripts/doctor.sh' 'patches/'; do
    if grep -qF "$token" "$RESCUE"; then
      printf '  ✓ 含关键路径 %s\n' "$token"
      PASS=$((PASS + 1))
    else
      printf '  ✗ 缺少关键路径 %s\n' "$token"
      FAIL=$((FAIL + 1))
    fi
  done
fi

echo ""
echo "=== 主循环重启续接（端到端，stub CLI）==="
# 回归（2026-09-26 实测 bug）：主循环每轮开头 `EXTRA_ARGS=()` 会把上一轮 case 分支
# 写入的续接参数清掉，于是 `admin_restart` 后 pi 以空参启动 → 新建会话，用户回不到
# 原会话。这里用 stub CLI 跑**真实主循环**，断言第二轮启动真的收到 --session。
LOOP="$TMP/loop"
mkdir -p "$LOOP/agent"
cat > "$LOOP/cli.js" <<'STUB'
const fs = require('node:fs');
const dir = process.env.LOOP_DIR;
const counter = `${dir}/runs`;
const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
fs.writeFileSync(counter, String(n + 1));
fs.writeFileSync(`${dir}/argv-${n}.txt`, process.argv.slice(2).join(' '));
if (n === 0) {
  // 首次启动：模拟模型调用 admin_restart（写重启请求后退出）
  fs.writeFileSync(process.env.PI_ADMIN_STATE_FILE, JSON.stringify({
    action: 'restart',
    targetSession: '/tmp/session-cur.jsonl',
    reason: '端到端测试',
    timestamp: Date.now(),
    restartLog: { action: 'restart', reason: '端到端测试', timestamp: Date.now() },
  }));
}
process.exit(0);
STUB

run_loop() {
  rm -f "$LOOP/runs" "$LOOP"/argv-*.txt
  LOOP_DIR="$LOOP" MY_PI_CLI="$LOOP/cli.js" MY_PI_AGENT_DIR="$LOOP/agent" \
    PI_ADMIN_STATE_FILE="$LOOP/state.json" \
    bash "$ROOT/scripts/pi-supervisor.sh" >"$LOOP/out.log" 2>&1
}

run_loop
check "主循环跑满两轮" "2" "$(cat "$LOOP/runs")"
check "第二轮收到 --session（续接原会话）" "yes" \
  "$(grep -q -- '--session /tmp/session-cur.jsonl' "$LOOP/argv-1.txt" && echo yes || echo no)"
check "第二轮仍注入 bootstrap 扩展" "yes" \
  "$(grep -q -- '--extension .*custom/bootstrap.ts' "$LOOP/argv-1.txt" && echo yes || echo no)"
check "第一轮不带 --session（基线）" "no" \
  "$(grep -q -- '--session' "$LOOP/argv-0.txt" && echo yes || echo no)"
check "重启动作已被消费（不留 action）" "none" \
  "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).action))' "$LOOP/state.json" 2>/dev/null || echo missing)"
check "restartLog 保留（供新进程注入重启通知）" "端到端测试" \
  "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).restartLog?.reason))' "$LOOP/state.json" 2>/dev/null || echo missing)"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 supervisor 测试通过（$PASS 项）"
  exit 0
fi
echo "❌ supervisor 测试失败 $FAIL 项（通过 $PASS 项）"
exit 1
