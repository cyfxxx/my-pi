#!/usr/bin/env bash
# test-supervisor.sh — pi-supervisor.sh 行为测试（承重件的纯函数）
#
# supervisor 是默认启动路径（my-pi.sh 直接 exec 它），但此前**零测试**。
# 本脚本以库模式 source 它，只测不依赖网络/CLI/provider 的纯逻辑：
#   - classify_crash：崩溃分类（transient / external / pi_self），含 ANSI 色码剥离
#   - read_admin_action / clear_admin_action：admin state 的新鲜度与字段解析
#   - apply_mode：模式解析（modes.json 配置 + modes-sessions.json 会话记录、人设/命名空间、
#     外部 PI_AGENT_MODE 覆盖优先级、--session 参数提取）与主循环命令行装配
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
# （不覆盖 MY_PI_AGENT_DIR：RECOVERY_DIR 由它派生，救援 playbook 的断言要看真实仓库文件；
#   模式解析一节改用局部 AGENT_DIR 指向临时目录）
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

write_state "{\"action\":\"restart\",\"timestamp\":$(now_ms),\"restartLog\":{\"timestamp\":$(( $(now_ms) - 1000 ))}}"
read_admin_action
check "读出 restartLog 时间戳（供丢请求判定）" "yes" "$([ -n "$LTS" ] && [ "$LTS" -gt 0 ] && echo yes || echo no)"

write_state "{\"action\":\"none\",\"timestamp\":0,\"restartLog\":{\"timestamp\":1234567890}}"
read_admin_action
check "action 已被清也要读出 restartLog 时间戳" "1234567890" "$LTS"
check "action 已被清 → ACT 为空" "" "$ACT"

write_state "{\"action\":\"restart\",\"timestamp\":$(now_ms),\"reason\":\"keep\"}"
clear_admin_action
read_admin_action
check "clear_admin_action → 动作清空" "" "$ACT"
check "clear 保留其它字段" "keep" "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).reason))' "$PI_ADMIN_STATE_FILE")"

echo ""
echo "=== detect_lost_restart（重启请求被吞的判定）==="
# 判据刻意收紧：action 已不在，但 restartLog 的时间戳落在**本轮** [roundStart, now] 内 —— 这正是
# "刚写下的请求没落地"。上一轮留下的日志不在窗口内（那是"通知没被消费"，交给 daily-health 按 TTL 判），
# 所以正常重启（新进程只是还没消费通知）不会误报。
lost() { detect_lost_restart "$1" "$2" "$3" "$4" && echo yes || echo no; }
check "本轮写下的请求 + action 被清 → 判定为丢" "yes" "$(lost none 1000500 1000000 1001000)"
check "空 action（读不到动作）同样判定为丢" "yes" "$(lost '' 1000500 1000000 1001000)"
check "边界：正好等于轮次起点 → 判定为丢" "yes" "$(lost none 1000000 1000000 1001000)"
check "上一轮留下的日志（早于轮次起点）→ 不算丢" "no" "$(lost none 999000 1000000 1001000)"
check "有 action（会重启）→ 不算丢" "no" "$(lost restart 1000500 1000000 1001000)"
check "set_model 同样不算丢" "no" "$(lost set_model 1000500 1000000 1001000)"
check "没有时间戳 → 不算丢" "no" "$(lost none '' 1000000 1001000)"
check "坏时间戳 → 不算丢（不崩）" "no" "$(lost none abc 1000000 1001000)"
check "时间戳在未来（时钟回拨）→ 不算丢" "no" "$(lost none 9999999 1000000 1001000)"

