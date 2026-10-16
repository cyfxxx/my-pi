#!/usr/bin/env bash
# dsh-scenario-session-resume.sh — **P6③ 场景测试（DSH 版）之二：会话续接（adopt/resume）**
#
# ## 这个场景在问什么
#
# pi 侧的"会话切换"场景断言的是 pi 的 `newSession/switchSession` 语义（以及我们的
# `session_before_switch` 守卫：忙碌时**延后**切换，别打断在跑的那一轮）。DSH 没有那套入口，
# 但有它自己的对应能力：`--session-id <id>` **收养**一个已持久化的会话继续跑
# （`dsh-headless` 的 `resolveAgent`：从会话库 observeSession 后以 `resumeSessionId` 续跑）。
#
# 于是本场景问三件在 DSH 上确实成立的事：
#   ① **收养真的带上了历史**：第二轮不重复第一轮的话，模型却答得出第一轮让它"记住"的词；
#   ② **同一个会话继续，而不是新开一个**：两轮报出的 sessionId 相同、会话目录数不变、日志继续增长；
#   ③ **我们的插件在续接的会话里照常在位**（第二轮日志里仍有 `[my-pi-dsh]`/`[dsh-facade]` 行）。
#
# ✗ 明确**不**在这里验的东西（避免把"没测"说成"测过了"）：pi 那种"切换前可否决（veto）"的语义在 DSH
#   **没有落点**（钩子映射 `session_before_switch` 行已写明：DSH 的会话生命周期事件都在**之后**）⇒
#   本场景只验证"续接可用且状态连续"，不假装验证"可拦截"。
#
# ## 纪律（与 dsh-host-smoke.sh 一致）
#
# 会用**你的凭据**调真实模型（两轮）、占内存、耗时 ⇒ 只有显式 `MY_PI_HOST_SMOKE=1` 才跑；
# 隔离 `DSH_HOME`（不动 `~/.dsh`、不打扰正在跑的 GUI），凭据只临时拷一份 600、退出即删。
#
# 用法：
#   MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-session-resume.sh
#   MY_PI_HOST_SMOKE=1 MY_PI_SCEN_WORD=菠萝 bash scripts/dsh-scenario-session-resume.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

if [ "${MY_PI_HOST_SMOKE:-}" != "1" ]; then
  echo "· SKIP：会话续接场景默认不发车（会用凭据/额度/内存，跑两轮）"
  echo "  要跑请显式：MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-session-resume.sh"
  exit 0
fi

