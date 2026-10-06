#!/usr/bin/env bash
# pi-supervisor.sh — my-pi 崩溃自愈外壳（supervisor）
#
# 迁移自 pi-tools `scripts/pi-wrapper.sh` 的最新恢复设计（2026-09-15）：
#   wrapper 只做「检查 / 分类 / 启动修复者」；实际修复由 pi 自身完成。
#
# 崩溃分类（classify_crash，纯日志关键词）：
#   transient — API/网络/超时，指数退避重试，不修复
#   external  — pi 核心正常，扩展/配置/依赖/权限/磁盘问题；启动当前 pi
#               （--no-extensions --no-skills）读崩溃日志自行修复
#   pi_self   — dist 核心损坏（语法错误/缺失/导出不匹配）；用源码缓存构建的
#               pi 修复损坏的 pi，必要时回退 scripts/build.sh 重建
#
# 安全机制：崩溃计数 + 熔断、最大恢复轮数、恢复后健康检查、审计日志。
#
# 用法：bash scripts/pi-supervisor.sh [pi 参数...]
#   MY_PI_NO_SUPERVISOR=1  跳过 supervisor，直接启动（调试用）
#   MY_PI_CLI / MY_PI_AGENT_DIR  覆盖 CLI 与 agent 目录（scripts/test-supervisor.sh
#                       用 stub CLI 跑真实主循环，验证重启续接参数不丢失）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="${MY_PI_CLI:-$ROOT/vendor/pi/packages/coding-agent/dist/cli.js}"
AGENT_DIR="${MY_PI_AGENT_DIR:-$ROOT/portable/agent}"
RECOVERY_DIR="$AGENT_DIR/recovery"
CACHE_CLI="$RECOVERY_DIR/cache/dist/cli.js"
AUDIT="$RECOVERY_DIR/recovery-audit.jsonl"
CRASH_COUNT_FILE="$RECOVERY_DIR/crash-count"

# ── 结构化轮次记录 + 按轮 crash log（都在 gitignored 的 recovery/ 下）──
# 事故复盘的唯一入口：每轮一行 JSON（谁、什么模式、读到的 action、退出码、决策、是否丢请求）。
# 旧行为是"每轮覆盖 /tmp 里一个 crash log + 只在崩溃时写 audit"，出事后无从还原（2026-10-06 实测）。
ROUNDS_LOG="$RECOVERY_DIR/rounds.jsonl"
ROUND_LOG_DIR="$RECOVERY_DIR/rounds"
ROUND_LOG_KEEP="${ROUND_LOG_KEEP:-20}"   # 只留最近 N 轮 crash log
ROUND_INDEX=0
RUN_SESSION=""
ROUND_START_MS="0"
ROUND_DUR_MS=0

CRASH_THRESHOLD="${CRASH_THRESHOLD:-3}"
CIRCUIT_BREAKER_THRESHOLD="${CIRCUIT_BREAKER_THRESHOLD:-5}"
MAX_RECOVERY_ROUNDS="${MAX_RECOVERY_ROUNDS:-5}"
CRASH_WINDOW_MS="${CRASH_WINDOW_MS:-86400}"  # 秒
FIX_TIMEOUT="${PI_FIX_TIMEOUT:-240}"

export PI_CODING_AGENT_DIR="$AGENT_DIR"
# PI_MEMORY_DIR 可被外部显式覆盖：真实生命周期场景（scripts/test-scenario-mode-restart.mjs）
# 要在隔离目录里跑整套 supervisor + pi，不能让场景读写真记忆库。未设置时行为与以前完全一致。
export PI_MEMORY_DIR="${PI_MEMORY_DIR:-$ROOT/portable/memory}"

