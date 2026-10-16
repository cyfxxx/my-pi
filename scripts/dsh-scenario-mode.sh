#!/usr/bin/env bash
# dsh-scenario-mode.sh — **P6③ 场景测试（DSH 版）之三：模式（启动期）生效**
#
# ## 这个场景在问什么
#
# pi 侧的"模式切换"场景断言的是 pi 的**自动重启链**（`/mode` 写状态 → 请求 supervisor 重启 →
# 续接当前会话 → 新模式下重新注册工具面）。DSH 没有 supervisor 重启链（`admin_restart` 在适配层
# 明确报 unsupported），所以照搬必然失败；但**模式本身的意义**在 DSH 上仍然成立，且可测：
#
#   模式 = 启动期决定"注册哪些特性" ⇒ 同一份插件，用不同模式启动，**注册面应当不同**。
#
# 这正是本场景问的三件事：
#   ① 默认（full）模式：注册面是"大"的那一套（工具 ≥ 40、命令 ≥ 5，含 `mypi-plan`）；
#   ② `PI_AGENT_MODE=minimal`（代码内锁定模式，`features: []`）：注册面**显著收缩**
#      （只剩 `mode` 自己那一条命令 —— 它必须始终注册，否则极简模式下切不回来）；
#   ③ 两次运行都退出码 0 且都能看到我们插件的日志（不是"少注册=崩了"）。
#
# ✗ 明确**不**验"运行中切换 + 自动重启续接"：DSH 上没有那条链路（要靠客户端/Host 层重做），
#   本场景只验证"启动期模式选择真的生效"，不假装验证"热切换"。
#
# ## 隔离（不动仓库状态、也不动正在跑的 GUI）
#
# 模式状态读的是 `PI_CODING_AGENT_DIR` 下的 `modes.json`（`features/mode/logic.ts:modesFilePath`），
# 而插件入口**只在未设置时**才把它钉到仓库 ⇒ 本场景显式把它（连同 `PI_MEMORY_DIR`）指到临时目录，
# 因此不读也不写仓库里的 `portable/`。凭据仍只临时拷一份 600、退出即删。
#
# 用法：
#   MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-mode.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

if [ "${MY_PI_HOST_SMOKE:-}" != "1" ]; then
  echo "· SKIP：模式场景默认不发车（会用凭据/额度/内存，跑两次）"
  echo "  要跑请显式：MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-mode.sh"
  exit 0
fi

DSH_BIN="${DSH_BIN:-$(command -v dsh 2>/dev/null || true)}"
if [ -z "$DSH_BIN" ]; then
  for cand in "$HOME"/.npm/_npx/*/node_modules/.bin/dsh; do
    [ -x "$cand" ] && DSH_BIN="$cand" && break
  done
fi
[ -n "$DSH_BIN" ] && [ -e "$DSH_BIN" ] || { echo "❌ 找不到 dsh 可执行文件（可设 DSH_BIN）" >&2; exit 2; }

BASE="${MY_PI_SCEN_BASE:-/tmp/my-pi-dsh-mode}"
HOME_DIR="$BASE/home"
AGENT_DIR="$BASE/agent"     # 隔离的模式状态（不碰仓库 portable/agent）
MEM_DIR="$BASE/memory"
LOG_DIR="$BASE/logs"
PROFILE="${MY_PI_SCEN_PROFILE:-mypi-mode}"
CREDS="${MY_PI_HOST_CREDENTIALS:-$HOME/.dsh/.credentials.yaml}"
TIMEOUT_S="${MY_PI_SCEN_TIMEOUT:-600}"
MIN_TOOLS_MAX="${MY_PI_SCEN_MIN_TOOLS_MAX:-5}"

mkdir -p "$LOG_DIR" || { echo "❌ 无法创建日志目录 $LOG_DIR" >&2; exit 2; }

echo "=== DSH 场景测试：模式（启动期）生效 ==="
echo "dsh        : $DSH_BIN（$(node "$DSH_BIN" --version 2>/dev/null || echo '?')）"
echo "隔离 DSH_HOME / agentDir / memoryDir: $HOME_DIR ｜ $AGENT_DIR ｜ $MEM_DIR"

ARTIFACT="$ROOT/dsh/plugin/dist/my-pi-plugin.mjs"
if [ ! -f "$ARTIFACT" ]; then
  echo "→ 产物不存在，先构建…"
  bash "$ROOT/scripts/dsh-build.sh" --no-smoke || { echo "❌ 构建失败" >&2; exit 2; }
fi
echo "✓ 产物：$ARTIFACT（$(du -h "$ARTIFACT" | awk '{print $1}')）"
[ -f "$CREDS" ] || { echo "❌ 找不到凭据文件 $CREDS（可用 MY_PI_HOST_CREDENTIALS 指定）" >&2; exit 2; }

rm -rf "$BASE"
mkdir -p "$HOME_DIR" "$AGENT_DIR" "$MEM_DIR" "$LOG_DIR"
install -m 600 "$CREDS" "$HOME_DIR/.credentials.yaml"
cleanup() { rm -f "$HOME_DIR/.credentials.yaml"; }
# 凭据副本必须清理干净（明文）；INT/TERM/HUP 一并接上做防御性加固。
# 注：残留的确切成因未复现（对照探针里 SIGTERM 下两种写法都会清理），故不声称"它修掉了残留"。
trap cleanup EXIT INT TERM HUP

echo "=== ① 建 profile 并组合本仓 patch ==="
DSH_HOME="$HOME_DIR" timeout 300 node "$DSH_BIN" --profile "$PROFILE" --from-default-profile headless --dump-config >"$LOG_DIR/compose.txt" 2>&1 || {
  echo "❌ 建 profile 失败（见 $LOG_DIR/compose.txt）" >&2; tail -3 "$LOG_DIR/compose.txt" >&2; exit 2; }
DSH_HOME="$HOME_DIR" timeout 300 node "$DSH_BIN" --profile "$PROFILE" --patch "$ROOT/dsh/profile/my-pi.patch.yml" --dump-config >>"$LOG_DIR/compose.txt" 2>&1 || {
  echo "❌ 组合 patch 失败" >&2; exit 2; }
grep -q 'id: my-pi' "$LOG_DIR/compose.txt" || { echo "❌ 组合树里没有 my-pi" >&2; exit 2; }
echo "  ✓ 组合树含 id: my-pi"

run_mode() {
  # ★ 别写成一行 `local label="$1" mode="$2" out="…$label…"`：`local`/`declare` 的**所有词先展开**
  #   再赋值 ⇒ 同一行里引用刚声明的 `$label` 在 `set -u` 下直接报 `label: unbound variable`
  #   （实测踩到；拆成多条 `local` 即正常）。
  local label="$1"
  local mode="$2"
  local out="$LOG_DIR/run-$label.log"
  : >"$out"
  (
    env DSH_HOME="$HOME_DIR" \
        PI_CODING_AGENT_DIR="$AGENT_DIR" \
        PI_MEMORY_DIR="$MEM_DIR" \
        MY_PI_DSH_TRACE_EVENTS=1 \
        ${mode:+PI_AGENT_MODE="$mode"} \
        timeout "$TIMEOUT_S" node "$DSH_BIN" --profile "$PROFILE" \
          --patch "$ROOT/dsh/profile/my-pi.patch.yml" "回答两个字：收到" >>"$out" 2>&1
    echo "EXIT=$?" >>"$out"
  )
}

echo "=== ② 两次启动：默认（full）与 PI_AGENT_MODE=minimal ==="
run_mode full ""
run_mode minimal minimal

summary_of() { grep -oE 'trace 注册汇总：工具 [0-9]+ 个、命令 [0-9]+ 个（[^）]*）' "$1" | tail -1; }
tools_of() { summary_of "$1" | sed -nE 's/.*工具 ([0-9]+) 个.*/\1/p'; }
cmds_of() { summary_of "$1" | sed -nE 's/.*命令 ([0-9]+) 个.*/\1/p'; }

