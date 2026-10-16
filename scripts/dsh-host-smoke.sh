#!/usr/bin/env bash
# dsh-host-smoke.sh — **Host 级**端到端冒烟：真实 DSH profile 里加载 my-pi 插件，跑一个最小任务
#
# ## 为什么必须显式opt-in（默认不发车）
#
# 这条会：① 用**你的凭据**调用真实模型（消耗额度）；② 占用约 1–2.5 GB 内存；③ 需要几分钟。
# 所以默认**拒绝执行**，只有显式设了 `MY_PI_HOST_SMOKE=1` 才跑；并且全程用**隔离的 DSH_HOME**
# （绝不动 `~/.dsh`，也不打扰正在跑的 GUI）。
#
# ## 用法
#
#   MY_PI_HOST_SMOKE=1 bash scripts/dsh-host-smoke.sh          # 用默认 prompt
#   MY_PI_HOST_SMOKE=1 MY_PI_HOST_PROMPT="回答一个字：好" bash scripts/dsh-host-smoke.sh
#   MY_PI_HOST_SMOKE=1 MY_PI_HOST_CREDENTIALS=/path/to/.credentials.yaml bash scripts/dsh-host-smoke.sh
#
# ## 判定标准（每步都打印证据）
#
#   ① 插件产物存在（不在则先构建）；
#   ② 隔离 home 里从内置模板建出 `headless` profile，且我们的 patch 能组合进去（--dump-config 里出现 id: my-pi）；
#   ③ 真实启动：进程退出码为 0，并且 stderr/stdout 里能看到**我们插件自己打的日志**
#      （`[my-pi-dsh] systemPrompt.section：已注入 …` 或 `[dsh-facade] …`）⇒ 证明插件在真 Host 里被加载并执行；
#   ④ 报告峰值 RSS。
#   失败就 FAIL 并给出日志路径；**不**把"模型没回话"当作插件问题（那可能是额度/网络）。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

if [ "${MY_PI_HOST_SMOKE:-}" != "1" ]; then
  echo "· SKIP：Host 级冒烟默认不发车（会用凭据/额度/内存）"
  echo "  要跑请显式：MY_PI_HOST_SMOKE=1 bash scripts/dsh-host-smoke.sh"
  exit 0
fi