# ── 包管理子命令直通（install/remove/uninstall/list/update）──
# pi 的包管理分发要求 argv[0] 就是子命令本身（package-manager-cli.ts 的
# parsePackageCommand 直接取 args[0]，main.ts 用原始 argv 调用）。若先注入
# --extension，args[0] 会变成 --extension，子命令降级为位置参数（首条提示词），
# 于是 `./my-pi.sh install …` 会误入交互会话而非安装。
# 故这些子命令不注入扩展，原样交给 pi；包管理不需要扩展（扩展由 agentDir 自动发现）。
case "${1:-}" in
  install|remove|uninstall|list|update)
    if [ ! -f "$CLI" ]; then
      echo "❌ 未找到 $CLI，请先运行：bash scripts/build.sh" >&2
      exit 1
    fi
    exec node "$CLI" "$@"
    ;;
esac

# ── 模式（modes.json + modes-sessions.json）→ 环境与启动参数 ──
# 每轮启动前重解析：注入记忆命名空间、按模式附加人设（--append-system-prompt）。
# 解析逻辑抽到 lib-mode.sh，供 dev.sh 共用——此前只写在这里，导致 dev.sh 静默不注入人设。
# 注意：此处不导出 PI_AGENT_MODE（那是外部硬覆盖位），以免 supervisor 环境把首轮模式固化、
# 导致 /mode 切换后无法刷新；模式按**会话**记录在 modes-sessions.json（gitignored），
# git 操作不会回退它。人设/命名空间的解析要知道"本次加载哪个会话"，故 apply_mode 接收本轮参数。
# shellcheck source=scripts/lib-mode.sh
. "$ROOT/scripts/lib-mode.sh"
MODE_ARGS=()
apply_mode() {
  MODE_ARGS=()
  mode_resolve "$AGENT_DIR" "$(mode_session_arg "$@")"
  export PI_MEMORY_NAMESPACE="$MODE_NS"
  # PI_SESSION_MODE 是 pi 侧的**软**来源（按会话解析）：只在没有 PI_AGENT_MODE 硬覆盖时生效，
  # 且仍会被 session_start 的一致性校验复核。bash 只认 `--session <绝对路径>`，其它形态
  # （-c / -r / 部分 uuid）解析不出来就回落 default，由 pi 侧检测到不一致后自愈重启。
  export PI_SESSION_MODE="$MODE_NAME"
  if [ -n "$MODE_APPEND_ABS" ]; then
    MODE_ARGS=(--append-system-prompt "$MODE_APPEND_ABS")
  fi
}

log() { echo "[supervisor] $*" >&2; }
mkdir -p "$RECOVERY_DIR" "$ROUND_LOG_DIR"

# ── 崩溃计数（24h 时间窗）──
read_crash_count() { cat "$CRASH_COUNT_FILE" 2>/dev/null || echo 0; }
write_crash_count() { echo "$1" > "$CRASH_COUNT_FILE" 2>/dev/null || true; }
reset_crash_count() { rm -f "$CRASH_COUNT_FILE"; }

audit() {
  local type="$1" snippet="$2" action="$3" success="$4" detail="$5" dur="${6:-0}"
  printf '{"ts":%s,"type":"%s","action":"%s","success":%s,"durationMs":%s,"snippet":"%s","detail":"%s"}\n' \
    "$(date +%s)000" "$type" "$action" "$success" "$dur" \
    "$(printf '%s' "$snippet" | tr -d '"' | tr '\n' ' ' | cut -c1-160)" \
    "$(printf '%s' "$detail" | tr -d '"' | tr '\n' ' ')" >> "$AUDIT" 2>/dev/null || true
}

snippet() { [ -f "$1" ] && tail -3 "$1" | tr '\n' ' ' | cut -c1-160 || echo ""; }