echo ""
echo "=== mark_recovery_restart_log（崩溃恢复的重启日志）==="
# 崩溃恢复没有 admin action，新进程本来不知道自己是重启来的；写一条 intent=auto 的只读日志，
# 由新进程按会话盘面尾部判是否续跑（core/restart-intent.ts）。绝不能覆盖真正待执行的动作。
state_field() { node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);process.stdout.write(v===undefined?"undefined":String(v))' "$PI_ADMIN_STATE_FILE" "$1"; }
state_reason() { node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.restartLog?.reason??""))' "$PI_ADMIN_STATE_FILE"; }
rm -f "$PI_ADMIN_STATE_FILE"
mark_recovery_restart_log external
check "恢复日志：文件缺失也能写出来" "auto" "$(state_field 's.restartLog.intent')"
check "恢复日志：action 保持 none（不伪造待执行动作）" "none" "$(state_field 's.action')"
check "恢复日志：原因写明崩溃恢复" "yes" "$(case "$(state_reason)" in *崩溃恢复*) echo yes;; *) echo no;; esac)"
check "恢复日志：分类写进 reason" "yes" "$(case "$(state_reason)" in *external*) echo yes;; *) echo no;; esac)"

write_state "{\"action\":\"restart\",\"timestamp\":$(now_ms),\"reason\":\"keep\",\"restartLog\":{\"reason\":\"old\"}}"
mark_recovery_restart_log pi_self
check "有待执行动作时不抢日志（action 保留）" "restart" "$(state_field 's.action')"
check "有待执行动作时不抢日志（restartLog 保留）" "old" "$(state_field 's.restartLog.reason')"

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

# 轮次记录（结构化复盘入口）+ 按轮 crash log：正常重启必须留 2 轮且**不得**误报 lostRestart
ROUNDS="$LOOP/agent/recovery/rounds.jsonl"
rounds_field() { node -e 'const l=require("node:fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.stdout.write(String(eval(process.argv[2])))' "$ROUNDS" "$1" 2>/dev/null || echo missing; }
check "轮次记录：两轮 restart → exit" "restart,exit" "$(rounds_field 'l.map(r=>r.decision).join(",")')"
check "正常重启不误报 lostRestart" "0" "$(rounds_field 'l.filter(r=>r.lostRestart).length')"
check "轮次记录含模式与退出码" "full:0" "$(rounds_field 'l[0].mode+":"+l[1].exitCode')"
check "crash log 按轮保留" "yes" "$([ -f "$LOOP/agent/recovery/rounds/round-1.log" ] && [ -f "$LOOP/agent/recovery/rounds/round-2.log" ] && echo yes || echo no)"

echo ""
echo "=== 丢重启请求：端到端（stub 复刻 2026-10-06 的吞请求时序）==="
# 真实故障时序：mode 自愈在 session_start 里写 action=restart，autopilot 随后消费重启通知时
# 把 action 清成 none（writeState 覆盖）。supervisor 读不到动作 → 直接退出：用户看到"注入了一条
# 系统已重启、进程却退出了、模式也没换"。本用例锁：①不重拉是事实（记录在案）②必须留痕告警。
LOST_DIR="$TMP/lost"
mkdir -p "$LOST_DIR/agent"
cat > "$LOST_DIR/cli.js" <<'STUB'
const fs = require('node:fs');
const dir = process.env.LOOP_DIR;
const n = fs.existsSync(`${dir}/runs`) ? Number(fs.readFileSync(`${dir}/runs`, 'utf8')) : 0;
fs.writeFileSync(`${dir}/runs`, String(n + 1));
fs.writeFileSync(process.env.PI_ADMIN_STATE_FILE, JSON.stringify({
  action: 'none',                // ← 被"通知消费"顺手清掉了
  timestamp: 0,
  restartLog: { action: 'restart', notice: 'mode', mode: 'roleplay', from: 'full', timestamp: Date.now() },
}));
process.exit(0);
STUB
LOOP_DIR="$LOST_DIR" MY_PI_CLI="$LOST_DIR/cli.js" MY_PI_AGENT_DIR="$LOST_DIR/agent" \
  PI_ADMIN_STATE_FILE="$LOST_DIR/state.json" \
  bash "$ROOT/scripts/pi-supervisor.sh" >"$LOST_DIR/out.log" 2>&1
