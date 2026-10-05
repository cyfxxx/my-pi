#!/bin/bash
# prepush-scope.sh — pre-push 门禁范围判定：本次推送是"纯运行数据"还是"含代码/配置"。
#
# 背景（2026-10-05）：tool-stats-daily 定时任务把工具统计提交后要 push，而 pre-push 无条件
# 跑**全量** golden（tsc + 72 文件单测 + web-terminal，实测约 4~5 分钟）。纯数据提交反复撞
# 任务预算，当天 4 次运行里 3 次 1200s 超时，还在工作区留下 staged 残留。门禁应当与改动的
# 影响面成比例：`portable/memory/stats/` 下的计数 JSON 不可能让测试变红。
#
# 用法（由 .githooks/pre-push 调用）：
#   bash scripts/prepush-scope.sh <remote_oid> <local_oid>
# 输出（stdout 单行）：
#   fast  —— 本次推送的全部改动都在 DATA_PATHS 内，pre-push 可降级为 golden --fast
#   full  —— 其余一切情况（含任何不确定），必须跑全量 golden
#
# 判定必须**保守**：任何拿不准（对象不存在、空 diff、合并提交范围不明、路径不在白名单）
# 一律 full。放宽白名单要有证据，不能靠"应该没问题"。
set -u

DATA_PATHS_RE='^portable/memory/stats/'

remote_oid="${1:-}"
local_oid="${2:-}"

full() { echo full; exit 0; }

[ -n "$remote_oid" ] && [ -n "$local_oid" ] || full
case "$remote_oid" in *[!0]*) ;; *) full ;; esac   # 全 0 = 新分支/远端尚无此 ref
case "$local_oid" in *[!0]*) ;; *) full ;; esac    # 全 0 = 删除 ref

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || full
cd "$ROOT" || full

# 远端对象本地没有（首次推送/未 fetch）→ 无从 diff，别猜
git cat-file -e "${remote_oid}^{commit}" 2>/dev/null || full
git cat-file -e "${local_oid}^{commit}" 2>/dev/null || full

changed="$(git diff --name-only "$remote_oid" "$local_oid" 2>/dev/null)" || full
[ -n "$changed" ] || full

while IFS= read -r p; do
  [ -n "$p" ] || continue
  # 白名单按前缀正则匹配；不在名单内的路径一律 full
  if ! printf '%s' "$p" | grep -Eq "$DATA_PATHS_RE"; then
    full
  fi
done <<<"$changed"

echo fast