# ── admin state（重启/切换会话请求，由 admin_* 工具写入）──
export PI_ADMIN_STATE_FILE="${PI_ADMIN_STATE_FILE:-$AGENT_DIR/autopilot/state.json}"
ADMIN_STATE_FILE="$PI_ADMIN_STATE_FILE"
ACT=""; TARGET=""; PROV=""; MODEL=""; LTS=""
read_admin_action() {
  ACT=""; TARGET=""; PROV=""; MODEL=""; LTS=""
  [ -f "$ADMIN_STATE_FILE" ] || return 0
  local out
  # 第 5 个字段是 restartLog 的时间戳（毫秒）：即使 action 已被清掉也要读出来，
  # detect_lost_restart 靠它判定"这一轮写下的重启请求被吞了"（见下方注释）。
  out=$(node -e 'try{const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const fresh=Date.now()-(+s.timestamp||0)<300000;const ok=fresh&&["restart","switch_session","restart_hang","set_model"].includes(s.action);const logTs=(s.restartLog&&+s.restartLog.timestamp)||0;process.stdout.write([ok?s.action:"",ok?s.targetSession||"":"",ok?s.targetProvider||"":"",ok?s.targetModel||"":"",String(logTs)].join("\u001f"))}catch{}' "$ADMIN_STATE_FILE" 2>/dev/null)
  [ -n "$out" ] || return 0
  IFS=$'\x1f' read -r ACT TARGET PROV MODEL LTS <<<"$out"
}
clear_admin_action() {
  node -e 'try{const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));s.action="none";s.timestamp=0;fs.writeFileSync(p,JSON.stringify(s))}catch{}' "$ADMIN_STATE_FILE" 2>/dev/null || true
}

now_ms() {
  local v
  v="$(date +%s%3N 2>/dev/null)"
  case "$v" in ''|*[!0-9]*) v="$(( $(date +%s) * 1000 ))" ;; esac
  printf '%s' "$v"
}

# ── 判定"刚结束的这一轮写下的重启请求被吞了"（纯函数，test-supervisor.sh 直接测）──
#
# 实测故障（2026-10-06）：mode 自愈在 session_start 里写 action=restart，autopilot 随后消费重启
# 通知时把 action 清成 none（`writeState` 是"默认值+覆盖"），supervisor 读不到 action 就**直接退出**：
# 用户看到"注入了一条系统已重启、进程却退出了、模式也没换"，且事后无从复盘。
#
# 判据刻意收紧，只认"**本轮**写的日志"：action 已不在，但 restartLog 的时间戳落在本轮的
# [roundStart, now] 内 —— 这正是"刚写的请求没落地"。上一轮留下的日志不在窗口内（那是"通知没被
# 消费"，属另一种情况，交给 daily-health 的 notice-undelivered 按 TTL 判），因此正常重启不会误报。
# 用法：detect_lost_restart <action> <restartLogTsMs> <roundStartMs> <nowMs>
detect_lost_restart() {
  local act="$1" lts="$2" start="$3" now="$4"
  case "$act" in restart|restart_hang|switch_session|set_model) return 1 ;; esac
  case "$lts" in ''|*[!0-9]*) return 1 ;; esac
  [ "$lts" -ge "$start" ] 2>/dev/null || return 1
  [ "$lts" -le $(( now + 1000 )) ] 2>/dev/null || return 1
  return 0
}

# ── 结构化轮次记录（事故复盘入口）──
#
# 为什么需要：此前只有 /tmp/my-pi-crash-$$.log（**每轮覆盖**）与只记崩溃恢复的
# recovery-audit.jsonl，于是"上一轮为什么退出、读到了什么 action、用什么参数重启"事后无法还原
# （2026-10-06 排查用户报障时实测：最新 crash log 为空、没有轮次概念）。每轮一行 JSON：
# 轮次/会话/模式/命名空间/人设/读到的 action/退出码/决策/耗时/是否丢了重启请求。
# 文件在 gitignored 的 recovery/ 下，只追加。
json_escape() { printf '%s' "${1:-}" | tr -d '"\\' | tr '\n\r\t' '   ' | cut -c1-300; }
record_round() { # <decision> <action> <target> <exitCode> <lost> <durationMs> [extra-json]
  local decision="$1" act="$2" target="$3" code="$4" lost="$5" dur="$6" extra="${7:-}"
  [ -n "$extra" ] && extra=",${extra}"
  printf '{"ts":%s,"run":%s,"session":"%s","mode":"%s","namespace":"%s","persona":%s,"adminAction":"%s","target":"%s","exitCode":%s,"decision":"%s","durationMs":%s,"lostRestart":%s,"crashLog":"%s"%s}\n' \
    "$(now_ms)" "$ROUND_INDEX" "$(json_escape "$RUN_SESSION")" "$(json_escape "$MODE_NAME")" "$(json_escape "$MODE_NS")" \
    "$([ -n "$MODE_APPEND_ABS" ] && echo true || echo false)" \
    "$(json_escape "$act")" "$(json_escape "$target")" "$code" "$decision" "$dur" "$lost" \
    "$(json_escape "$(basename "${CRASH_LOG:-}")")" "$extra" >>"$ROUNDS_LOG" 2>/dev/null || true
}