DSH_BIN="${DSH_BIN:-$(command -v dsh 2>/dev/null || true)}"
if [ -z "$DSH_BIN" ]; then
  for cand in "$HOME"/.npm/_npx/*/node_modules/.bin/dsh; do
    [ -x "$cand" ] && DSH_BIN="$cand" && break
  done
fi
[ -n "$DSH_BIN" ] && [ -e "$DSH_BIN" ] || { echo "❌ 找不到 dsh 可执行文件（可设 DSH_BIN）" >&2; exit 2; }

HOME_DIR="${MY_PI_HOST_HOME:-/tmp/my-pi-dsh-host-home}"
PROFILE="${MY_PI_HOST_PROFILE:-mypi-host}"
TEMPLATE="${MY_PI_HOST_TEMPLATE:-headless}"
PROMPT="${MY_PI_HOST_PROMPT:-回答两个字：收到}"
CREDS="${MY_PI_HOST_CREDENTIALS:-$HOME/.dsh/.credentials.yaml}"
LOG_DIR="${MY_PI_HOST_LOG_DIR:-/tmp}"
TIMEOUT_S="${MY_PI_HOST_TIMEOUT:-420}"

# LOG_DIR 允许自定义 ⇒ 必须自己建：否则 `>"$LOG_DIR/…"` 会以"文件不存在"失败，
# 而脚本把它报成"建 profile 失败"，指向错误的原因（实测踩过）。
mkdir -p "$LOG_DIR" || { echo "❌ 无法创建日志目录 $LOG_DIR" >&2; exit 2; }

echo "=== DSH Host 级冒烟 ==="
echo "dsh        : $DSH_BIN（$(node "$DSH_BIN" --version 2>/dev/null || echo '?')）"
echo "隔离 DSH_HOME: $HOME_DIR（不动 ~/.dsh）"
echo "profile    : $PROFILE（模板 $TEMPLATE）｜prompt: $PROMPT"

ARTIFACT="$ROOT/dsh/plugin/dist/my-pi-plugin.mjs"
if [ ! -f "$ARTIFACT" ]; then
  echo "→ 产物不存在，先构建…"
  bash "$ROOT/scripts/dsh-build.sh" --no-smoke || { echo "❌ 构建失败" >&2; exit 2; }
fi
echo "✓ 产物：$ARTIFACT（$(du -h "$ARTIFACT" | awk '{print $1}')）"

if [ ! -f "$CREDS" ]; then
  echo "❌ 找不到凭据文件 $CREDS（可用 MY_PI_HOST_CREDENTIALS 指定）" >&2
  exit 2
fi

rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR"
install -m 600 "$CREDS" "$HOME_DIR/.credentials.yaml"
# 退出时一定删掉凭据副本（不留明文在 /tmp）
cleanup() { rm -f "$HOME_DIR/.credentials.yaml"; }
# ★ 凭据副本必须清理干净（明文，不能留在 /tmp）：实测确实遇到过残留
#   （`/tmp/my-pi-dsh-home/.credentials.yaml`，来自更早一次被**取消**的作业）。
#   这里把 INT/TERM/HUP 一并接上做**防御性**加固 —— 但要说清：**残留的确切成因没有复现**
#   （对照探针里 SIGTERM 下 `trap ... EXIT` 与 `trap ... EXIT INT TERM HUP` **都会**清理），
#   所以别把这条写成"它修掉了那次残留"。另外脚本开头本来就会 `rm -rf "$HOME_DIR"`，
#   同一个 home 再跑一次也会把旧副本带走。
trap cleanup EXIT INT TERM HUP

echo "=== ② 建 profile + 组合我们的 patch ==="
DSH_HOME="$HOME_DIR" timeout 300 node "$DSH_BIN" --profile "$PROFILE" --from-default-profile "$TEMPLATE" --dump-config >"$LOG_DIR/dsh-host-base.txt" 2>&1 || {
  echo "❌ 从模板建 profile 失败（见 $LOG_DIR/dsh-host-base.txt）" >&2
  tail -3 "$LOG_DIR/dsh-host-base.txt" >&2
  exit 2
}
DSH_HOME="$HOME_DIR" timeout 300 node "$DSH_BIN" --profile "$PROFILE" --patch "$ROOT/dsh/profile/my-pi.patch.yml" --dump-config >"$LOG_DIR/dsh-host-composed.txt" 2>&1 || {
  echo "❌ 组合 patch 失败（见 $LOG_DIR/dsh-host-composed.txt）" >&2
  exit 2
}
grep -q 'id: my-pi' "$LOG_DIR/dsh-host-composed.txt" || { echo "❌ 组合树里没有 my-pi" >&2; exit 2; }
echo "✓ 组合树含 id: my-pi"

echo "=== ③ 真实启动（超时 ${TIMEOUT_S}s，隔离 home）==="
OUT="$LOG_DIR/dsh-host-run.log"
: >"$OUT"
(
  DSH_HOME="$HOME_DIR" timeout "$TIMEOUT_S" node "$DSH_BIN" --profile "$PROFILE" --patch "$ROOT/dsh/profile/my-pi.patch.yml" "$PROMPT" >>"$OUT" 2>&1
  echo "EXIT=$?" >>"$OUT"
) &
RUN_PID=$!
PEAK_KB=0
while kill -0 "$RUN_PID" 2>/dev/null; do
  cur="$(ps -o rss= -p "$RUN_PID" 2>/dev/null | tr -d ' ' || true)"
  [ -n "$cur" ] && [ "$cur" -gt "$PEAK_KB" ] 2>/dev/null && PEAK_KB="$cur"
  sleep 2
done
wait "$RUN_PID" 2>/dev/null

EXIT_CODE="$(grep -oE '^EXIT=[0-9]+' "$OUT" | tail -1 | cut -d= -f2)"
PLUGIN_LINES="$(grep -cE '\[my-pi-dsh\]|\[dsh-facade\]|\[dsh-pi-shim\]' "$OUT" || true)"
echo "→ 退出码=$EXIT_CODE｜峰值 RSS≈$((PEAK_KB / 1024)) MB｜插件日志行数=$PLUGIN_LINES"
echo "→ 完整日志：$OUT"
echo "--- 日志尾部 ---"
tail -12 "$OUT" | sed 's/^/    /'

if [ "${EXIT_CODE:-1}" != "0" ]; then
  echo "❌ Host 级冒烟失败（退出码 ${EXIT_CODE:-未知}）" >&2
  exit 1
fi
if [ "${PLUGIN_LINES:-0}" = "0" ]; then
  echo "❌ 进程成功了但**看不到我们插件的日志** ⇒ 插件没被加载（这才是不通过）" >&2
  exit 1
fi
echo "🎉 DSH Host 级冒烟通过（插件在真实 profile 里加载并执行，任务正常结束）"