LOST_ROUNDS="$LOST_DIR/agent/recovery/rounds.jsonl"
check "被吞的重启不会重拉（用户看到的就是退出）" "1" "$(cat "$LOST_DIR/runs")"
check "supervisor 明确告警而不是静默退出" "yes" "$(grep -q '重启请求没有落地' "$LOST_DIR/out.log" && echo yes || echo no)"
check "轮次记录标出 lostRestart=true" "true" "$(node -e 'const l=require("node:fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.stdout.write(String(l.at(-1).lostRestart))' "$LOST_ROUNDS" 2>/dev/null || echo missing)"
check "轮次记录含决策与退出码" "exit:0" "$(node -e 'const l=require("node:fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);const r=l.at(-1);process.stdout.write(`${r.decision}:${r.exitCode}`)' "$LOST_ROUNDS" 2>/dev/null || echo missing)"
check "崩溃审计留下 lost_restart 记录" "yes" "$(grep -q 'lost_restart' "$LOST_DIR/agent/recovery/recovery-audit.jsonl" && echo yes || echo no)"

# 隔离外部环境泄漏：本机 shell 可能残留 PI_AGENT_MODE/PI_AGENT_MODE_SOURCE
# （来自某次 bootstrap 回写），不 unset 会让"无会话记录"等用例被 env 短路。
unset PI_AGENT_MODE
unset PI_AGENT_MODE_SOURCE
unset PI_SESSION_MODE

echo "=== apply_mode（模式解析：入库配置 + 会话记录）==="
# 配置与会话记录分离：modes.json 只放 default + 模式定义（入库）；"哪个会话用哪个模式"放
# modes-sessions.json（gitignored，键是会话文件绝对路径）。新会话没有记录 → default。
# 这层契约必须由 bash 侧也锁住——模式解析在 lib-mode.sh，pi 侧在 mode/logic.ts，两边读同一组文件。
# 用局部 AGENT_DIR 指向临时目录，避免污染真实 agent 目录（也避开救援 playbook 对真实路径的断言）。
MODE_AGENT="$TMP/mode-agent"
mkdir -p "$MODE_AGENT/modes"
AGENT_DIR="$MODE_AGENT"
SESS_A="$TMP/sess-a.jsonl"
SESS_B="$TMP/sess-b.jsonl"
write_modes() { # write_modes [会话文件] [模式名]；不给参数 = 不写会话记录
  rm -f "$AGENT_DIR/modes-sessions.json"
  cat > "$AGENT_DIR/modes.json" <<'JSON'
{
  "default": "full",
  "modes": {
    "roleplay": {
      "description": "rp",
      "features": ["web-search", "memory"],
      "thinking": "low",
      "appendPrompt": "modes/roleplay.md",
      "memoryNamespace": "roleplay"
    }
  }
}
JSON
  printf '人设占位\n' > "$AGENT_DIR/modes/roleplay.md"
  if [ -n "${1:-}" ]; then
    printf '{"%s":{"mode":"%s","updatedAt":"2026-10-06T00:00:00.000Z"}}' "$1" "$2" > "$AGENT_DIR/modes-sessions.json"
  fi
}

write_modes
apply_mode
check "无会话记录 → 回落 modes.json 的 default(full)" "full" "$MODE_NAME"
check "无会话记录 → 不注入人设" "" "${MODE_ARGS[*]:-}"
check "无会话记录 → 命名空间为空" "" "$PI_MEMORY_NAMESPACE"
check "无会话记录 → 导出 PI_SESSION_MODE（软来源）" "full" "$PI_SESSION_MODE"

write_modes "$SESS_A" roleplay
apply_mode --session "$SESS_A"
check "会话记录 roleplay → 模式名" "roleplay" "$MODE_NAME"
check "会话记录 roleplay → 注入人设（绝对路径）" "--append-system-prompt $MODE_AGENT/modes/roleplay.md" "${MODE_ARGS[*]:-}"
check "会话记录 roleplay → 记忆命名空间" "roleplay" "$PI_MEMORY_NAMESPACE"
check "会话记录 roleplay → PI_SESSION_MODE 同步" "roleplay" "$PI_SESSION_MODE"

apply_mode --session "$SESS_B"
check "另一个会话（无记录）→ 回落 default，不继承 A" "full" "$MODE_NAME"