# ── admin 请求 → 续接参数（纯函数，test-supervisor.sh 直接测）──
# 结果写入全局数组 ADMIN_ARGS。语义与原项目 pi-wrapper.sh 一致：
#   restart/restart_hang → 优先 --session 精确恢复，缺失回退 --continue
#   switch_session       → --session（缺失回退 --continue）
#   set_model            → --provider/--model，再续接会话
# 绝不能返回空参数启动：空参会让 pi 新建会话（"每次都要手动恢复"的根因）。
ADMIN_ARGS=()
build_admin_args() {
  local act="$1" target="$2" prov="$3" model="$4"
  ADMIN_ARGS=()
  case "$act" in
    restart|restart_hang)
      if [ -n "$target" ]; then ADMIN_ARGS=(--session "$target"); else ADMIN_ARGS=(--continue); fi
      ;;
    switch_session)
      if [ -n "$target" ]; then ADMIN_ARGS=(--session "$target"); else ADMIN_ARGS=(--continue); fi
      ;;
    set_model)
      if [ -n "$prov" ] && [ -n "$model" ]; then
        ADMIN_ARGS=(--provider "$prov" --model "$model")
        if [ -n "$target" ]; then ADMIN_ARGS+=(--session "$target"); else ADMIN_ARGS+=(--continue); fi
      fi
      ;;
  esac
}

# ── 崩溃恢复的重启日志（让新进程知道"我是崩溃后被拉起的"）──
#
# 崩溃恢复路径**不走 admin action**（没有待执行动作），于是新进程完全不知道自己是重启来的，
# 更不会接上被崩溃打断的工作。这里写一条**只读日志**（不是 action）：
#   intent=auto → 新进程按会话盘面尾部判是否续跑（被打断的继续、已收尾的不动，见
#   custom/core/restart-intent.ts）。
# 绝不覆盖真正待执行的 action：那种情况下日志归 supervisor 的下一次重启所有。
mark_recovery_restart_log() { # <crashClass>
  local cls="${1:-unknown}"
  node -e '
    const fs = require("fs");
    const p = process.argv[1], cls = process.argv[2];
    let s = { action: "none", timestamp: 0, restartLog: null };
    try { s = { ...s, ...JSON.parse(fs.readFileSync(p, "utf8")) }; } catch { /* 缺失/损坏 → 用骨架 */ }
    // 有待执行动作时不抢它的日志（node -e 顶层不能用 return，故写成条件块）
    if (!(s.action && s.action !== "none")) {
      s.restartLog = { action: "restart", reason: `崩溃恢复（${cls}）`, intent: "auto", timestamp: Date.now() };
      fs.writeFileSync(p, JSON.stringify(s));
    }
  ' "$ADMIN_STATE_FILE" "$cls" 2>/dev/null || true
}

# ── 健康检查：核心模块可完整加载（无扩展）──
health_check() {
  log "健康检查..."
  local hc_log="/tmp/my-pi-health-$$.log"
  if timeout 90 node "$CLI" --no-extensions --no-skills --no-session -p 'Say exactly: ok' >"$hc_log" 2>&1; then
    rm -f "$hc_log"
    return 0
  fi
  log "健康检查失败：$([ -f "$hc_log" ] && head -5 "$hc_log" | tr '\n' ' ')"
  rm -f "$hc_log"
  return 1
}