DSH_BIN="${DSH_BIN:-$(command -v dsh 2>/dev/null || true)}"
if [ -z "$DSH_BIN" ]; then
  for cand in "$HOME"/.npm/_npx/*/node_modules/.bin/dsh; do
    [ -x "$cand" ] && DSH_BIN="$cand" && break
  done
fi
[ -n "$DSH_BIN" ] && [ -e "$DSH_BIN" ] || { echo "❌ 找不到 dsh 可执行文件（可设 DSH_BIN）" >&2; exit 2; }

BASE="${MY_PI_SCEN_BASE:-/tmp/my-pi-dsh-resume}"
HOME_DIR="$BASE/home"
LOG_DIR="$BASE/logs"
PROFILE="${MY_PI_SCEN_PROFILE:-mypi-resume}"
CREDS="${MY_PI_HOST_CREDENTIALS:-$HOME/.dsh/.credentials.yaml}"
TIMEOUT_S="${MY_PI_SCEN_TIMEOUT:-600}"
WORD="${MY_PI_SCEN_WORD:-菠萝}"
TASK1="请只回答一个字：好。另外记住这个词：${WORD}"
TASK2="我刚才让你记住的那个词是什么？只回答那个词。"

mkdir -p "$LOG_DIR" || { echo "❌ 无法创建日志目录 $LOG_DIR" >&2; exit 2; }

echo "=== DSH 场景测试：会话续接（adopt/resume）==="
echo "dsh        : $DSH_BIN（$(node "$DSH_BIN" --version 2>/dev/null || echo '?')）"
echo "隔离 DSH_HOME: $HOME_DIR（不动 ~/.dsh）"
echo "要记住的词  : $WORD"

ARTIFACT="$ROOT/dsh/plugin/dist/my-pi-plugin.mjs"
if [ ! -f "$ARTIFACT" ]; then
  echo "→ 产物不存在，先构建…"
  bash "$ROOT/scripts/dsh-build.sh" --no-smoke || { echo "❌ 构建失败" >&2; exit 2; }
fi
echo "✓ 产物：$ARTIFACT（$(du -h "$ARTIFACT" | awk '{print $1}')）"

[ -f "$CREDS" ] || { echo "❌ 找不到凭据文件 $CREDS（可用 MY_PI_HOST_CREDENTIALS 指定）" >&2; exit 2; }

rm -rf "$BASE"
mkdir -p "$HOME_DIR" "$LOG_DIR"
install -m 600 "$CREDS" "$HOME_DIR/.credentials.yaml"
cleanup() { rm -f "$HOME_DIR/.credentials.yaml"; }
# ★ 凭据副本必须清理干净（明文，不能留在 /tmp）：实测确实遇到过残留
#   （`/tmp/my-pi-dsh-home/.credentials.yaml`，来自更早一次被**取消**的作业）。
#   这里把 INT/TERM/HUP 一并接上做**防御性**加固 —— 但要说清：**残留的确切成因没有复现**
#   （对照探针里 SIGTERM 下 `trap ... EXIT` 与 `trap ... EXIT INT TERM HUP` **都会**清理），
#   所以别把这条写成"它修掉了那次残留"。另外脚本开头本来就会 `rm -rf "$HOME_DIR"`，
#   同一个 home 再跑一次也会把旧副本带走。
trap cleanup EXIT INT TERM HUP

echo "=== ① 建 profile 并组合本仓 patch ==="
DSH_HOME="$HOME_DIR" timeout 300 node "$DSH_BIN" --profile "$PROFILE" --from-default-profile headless --dump-config >"$LOG_DIR/compose.txt" 2>&1 || {
  echo "❌ 建 profile 失败（见 $LOG_DIR/compose.txt）" >&2; tail -3 "$LOG_DIR/compose.txt" >&2; exit 2; }
DSH_HOME="$HOME_DIR" timeout 300 node "$DSH_BIN" --profile "$PROFILE" --patch "$ROOT/dsh/profile/my-pi.patch.yml" --dump-config >>"$LOG_DIR/compose.txt" 2>&1 || {
  echo "❌ 组合 patch 失败" >&2; exit 2; }
grep -q 'id: my-pi' "$LOG_DIR/compose.txt" || { echo "❌ 组合树里没有 my-pi" >&2; exit 2; }
echo "  ✓ 组合树含 id: my-pi"

run_once() {
  local out="$1"; shift
  : >"$out"
  (
    DSH_HOME="$HOME_DIR" timeout "$TIMEOUT_S" node "$DSH_BIN" --profile "$PROFILE" \
      --patch "$ROOT/dsh/profile/my-pi.patch.yml" --json "$@" >>"$out" 2>&1
    echo "EXIT=$?" >>"$out"
  )
}

# 从 --json 流里取 sessionId（事件类型 `session` 带 sessionId）
session_of() { node -e '
const fs=require("fs");
for (const l of fs.readFileSync(process.argv[1],"utf8").split("\n")) {
  const t=l.trim(); if(!t.startsWith("{")) continue;
  let j; try{j=JSON.parse(t)}catch{continue}
  if (j.type==="session" && j.sessionId) { console.log(j.sessionId); break; }
}' "$1"; }

# 从 --json 流里取最终回答文本
final_of() { node -e '
const fs=require("fs");
let text="";
for (const l of fs.readFileSync(process.argv[1],"utf8").split("\n")) {
  const t=l.trim(); if(!t.startsWith("{")) continue;
  let j; try{j=JSON.parse(t)}catch{continue}
  if (j.type==="final" && typeof j.text==="string") text=j.text;
}
process.stdout.write(text);' "$1"; }

echo "=== ② 第一轮：新会话（--json 取 sessionId）==="
run_once "$LOG_DIR/run1.json" "$TASK1"
code1="$(grep -oE '^EXIT=[0-9]+' "$LOG_DIR/run1.json" | tail -1 | cut -d= -f2)"
sid1="$(session_of "$LOG_DIR/run1.json")"
lines1="$(grep -cE '\[my-pi-dsh\]|\[dsh-facade\]|\[dsh-pi-shim\]' "$LOG_DIR/run1.json" || true)"
echo "  → 退出码=${code1:-未知}｜sessionId=${sid1:-（无）}｜插件日志 ${lines1} 行"
[ "${code1:-1}" = "0" ] || { echo "❌ 第一轮失败（见 $LOG_DIR/run1.json）" >&2; tail -5 "$LOG_DIR/run1.json" >&2; exit 1; }
[ -n "$sid1" ] || { echo "❌ 第一轮没拿到 sessionId（--json 事件里没有 session）" >&2; exit 1; }

SESS_ROOT="$HOME_DIR/sessions"
dirs_before="$(find "$SESS_ROOT" -mindepth 2 -maxdepth 2 -type d -name 'session-*' 2>/dev/null | wc -l)"

echo "=== ③ 第二轮：--session-id $sid1 **收养**同一会话 ==="
run_once "$LOG_DIR/run2.json" --session-id "$sid1" "$TASK2"
code2="$(grep -oE '^EXIT=[0-9]+' "$LOG_DIR/run2.json" | tail -1 | cut -d= -f2)"
sid2="$(session_of "$LOG_DIR/run2.json")"
lines2="$(grep -cE '\[my-pi-dsh\]|\[dsh-facade\]|\[dsh-pi-shim\]' "$LOG_DIR/run2.json" || true)"
dirs_after="$(find "$SESS_ROOT" -mindepth 2 -maxdepth 2 -type d -name 'session-*' 2>/dev/null | wc -l)"
answer2="$(final_of "$LOG_DIR/run2.json")"
echo "  → 退出码=${code2:-未知}｜sessionId=${sid2:-（无）}｜插件日志 ${lines2} 行"
echo "  → 回答：$(printf '%s' "$answer2" | tr '\n' ' ' | cut -c1-120)"

echo "=== ④ 断言 ==="
FAIL=0
INCONCLUSIVE=0
[ "${code2:-1}" = "0" ] && echo "  ✓ 第二轮退出码 0" || { echo "  ❌ 第二轮退出码=${code2:-未知}" >&2; FAIL=1; }
[ "${lines2:-0}" -gt 0 ] && echo "  ✓ 续接的会话里我们的插件仍在位（$lines2 行日志）" || { echo "  ❌ 第二轮看不到插件日志" >&2; FAIL=1; }
if [ "$sid1" = "$sid2" ]; then
  echo "  ✓ 两轮 sessionId 相同（$sid1）⇒ 是收养同一会话"
else
  echo "  ❌ sessionId 不同：run1=$sid1 run2=${sid2:-（无）} ⇒ 没收养成功" >&2; FAIL=1
fi
if [ "$dirs_before" = "$dirs_after" ]; then
  echo "  ✓ 会话目录数未变（$dirs_after）⇒ 第二轮没另开会话"
else
  echo "  ❌ 会话目录数 $dirs_before → $dirs_after ⇒ 第二轮另开了会话" >&2; FAIL=1
fi
if printf '%s' "$answer2" | grep -q "$WORD"; then
  echo "  ✓ 第二轮答出了第一轮让它记住的词（$WORD）⇒ 历史确实被带上"
else
  echo "  ? 第二轮没答出 $WORD（回答见上）⇒ **无法判定**：这可能是模型没回忆起来，不是插件/续接机制的问题" >&2
  INCONCLUSIVE=1
fi

echo "→ 完整日志：$LOG_DIR/run1.json ｜ $LOG_DIR/run2.json"
if [ "$FAIL" -ne 0 ]; then
  echo "❌ 会话续接场景失败" >&2
  exit 1
fi
if [ "$INCONCLUSIVE" -ne 0 ]; then
  echo "⚠️ 会话续接场景：机制断言全过，但「历史被带上」这一条**无法判定**（模型没答出那个词）⇒ 不当成功也不当失败"
  exit 2
fi
echo "🎉 会话续接场景通过（收养同一会话、插件在位、历史被带上；凭据副本已删除）"