# 记录里指向已删除的模式名要忽略（pi 侧 getSessionMode 同样校验），不能凭空返回不存在的档位
printf '{"%s":{"mode":"does-not-exist"}}' "$SESS_A" > "$AGENT_DIR/modes-sessions.json"
apply_mode --session "$SESS_A"
check "会话记录指向未知模式 → 回落 default" "full" "$MODE_NAME"

# 记录损坏（坏 JSON / 非对象）不能让启动失败
printf '{ not json' > "$AGENT_DIR/modes-sessions.json"
apply_mode --session "$SESS_A"
check "会话记录损坏 → 回落 default" "full" "$MODE_NAME"

# 只认绝对路径：mode_session_arg 的契约（id/相对路径不解析，交给 pi 侧自愈）
check "mode_session_arg：取 --session 的绝对路径" "$SESS_A" "$(mode_session_arg --session "$SESS_A")"
check "mode_session_arg：多个 --session 取最后一个（argv 后者覆盖）" "$SESS_B" \
  "$(mode_session_arg --session "$SESS_A" --continue --session "$SESS_B")"
check "mode_session_arg：会话 id / 相对路径一律不认" "" "$(mode_session_arg --session abc123)"
check "mode_session_arg：无该参数 → 空" "" "$(mode_session_arg --continue -p hi)"

# 旧行为（current 在 modes.json / modes-state.json）已不再是模式来源：新会话一律 default
printf '{"current":"roleplay"}' > "$AGENT_DIR/modes-state.json"
write_modes
apply_mode
check "旧 modes-state.json 不再是模式来源（新会话仍 default）" "full" "$MODE_NAME"

write_modes "$SESS_A" roleplay
rm -f "$AGENT_DIR/modes/roleplay.md"
apply_mode --session "$SESS_A"
check "人设文件缺失 → 不注入 --append-system-prompt" "" "${MODE_ARGS[*]:-}"
check "人设文件缺失 → 命名空间仍注入" "roleplay" "$PI_MEMORY_NAMESPACE"

# 外部注入必须同时给 PI_AGENT_MODE_SOURCE=env：lib-mode.sh 与 pi 侧
# resolveEffectiveMode 共用同一判据，bootstrap 回写写的是 source="file"，
# 只给 mode 不给 source 会被当成回写值，模式永远切不动。
write_modes "$SESS_A" roleplay
export PI_AGENT_MODE=minimal
export PI_AGENT_MODE_SOURCE=env
apply_mode --session "$SESS_A"
unset PI_AGENT_MODE
unset PI_AGENT_MODE_SOURCE
check "外部注入 PI_AGENT_MODE 优先于会话记录" "minimal" "$MODE_NAME"

# 回归（2026-10-05 真实事故）：pi 进程 bootstrap 回写 PI_AGENT_MODE=<旧模式> + SOURCE=file，
# supervisor 若把它当外部注入，会话记录里的 roleplay 就永远切不动。
write_modes "$SESS_A" roleplay
export PI_AGENT_MODE=full
export PI_AGENT_MODE_SOURCE=file
apply_mode --session "$SESS_A"
unset PI_AGENT_MODE
unset PI_AGENT_MODE_SOURCE
check "bootstrap 回写（source=file）→ 仍以会话记录为准" "roleplay" "$MODE_NAME"

# 未知模式名的外部注入要忽略（pi 侧 getModeConfig 校验），不能凭空返回一个不存在的档位
write_modes "$SESS_A" roleplay
export PI_AGENT_MODE=does-not-exist
export PI_AGENT_MODE_SOURCE=env
apply_mode --session "$SESS_A"
unset PI_AGENT_MODE
unset PI_AGENT_MODE_SOURCE
check "未知模式名的 env 注入 → 回落会话记录" "roleplay" "$MODE_NAME"

unset PI_SESSION_MODE

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 supervisor 测试通过（$PASS 项）"
  exit 0
fi
echo "❌ supervisor 测试失败 $FAIL 项（通过 $PASS 项）"
exit 1