# ── 分类：transient | external | pi_self ──
classify_crash() {
  local crash_log="$1"
  [ -f "$crash_log" ] || { echo "external"; return; }
  # 5xx/429 必须带数字边界，且后一个字符不能是字母/数字：
  # 避免命中时长/端口/行号里的数字串（1502ms 的 502、:4290 的 429、500ms 的 500）。
  if grep -qE "(^|[^0-9])(50[0-9]|429)([^0-9A-Za-z]|$)|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up|rate.limit|stream interrupted|timeout.*exceeded|Upstream request failed" "$crash_log" 2>/dev/null; then
    echo "transient"; return
  fi
  if grep -qE "SyntaxError|ParseError|Unexpected (reserved )?token|Cannot find module|ERR_MODULE_NOT_FOUND|does not provide an export named" "$crash_log" 2>/dev/null; then
    local clean
    clean=$(sed 's/\x1b\[[0-9;]*m//g' "$crash_log")
    if printf '%s' "$clean" | grep -qE "coding-agent/(dist|src)/|vendor/pi/packages/coding-agent"; then
      echo "pi_self"; return
    fi
    echo "external"; return
  fi
  echo "external"
}

# ── 启动修复者 pi（屏蔽扩展/技能），读崩溃日志自行修复 ──
run_fix_pi() {
  local bin="$1" crash_log="$2" label="$3"
  log "=== 启动修复者: $label ($bin) ==="
  local fix_log="/tmp/my-pi-fix-$$.log"
  local instruction
  instruction="你是 pi 崩溃修复者。项目根: $ROOT；配置目录: $AGENT_DIR。
1. 用 read 工具读取崩溃日志 $crash_log
2. 分析错误原因（扩展/配置/依赖/源码）
3. 用 edit/write/bash 修复（不要修改 vendor/pi 源码，除非确认是核心补丁问题；改动经 $ROOT/patches 管理）
4. 验证：node --check 出错文件，或运行 bash $ROOT/scripts/golden-tasks.sh
5. 最后输出一行：修复完成"
  # 救援 playbook（my-pi 专属路径与流程）：存在则以 system prompt 追加，
  # 让修复者拿到完整证据链/修复路径/纪律，而 -p 只留最短任务陈述（对齐 pi-tools 的 rescue-prompt.md）。
  local rescue="$RECOVERY_DIR/rescue-prompt.md"
  local append=()
  [ -f "$rescue" ] && append=(--append-system-prompt "$rescue")
  local rc=0
  timeout "$FIX_TIMEOUT" node "$bin" --no-extensions --no-skills --no-session \
    ${append[@]+"${append[@]}"} -p "$instruction" >"$fix_log" 2>&1 || rc=$?
  [ "$rc" -eq 124 ] && log "修复者超时（${FIX_TIMEOUT}s），已终止"
  [ -s "$fix_log" ] && log "修复输出: $(tail -3 "$fix_log" | tr '\n' ' ' | cut -c1-200)"
  return $rc
}

# ── 确保源码缓存构建存在（用于修 pi 自身）──
ensure_cache_build() {
  [ -f "$CACHE_CLI" ] && return 0
  log "源码缓存不存在，尝试构建（scripts/build.sh 后缓存 dist）..."
  bash "$ROOT/scripts/pi-source-build.sh" >&2 || true
  [ -f "$CACHE_CLI" ]
}

