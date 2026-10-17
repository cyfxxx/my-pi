#!/usr/bin/env bash
# dsh-gc.sh — 仓内 DSH home 的增长治理（`portable/dsh/`）
#
# 为什么需要：`DSH_HOME` 默认落在 `<repo>/portable/dsh`（仓内便携），它会持续长：
#   - `sessions/<cwd>/session-*/`     每个会话一个目录（含 `session.v4.jsonl.zstd`）
#   - `logs/startup-*.log`            每次启动一份诊断
#   - `storages/`、`profiles/`        小型状态
# 仓内 home 的好处是"完全便携"，代价是**没有系统级的 tmp 清理**替你兜底 ⇒ 得自己收。
#
# 安全边界（刻意保守）：
#   * **只**动 `<repo>/portable/dsh` 下的 `sessions/**` 与 `logs/**`；别的目录一概不碰
#     （尤其**不碰** `runtime/<平台>/ext/dsh` 宿主、`dsh/plugin/dist` 产物、`profiles/`）。
#   * **默认 dry-run**：不加 `--yes` 只报告会删什么、能回收多少。
#   * 解析后的绝对路径必须仍在 `portable/dsh` 之内（防 `..`/软链逃逸）。
#
# 用法：
#   bash scripts/dsh-gc.sh status                        # 只看占用（各目录 + 总计）
#   bash scripts/dsh-gc.sh prune                          # 预览：会删哪些、回收多少
#   bash scripts/dsh-gc.sh prune --yes                    # 真删（按默认保留策略）
#   bash scripts/dsh-gc.sh prune --keep-sessions 20 --max-age-days 30 --yes
#
# 保留策略（默认）：
#   * 会话：**保留最近 10 个**（按目录 mtime），且**任何** 30 天内用过的都不删；
#   * 日志：保留 14 天内的 `startup-*.log`；
#   * 空目录/残留 `.tmp` 一并清（同一 dry-run 语义）。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${MY_PI_DSH_HOME:-$ROOT/portable/dsh}"

KEEP_SESSIONS=10
MAX_AGE_DAYS=30
YES=0
CMD="${1:-status}"
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --keep-sessions) KEEP_SESSIONS="${2:-10}"; shift 2 ;;
    --max-age-days)  MAX_AGE_DAYS="${2:-30}"; shift 2 ;;
    --yes|-y)        YES=1; shift ;;
    --dry-run)       YES=0; shift ;;
    *) echo "用法: $0 {status|prune} [--keep-sessions N] [--max-age-days D] [--yes]" >&2; exit 2 ;;
  esac
done

# 边界：home 必须存在且在仓库内（或显式 MY_PI_DSH_HOME 且仍以 portable/dsh 结尾的绝对路径）
[ -d "$HOME_DIR" ] || { echo "· 没有 $HOME_DIR（还没起过 DSH 实例）⇒ 无事可做"; exit 0; }
HOME_ABS="$(cd "$HOME_DIR" && pwd -P)" || exit 2
case "$HOME_ABS" in
  "$ROOT"/portable/dsh|"$ROOT"/portable/dsh/*) : ;;
  *) echo "❌ 拒绝操作：$HOME_ABS 不在 $ROOT/portable/dsh 之内（安全边界）" >&2; exit 2 ;;
esac

human() { awk -v b="${1:-0}" 'BEGIN{printf "%.1f MiB", b/1048576}'; }
du_bytes() { du -sb "$1" 2>/dev/null | awk '{print $1}'; }

cmd_status() {
  echo "=== DSH 仓内 home：$HOME_ABS ==="
  local total=0 part
  for part in sessions logs storages profiles; do
    if [ -e "$HOME_ABS/$part" ]; then
      local b; b="$(du_bytes "$HOME_ABS/$part")"
      total=$((total + b))
      printf '  %-10s %10s  (%s 个条目)\n' "$part" "$(human "$b")" "$(find "$HOME_ABS/$part" -mindepth 1 -maxdepth 1 -print0 2>/dev/null | tr -cd '\0' | wc -c)"
    fi
  done
  echo "  ------"
  printf '  %-10s %10s\n' "合计" "$(human "$total")"
  echo "  回收预览：bash scripts/dsh-gc.sh prune"
}

# 判定一个会话目录是否该删：超出"最近 N 个"且最后修改早于 max-age
session_dirs() { find "$HOME_ABS/sessions" -mindepth 2 -maxdepth 2 -type d -name 'session-*' -printf '%T@\t%p\n' 2>/dev/null | sort -rn; }

cmd_prune() {
  local now deleted=0 freed=0
  now="$(date +%s)"
  echo "=== 回收预览（$([ "$YES" = 1 ] && echo '执行' || echo 'dry-run，加 --yes 才真删')）==="

  # ① 会话目录：保留最近 KEEP_SESSIONS 个；且 max-age 内的不删
  local total index=0 path mtime age_days
  local session_list; session_list="$(session_dirs)"
  total="$(printf '%s\n' "$session_list" | grep -c . || true)"
  echo "· 会话：共 $total 个（保留最近 $KEEP_SESSIONS 个；$MAX_AGE_DAYS 天内用过的也不删）"
  while IFS=$'\t' read -r mtime path; do
    [ -n "${path:-}" ] || continue
    index=$((index + 1))
    [ "$index" -le "$KEEP_SESSIONS" ] && continue
    age_days=$(( (now - ${mtime%.*}) / 86400 ))
    [ "$age_days" -lt "$MAX_AGE_DAYS" ] && continue
    local b; b="$(du_bytes "$path")"
    freed=$((freed + b)); deleted=$((deleted + 1))
    echo "    - $path（${age_days} 天前，$(human "$b")）"
    if [ "$YES" = 1 ]; then rm -rf -- "$path"; fi
  done <<< "$session_list"

  # ② 启动日志：超过 14 天
  local log_path
  if [ -d "$HOME_ABS/logs" ]; then
    while IFS= read -r -d '' log_path; do
      local b; b="$(du_bytes "$log_path")"
      freed=$((freed + b)); deleted=$((deleted + 1))
      echo "    - $log_path（日志过期）"
      if [ "$YES" = 1 ]; then rm -f -- "$log_path"; fi
    done < <(find "$HOME_ABS/logs" -type f -name 'startup-*.log' -mtime +14 -print0 2>/dev/null)
  fi

  # ③ 空目录与 .tmp 残留
  while IFS= read -r -d '' path; do
    echo "    - $path（空目录/残留）"
    if [ "$YES" = 1 ]; then rm -rf -- "$path"; fi
  done < <(find "$HOME_ABS" -type d -empty -print0 2>/dev/null; find "$HOME_ABS" -name '*.tmp' -print0 2>/dev/null)

  echo "· 命中 $deleted 项，可回收 $(human "$freed")"
  if [ "$YES" = 1 ]; then
    echo "✓ 已删除；当前占用：$(human "$(du_bytes "$HOME_ABS")")"
  else
    echo "（dry-run：什么都没删。确认后加 --yes）"
  fi
}

case "$CMD" in
  status) cmd_status ;;
  prune)  cmd_prune ;;
  *) echo "用法: $0 {status|prune} [--keep-sessions N] [--max-age-days D] [--yes]" >&2; exit 2 ;;
esac