echo "=== ③ 断言 ==="
FAIL=0
for label in full minimal; do
  out="$LOG_DIR/run-$label.log"
  code="$(grep -oE '^EXIT=[0-9]+' "$out" | tail -1 | cut -d= -f2)"
  lines="$(grep -cE '\[my-pi-dsh\]|\[dsh-facade\]|\[dsh-pi-shim\]' "$out" || true)"
  sm="$(summary_of "$out")"
  echo "  · $label：退出码=${code:-未知}｜插件日志 ${lines} 行｜${sm:-（没拿到注册汇总）}"
  [ "${code:-1}" = "0" ] || { echo "  ❌ $label 退出码=${code:-未知}" >&2; FAIL=1; }
  [ "${lines:-0}" -gt 0 ] || { echo "  ❌ $label 看不到插件日志" >&2; FAIL=1; }
  [ -n "$sm" ] || { echo "  ❌ $label 没拿到注册汇总（需要 MY_PI_DSH_TRACE_EVENTS=1）" >&2; FAIL=1; }
done

full_tools="$(tools_of "$LOG_DIR/run-full.log")"
min_tools="$(tools_of "$LOG_DIR/run-minimal.log")"
full_cmds="$(cmds_of "$LOG_DIR/run-full.log")"
min_cmds="$(cmds_of "$LOG_DIR/run-minimal.log")"

if [ -n "$full_tools" ] && [ "${full_tools:-0}" -ge 40 ] && [ -n "$full_cmds" ] && [ "${full_cmds:-0}" -ge 5 ]; then
  echo "  ✓ 默认模式注册面是「大」的那套（工具 $full_tools、命令 $full_cmds）"
else
  echo "  ❌ 默认模式注册面异常（工具 ${full_tools:-?}、命令 ${full_cmds:-?}）" >&2; FAIL=1
fi
if [ -n "$min_tools" ] && [ "${min_tools:-999}" -le "$MIN_TOOLS_MAX" ]; then
  echo "  ✓ minimal 模式注册面显著收缩（工具 $min_tools ≤ $MIN_TOOLS_MAX）⇒ 启动期模式选择真的生效"
else
  echo "  ❌ minimal 模式注册面没收缩（工具 ${min_tools:-?}，期望 ≤ $MIN_TOOLS_MAX）" >&2; FAIL=1
fi
if summary_of "$LOG_DIR/run-minimal.log" | grep -q 'mode'; then
  echo "  ✓ minimal 模式下 mode 命令仍在（否则极简模式切不回来）"
else
  echo "  ❌ minimal 模式下连 mode 命令都没有" >&2; FAIL=1
fi
if summary_of "$LOG_DIR/run-full.log" | grep -q 'mypi-plan' && ! summary_of "$LOG_DIR/run-minimal.log" | grep -q 'mypi-plan'; then
  echo "  ✓ full 有换名后的 mypi-plan、minimal 没有（同一插件、两种模式，注册面确实不同）"
else
  echo "  ❌ 期望 full 含 mypi-plan 且 minimal 不含（实际见上面两行汇总）" >&2; FAIL=1
fi

echo "→ 完整日志：$LOG_DIR/run-full.log ｜ $LOG_DIR/run-minimal.log"
if [ "$FAIL" -ne 0 ]; then
  echo "❌ 模式场景失败" >&2
  exit 1
fi
echo "🎉 模式（启动期）场景通过（同插件两种模式注册面不同、都可跑完；凭据副本已删除）"