# ── 库模式（测试）：定义完函数即返回，不进入主循环 ──
# scripts/test-supervisor.sh 用 `MY_PI_SUPERVISOR_LIB=1 source 本文件` 直接测纯函数
# （classify_crash / read_admin_action），无需网络、CLI 或 provider。
if [ "${MY_PI_SUPERVISOR_LIB:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

# ── 主循环 ──
# --no-context-files：关掉 pi 原生的 AGENTS.md/CLAUDE.md 注入（它进 system prompt 的
# project_context 段 = 前缀最前处，而这份文件由 my-pi 自己频繁编辑 → 每改一次整段前缀作废）。
# 改由 custom/features/context 以尾部 append-only 消息注入，见 budget/workspace-instructions.ts。
ORIG_ARGS=(--extension "$ROOT/custom/bootstrap.ts" --no-context-files "$@")

# 脚本自重载：保存原始参数与当前脚本哈希，供主循环检测变更后 exec 自身。
USER_ARGS=("$@")
SELF="${BASH_SOURCE[0]}"
SELF_HASH="$(sha256sum "$SELF" 2>/dev/null | cut -c1-16)"

if [ "${MY_PI_NO_SUPERVISOR:-0}" = "1" ]; then
  apply_mode "$@"
  exec node "$CLI" "${ORIG_ARGS[@]}" "${MODE_ARGS[@]}"
fi

if [ ! -f "$CLI" ]; then
  echo "❌ 未找到 $CLI，请先运行：bash scripts/build.sh" >&2
  exit 1
fi

RECOVERY_ROUNDS=0
CONSECUTIVE_FAIL=0
LAST_CLASS=""
EXTRA_ARGS=()
# admin 请求的续接参数：case 分支写入，下一轮开头消费。
# 必须跨 `continue` 存活——否则会被下一轮的 EXTRA_ARGS 重置吞掉（历史 bug：
# 重启请求写了 --session 却仍以空参启动，pi 新建会话，用户永远回不到原会话）。
PENDING_ARGS=()

while true; do
  # supervisor 脚本自身变更检测：改脚本后无需手工重跑 my-pi.sh，
  # pi 退出回到主循环时自动 exec 载入新脚本（此时 pi 未运行，不会中断会话）。
  NOW_HASH="$(sha256sum "$SELF" 2>/dev/null | cut -c1-16)"
  if [ -n "$NOW_HASH" ] && [ -n "$SELF_HASH" ] && [ "$NOW_HASH" != "$SELF_HASH" ]; then
    log "supervisor 脚本已更新（$SELF_HASH → $NOW_HASH），重载自身"
    if [ "${#USER_ARGS[@]}" -gt 0 ]; then
      exec bash "$SELF" "${USER_ARGS[@]}"
    else
      exec bash "$SELF"
    fi
  fi

  # 每轮重置：防上一轮的 --provider/--model/--session 残留累积（对应原 wrapper 的
  # 「Reset extra args each iteration to avoid accumulation」）。
  # 顺序关键：先把上一轮 admin 分支存入 PENDING_ARGS 的参数取出，再清空 PENDING_ARGS；
  # 重置只针对"未被消费的残留"，不会吃掉本轮要用的续接参数。
  EXTRA_ARGS=("${PENDING_ARGS[@]}")
  PENDING_ARGS=()
  # 会话参数按 argv 顺序取最后一个：本轮实际启动的命令行是 `$@` + EXTRA_ARGS
  # （EXTRA_ARGS 是 admin 重启写入的 --session，优先级更高）。
  apply_mode "$@" "${EXTRA_ARGS[@]}"
  # 本轮事实：会话（供轮次记录与丢请求判定）、起始时刻、按轮保留的 crash log。
  RUN_SESSION="$(mode_session_arg "$@" "${EXTRA_ARGS[@]}")"
  ROUND_INDEX=$((ROUND_INDEX + 1))
  ROUND_START_MS="$(now_ms)"
  CRASH_LOG="$ROUND_LOG_DIR/round-${ROUND_INDEX}.log"
  # crash log 必须**按轮保留**：旧实现是 /tmp/my-pi-crash-$$.log，每轮覆盖，
  # 事故复盘时连"上一轮为什么退出"都看不到（2026-10-06 实测）。只留最近 ROUND_LOG_KEEP 轮。
  ls -1t "$ROUND_LOG_DIR"/round-*.log 2>/dev/null | tail -n +$((ROUND_LOG_KEEP + 1)) | xargs -r rm -f 2>/dev/null || true
  log "启动 Pi...（第 $ROUND_INDEX 轮，模式 ${MODE_NAME}${MODE_NS:+ / ns=$MODE_NS}）"
  node "$CLI" "${ORIG_ARGS[@]}" "${MODE_ARGS[@]}" "${EXTRA_ARGS[@]}" 2>"$CRASH_LOG"
  EXIT_CODE=$?
  ROUND_DUR_MS=$(( $(now_ms) - ROUND_START_MS ))

  # 正常退出或用户中断：先看 admin state 是否请求重启/切换会话，否则退出
  if [ "$EXIT_CODE" -eq 0 ] || [ "$EXIT_CODE" -eq 130 ] || [ "$EXIT_CODE" -eq 143 ]; then
    reset_crash_count
    read_admin_action
    # 关键自检：本轮写下的重启请求没有被 supervisor 读到 → 那次重启被吞了（见 detect_lost_restart）。
    LOST="false"
    if detect_lost_restart "$ACT" "$LTS" "$ROUND_START_MS" "$(now_ms)"; then
      LOST="true"
      log "⚠ 本轮写下的重启请求没有落地（action=${ACT:-空}，日志 ts=$LTS，轮次起点 $ROUND_START_MS）："
      log "  若刚才切过模式或请求过重启，说明那次重启被吞了（进程退出但没重拉）。记录见 $ROUNDS_LOG"
      audit "lost_restart" "" "warn" "false" "action=${ACT:-none} logTs=$LTS roundStart=$ROUND_START_MS"
    fi
    case "$ACT" in
      restart|restart_hang)
        log "admin 请求重启（$ACT），重新启动..."
        clear_admin_action
        # 优先 --session 精确恢复当前会话；缺失时回退 --continue 恢复最近会话。
        # 写入 PENDING_ARGS（而非 EXTRA_ARGS）：EXTRA_ARGS 在下一轮开头会被重置。
        build_admin_args "$ACT" "$TARGET" "$PROV" "$MODEL"
        PENDING_ARGS=("${ADMIN_ARGS[@]}")
        record_round restart "$ACT" "$TARGET" "$EXIT_CODE" "$LOST" "$ROUND_DUR_MS"
        log "续接参数: ${PENDING_ARGS[*]}"
        continue
        ;;
      set_model)
        if [ -n "$PROV" ] && [ -n "$MODEL" ]; then
          log "admin 请求切换模型: $PROV/$MODEL"
          clear_admin_action
          build_admin_args "$ACT" "$TARGET" "$PROV" "$MODEL"
          PENDING_ARGS=("${ADMIN_ARGS[@]}")
          record_round set_model "$ACT" "$TARGET" "$EXIT_CODE" "$LOST" "$ROUND_DUR_MS" ",\"provider\":\"$(json_escape "$PROV")\",\"model\":\"$(json_escape "$MODEL")\""
          log "续接参数: ${PENDING_ARGS[*]}"
          continue
        fi
        ;;
      switch_session)
        log "admin 请求切换会话: ${TARGET:-（缺目标，回退 --continue）}"
        clear_admin_action
        build_admin_args "$ACT" "$TARGET" "$PROV" "$MODEL"
        PENDING_ARGS=("${ADMIN_ARGS[@]}")
        record_round switch_session "$ACT" "$TARGET" "$EXIT_CODE" "$LOST" "$ROUND_DUR_MS"
        log "续接参数: ${PENDING_ARGS[*]}"
        continue
        ;;
    esac
    record_round exit "$ACT" "$TARGET" "$EXIT_CODE" "$LOST" "$ROUND_DUR_MS"
    exit "$EXIT_CODE"
  fi

  # 崩溃计数（24h 窗口）
  NOW_MS=$(date +%s)
  COUNT=$(read_crash_count)
  LAST_MS=$(cat "$RECOVERY_DIR/crash-ts" 2>/dev/null || echo 0)
  if [ "${LAST_MS:-0}" -gt 0 ] 2>/dev/null && [ $((NOW_MS - LAST_MS)) -gt "$CRASH_WINDOW_MS" ]; then
    COUNT=0
  fi
  COUNT=$((COUNT + 1))
  write_crash_count "$COUNT"
  echo "$NOW_MS" > "$RECOVERY_DIR/crash-ts"

  CLASS=$(classify_crash "$CRASH_LOG")
  SNIP=$(snippet "$CRASH_LOG")
  log "崩溃 #$COUNT (exit $EXIT_CODE) 分类=$CLASS"

  if [ "$COUNT" -ge "$CIRCUIT_BREAKER_THRESHOLD" ]; then
    log "已连续崩溃 $COUNT 次（>=熔断阈值 $CIRCUIT_BREAKER_THRESHOLD），停止恢复"
    audit "$CLASS" "$SNIP" "circuit_breaker" "false" "熔断"
    record_round circuit_breaker "" "" "$EXIT_CODE" false "$ROUND_DUR_MS" ",\"crashClass\":\"$(json_escape "$CLASS")\",\"crashCount\":$COUNT"
    break
  fi

  RECOVERY_ROUNDS=$((RECOVERY_ROUNDS + 1))
  if [ "$RECOVERY_ROUNDS" -gt "$MAX_RECOVERY_ROUNDS" ]; then
    log "已达最大恢复轮数 $MAX_RECOVERY_ROUNDS，停止"
    audit "$CLASS" "$SNIP" "max_rounds" "false" "超过最大恢复轮数"
    record_round max_recovery_rounds "" "" "$EXIT_CODE" false "$ROUND_DUR_MS" ",\"crashClass\":\"$(json_escape "$CLASS")\",\"crashCount\":$COUNT"
    break
  fi

  # 同类型连续失败 → 升级
  if [ "$CLASS" = "$LAST_CLASS" ]; then
    CONSECUTIVE_FAIL=$((CONSECUTIVE_FAIL + 1))
  else
    CONSECUTIVE_FAIL=0
  fi
  LAST_CLASS="$CLASS"

  START=$(date +%s)
  RECOVERY_OK=0

  case "$CLASS" in
    transient)
      log "临时性错误，指数退避重试（第 $COUNT 次）"
      sleep "$(( COUNT < 8 ? COUNT * 2 : 16 ))"
      RECOVERY_OK=1
      ;;
    external)
      log "外部问题：用当前 pi（屏蔽扩展/技能）修复"
      if run_fix_pi "$CLI" "$CRASH_LOG" "外部修复"; then RECOVERY_OK=1; fi
      if [ "$RECOVERY_OK" -eq 0 ] && [ "$CONSECUTIVE_FAIL" -ge 1 ]; then
        log "连续外部失败，升级：重置配置快照（如有）"
      fi
      ;;
    pi_self)
      log "pi 自身损坏：用源码缓存 pi 修复"
      if ensure_cache_build; then
        if run_fix_pi "$CACHE_CLI" "$CRASH_LOG" "自我修复（源码缓存）"; then RECOVERY_OK=1; fi
      fi
      if [ "$RECOVERY_OK" -eq 0 ]; then
        log "回退：源码重建 scripts/build.sh"
        if bash "$ROOT/scripts/build.sh" >&2; then RECOVERY_OK=1; fi
      fi
      ;;
  esac

  DUR=$(( $(date +%s) - START ))
  if [ "$RECOVERY_OK" -eq 1 ] && health_check; then
    audit "$CLASS" "$SNIP" "recover" "true" "恢复成功" "$DUR"
    record_round recover_restart "" "$TARGET" "$EXIT_CODE" false "$ROUND_DUR_MS" ",\"crashClass\":\"$(json_escape "$CLASS")\",\"recoveryMs\":$(( DUR * 1000 ))"
    log "恢复成功，重启..."
    reset_crash_count
    RECOVERY_ROUNDS=0
    CONSECUTIVE_FAIL=0
    mark_recovery_restart_log "$CLASS"
    ORIG_ARGS=(--extension "$ROOT/custom/bootstrap.ts" --no-context-files "$@" --continue)
    sleep 1
    continue
  fi

  audit "$CLASS" "$SNIP" "recover" "false" "恢复失败/健康检查不通过" "$DUR"
  record_round recover_retry "" "$TARGET" "$EXIT_CODE" false "$ROUND_DUR_MS" ",\"crashClass\":\"$(json_escape "$CLASS")\",\"recoveryOk\":false"
  log "恢复失败，1s 后重试"
  sleep 1
done

log "已退出，crash log 保留在 $CRASH_LOG"
exit 1
