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
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/vendor/pi/packages/coding-agent/dist/cli.js"
AGENT_DIR="$ROOT/portable/agent"
RECOVERY_DIR="$AGENT_DIR/recovery"
CACHE_CLI="$RECOVERY_DIR/cache/dist/cli.js"
AUDIT="$RECOVERY_DIR/recovery-audit.jsonl"
CRASH_COUNT_FILE="$RECOVERY_DIR/crash-count"

CRASH_THRESHOLD="${CRASH_THRESHOLD:-3}"
CIRCUIT_BREAKER_THRESHOLD="${CIRCUIT_BREAKER_THRESHOLD:-5}"
MAX_RECOVERY_ROUNDS="${MAX_RECOVERY_ROUNDS:-5}"
CRASH_WINDOW_MS="${CRASH_WINDOW_MS:-86400}"  # 秒
FIX_TIMEOUT="${PI_FIX_TIMEOUT:-240}"

export PI_CODING_AGENT_DIR="$AGENT_DIR"
export PI_MEMORY_DIR="$ROOT/portable/memory"

# ── 模式（modes.json）→ 环境与启动参数 ──
# 每轮启动前重解析：注入记忆命名空间、按模式附加人设（--append-system-prompt）。
# 功能过滤由 bootstrap.ts 读取同一文件完成；此处不导出 PI_AGENT_MODE，
# 以免 supervisor 环境把首轮模式固化、导致 /mode 切换后无法刷新。
MODE_ARGS=()
apply_mode() {
  MODE_ARGS=()
  local out mode ns ap file
  out=$(node -e '
const fs=require("fs");
let mode=process.env.PI_AGENT_MODE||"";
let ns="",ap="";
try{
  const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if(!mode) mode=j.current||j.default||"full";
  const cfg=(j.modes&&j.modes[mode])||null;
  if(cfg){ ns=cfg.memoryNamespace||""; ap=cfg.appendPrompt||""; }
}catch(e){ if(!mode) mode="full"; }
process.stdout.write(mode+"\t"+ns+"\t"+ap);
' "$AGENT_DIR/modes.json" 2>/dev/null)
  IFS=$'\t' read -r mode ns ap <<<"$out"
  export PI_MEMORY_NAMESPACE="$ns"
  if [ -n "$ap" ] && [ -f "$AGENT_DIR/$ap" ]; then
    MODE_ARGS=(--append-system-prompt "$AGENT_DIR/$ap")
  fi
}

log() { echo "[supervisor] $*" >&2; }
mkdir -p "$RECOVERY_DIR"

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
ACT=""; TARGET=""
read_admin_action() {
  ACT=""; TARGET=""; PROV=""; MODEL=""
  [ -f "$ADMIN_STATE_FILE" ] || return 0
  local out
  out=$(node -e 'try{const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const fresh=Date.now()-(+s.timestamp||0)<300000;const ok=fresh&&["restart","switch_session","restart_hang","set_model"].includes(s.action);process.stdout.write(ok?[s.action,s.targetSession||"",s.targetProvider||"",s.targetModel||""].join("\t"):"")}catch{}' "$ADMIN_STATE_FILE" 2>/dev/null)
  [ -n "$out" ] || return 0
  IFS=$'\t' read -r ACT TARGET PROV MODEL <<<"$out"
}
clear_admin_action() {
  node -e 'try{const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));s.action="none";s.timestamp=0;fs.writeFileSync(p,JSON.stringify(s))}catch{}' "$ADMIN_STATE_FILE" 2>/dev/null || true
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
  if grep -qE "50[0-9]|429|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up|rate.limit|stream interrupted|timeout.*exceeded|Upstream request failed" "$crash_log" 2>/dev/null; then
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
  local rc=0
  timeout "$FIX_TIMEOUT" node "$bin" --no-extensions --no-skills --no-session -p "$instruction" >"$fix_log" 2>&1 || rc=$?
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

# ── 主循环 ──
ORIG_ARGS=(--extension "$ROOT/custom/bootstrap.ts" "$@")

# 脚本自重载：保存原始参数与当前脚本哈希，供主循环检测变更后 exec 自身。
USER_ARGS=("$@")
SELF="${BASH_SOURCE[0]}"
SELF_HASH="$(sha256sum "$SELF" 2>/dev/null | cut -c1-16)"

if [ "${MY_PI_NO_SUPERVISOR:-0}" = "1" ]; then
  apply_mode
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

  apply_mode
  log "启动 Pi..."
  CRASH_LOG="/tmp/my-pi-crash-$$.log"
  node "$CLI" "${ORIG_ARGS[@]}" "${MODE_ARGS[@]}" "${EXTRA_ARGS[@]}" 2>"$CRASH_LOG"
  EXIT_CODE=$?

  # 正常退出或用户中断：先看 admin state 是否请求重启/切换会话，否则退出
  if [ "$EXIT_CODE" -eq 0 ] || [ "$EXIT_CODE" -eq 130 ] || [ "$EXIT_CODE" -eq 143 ]; then
    reset_crash_count
    read_admin_action
    case "$ACT" in
      restart|restart_hang)
        log "admin 请求重启（$ACT），重新启动..."
        clear_admin_action
        # 显式 --session 恢复当前会话，不再依赖「最近修改会话」推断
        if [ -n "$TARGET" ]; then
          log "恢复会话: $TARGET"
          EXTRA_ARGS=(--session "$TARGET")
        else
          EXTRA_ARGS=()
        fi
        continue
        ;;
      set_model)
        if [ -n "$PROV" ] && [ -n "$MODEL" ]; then
          log "admin 请求切换模型: $PROV/$MODEL"
          clear_admin_action
          EXTRA_ARGS=(--provider "$PROV" --model "$MODEL")
          if [ -n "$TARGET" ]; then
            EXTRA_ARGS+=(--session "$TARGET")
          fi
          continue
        fi
        ;;
      switch_session)
        if [ -n "$TARGET" ]; then
          log "admin 请求切换会话: $TARGET"
          clear_admin_action
          EXTRA_ARGS=(--session "$TARGET")
          continue
        fi
        ;;
    esac
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
    break
  fi

  RECOVERY_ROUNDS=$((RECOVERY_ROUNDS + 1))
  if [ "$RECOVERY_ROUNDS" -gt "$MAX_RECOVERY_ROUNDS" ]; then
    log "已达最大恢复轮数 $MAX_RECOVERY_ROUNDS，停止"
    audit "$CLASS" "$SNIP" "max_rounds" "false" "超过最大恢复轮数"
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
    log "恢复成功，重启..."
    reset_crash_count
    RECOVERY_ROUNDS=0
    CONSECUTIVE_FAIL=0
    ORIG_ARGS=(--extension "$ROOT/custom/bootstrap.ts" "$@" --continue)
    sleep 1
    continue
  fi

  audit "$CLASS" "$SNIP" "recover" "false" "恢复失败/健康检查不通过" "$DUR"
  log "恢复失败，1s 后重试"
  sleep 1
done

log "已退出，crash log 保留在 $CRASH_LOG"
exit 1
