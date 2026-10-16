#!/usr/bin/env bash
# dsh-scenario-isolation.sh — **P6③ 场景测试（DSH 版）之一：两实例隔离**
#
# ## 为什么需要它
#
# 换底座后**旧的绿色不能继承**：pi 侧有一套真 pty + supervisor + 真 pi 的场景测试
# （`scripts/test-scenario-*.mjs`，含"两实例隔离/模式切换/会话切换"），它们断言的是 **pi** 的
# 进程与状态语义。DSH 的 Host/Session 语义不同（会话是存储模型、没有 supervisor 重启链），
# 所以这些场景必须**重写**而不是照搬（见 `docs/design/DSH-MIGRATION-PLAN.md` 的 P6③）。
#
# 本脚本是重写的第一个场景，问的是一个**仍然成立的真问题**：
#   两个 DSH 实例同时跑，各自独立的 `DSH_HOME`（各自的 profile / 会话库），但**共用同一个仓库**
#   （`PI_MEMORY_DIR` 指向仓库的 `portable/memory`）⇒ 会不会互相串？具体断言：
#     ① 两个实例都能正常跑完（退出码 0、各自都能看到我们插件的日志）；
#     ② 会话互不串（各自的 home 里有自己的会话，id 不同）；
#     ③ 用量记账不串（各自的 `PI_USAGE_DIAG_FILE` 各写各的；仓库默认那份**不被写**）；
#     ④ 不产生脏目录（打包产物的根目录解析被钉住；曾经踩过 `dsh/portable/`）。
#
# ## 为什么默认不发车（与 dsh-host-smoke.sh 同一纪律）
#
# 会用**你的凭据**调真实模型（两次）、占内存、耗时 ⇒ 只有显式 `MY_PI_HOST_SMOKE=1` 才跑；
# 全程用**隔离的 DSH_HOME**（不动 `~/.dsh`，也不打扰正在跑的 GUI），凭据只临时拷一份 600、退出即删。
#
# 用法：
#   MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-isolation.sh
#   MY_PI_HOST_SMOKE=1 MY_PI_SCEN_PROMPT_A="回答：甲" MY_PI_SCEN_PROMPT_B="回答：乙" bash scripts/dsh-scenario-isolation.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

if [ "${MY_PI_HOST_SMOKE:-}" != "1" ]; then
  echo "· SKIP：两实例隔离场景默认不发车（会用凭据/额度/内存，跑两次）"
  echo "  要跑请显式：MY_PI_HOST_SMOKE=1 bash scripts/dsh-scenario-isolation.sh"
  exit 0
fi

DSH_BIN="${DSH_BIN:-$(command -v dsh 2>/dev/null || true)}"
if [ -z "$DSH_BIN" ]; then
  for cand in "$HOME"/.npm/_npx/*/node_modules/.bin/dsh; do
    [ -x "$cand" ] && DSH_BIN="$cand" && break
  done
fi
[ -n "$DSH_BIN" ] && [ -e "$DSH_BIN" ] || { echo "❌ 找不到 dsh 可执行文件（可设 DSH_BIN）" >&2; exit 2; }

BASE="${MY_PI_SCEN_BASE:-/tmp/my-pi-dsh-scenario}"
HOME_A="$BASE/home-a"
HOME_B="$BASE/home-b"
LOG_DIR="${MY_PI_SCEN_LOG_DIR:-$BASE/logs}"
PROMPT_A="${MY_PI_SCEN_PROMPT_A:-只回答两个字：甲}"
PROMPT_B="${MY_PI_SCEN_PROMPT_B:-只回答两个字：乙}"
CREDS="${MY_PI_HOST_CREDENTIALS:-$HOME/.dsh/.credentials.yaml}"
TIMEOUT_S="${MY_PI_SCEN_TIMEOUT:-600}"
DIAG_A="$BASE/usage-a.jsonl"
DIAG_B="$BASE/usage-b.jsonl"
REPO_DIAG="$ROOT/portable/memory/context/.usage-diag.jsonl"

mkdir -p "$LOG_DIR" || { echo "❌ 无法创建日志目录 $LOG_DIR" >&2; exit 2; }

echo "=== DSH 场景测试：两实例隔离 ==="
echo "dsh          : $DSH_BIN（$(node "$DSH_BIN" --version 2>/dev/null || echo '?')）"
echo "隔离 home A/B: $HOME_A ｜ $HOME_B（不动 ~/.dsh）"
echo "共用仓库状态  : $ROOT/portable（这是本场景真正要问的点）"

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

rm -rf "$BASE"
mkdir -p "$HOME_A" "$HOME_B" "$LOG_DIR"
install -m 600 "$CREDS" "$HOME_A/.credentials.yaml"
install -m 600 "$CREDS" "$HOME_B/.credentials.yaml"
cleanup() { rm -f "$HOME_A/.credentials.yaml" "$HOME_B/.credentials.yaml"; }
trap cleanup EXIT

# 仓库默认用量台账的行数（场景跑完必须**没变**：两个实例都写自己的文件）
REPO_DIAG_BEFORE="$(wc -l < "$REPO_DIAG" 2>/dev/null || echo 0)"

echo "=== ① 两个隔离 home 各建 profile 并组合本仓 patch ==="
for side in A B; do
  home_var="HOME_$side"
  home="${!home_var}"
  if ! DSH_HOME="$home" timeout 300 node "$DSH_BIN" --profile "scen-$side" --from-default-profile headless --dump-config >"$LOG_DIR/compose-$side.txt" 2>&1; then
    echo "❌ 建 profile 失败（$side，见 $LOG_DIR/compose-$side.txt）" >&2
    tail -3 "$LOG_DIR/compose-$side.txt" >&2
    exit 2
  fi
  if ! DSH_HOME="$home" timeout 300 node "$DSH_BIN" --profile "scen-$side" --patch "$ROOT/dsh/profile/my-pi.patch.yml" --dump-config >>"$LOG_DIR/compose-$side.txt" 2>&1; then
    echo "❌ 组合 patch 失败（$side）" >&2
    exit 2
  fi
  grep -q 'id: my-pi' "$LOG_DIR/compose-$side.txt" || { echo "❌ 组合树里没有 my-pi（$side）" >&2; exit 2; }
  echo "  ✓ $side 组合树含 id: my-pi"
done

echo "=== ② 两个实例**并发**跑（各写自己的用量台账）==="
run_one() {
  local side="$1" home="$2" prompt="$3" diag="$4"
  local out="$LOG_DIR/run-$side.log"
  : >"$out"
  (
    DSH_HOME="$home" PI_USAGE_DIAG_FILE="$diag" timeout "$TIMEOUT_S" \
      node "$DSH_BIN" --profile "scen-$side" --patch "$ROOT/dsh/profile/my-pi.patch.yml" "$prompt" >>"$out" 2>&1
    echo "EXIT=$?" >>"$out"
  )
}
run_one A "$HOME_A" "$PROMPT_A" "$DIAG_A" &
PID_A=$!
run_one B "$HOME_B" "$PROMPT_B" "$DIAG_B" &
PID_B=$!
wait "$PID_A" 2>/dev/null
wait "$PID_B" 2>/dev/null

echo "=== ③ 断言 ==="
FAIL=0
for side in A B; do
  out="$LOG_DIR/run-$side.log"
  code="$(grep -oE '^EXIT=[0-9]+' "$out" | tail -1 | cut -d= -f2)"
  lines="$(grep -cE '\[my-pi-dsh\]|\[dsh-facade\]|\[dsh-pi-shim\]' "$out" || true)"
  if [ "${code:-1}" = "0" ] && [ "${lines:-0}" -gt 0 ]; then
    echo "  ✓ $side：退出码 0、插件日志 $lines 行"
  else
    echo "  ❌ $side：退出码=${code:-未知}、插件日志=${lines:-0} 行（见 $out）" >&2
    FAIL=1
  fi
done

# ② 会话互不串：各自的 home 下都有自己的会话，且 id 不同
sess_a="$(find "$HOME_A/sessions" -mindepth 2 -maxdepth 2 -type d -name 'session-*' 2>/dev/null | sed 's#.*/##' | sort | tr '\n' ',')"
sess_b="$(find "$HOME_B/sessions" -mindepth 2 -maxdepth 2 -type d -name 'session-*' 2>/dev/null | sed 's#.*/##' | sort | tr '\n' ',')"
if [ -n "$sess_a" ] && [ -n "$sess_b" ]; then
  echo "  ✓ 会话：A=[$sess_a] B=[$sess_b]"
  if [ "$sess_a" = "$sess_b" ]; then
    echo "  ❌ 两个实例的会话 id 完全相同 ⇒ 会话库串了" >&2
    FAIL=1
  else
    echo "  ✓ 会话 id 不同（各自的会话库独立）"
  fi
else
  echo "  ❌ 会话库缺失：A=[$sess_a] B=[$sess_b]" >&2
  FAIL=1
fi

# ③ 用量记账不串：各自的文件各有记录；仓库默认那份没被写
for side in A B; do
  diag="$BASE/usage-$([ "$side" = A ] && echo a || echo b).jsonl"
  if [ -s "$diag" ] && grep -q '"input"' "$diag"; then
    echo "  ✓ 用量台账 $side：$(grep -c '"input"' "$diag") 条真实记录（未写入仓库默认台账）"
  else
    echo "  ❌ 用量台账 $side 缺失/无记录：$diag" >&2
    FAIL=1
  fi
done
REPO_DIAG_AFTER="$(wc -l < "$REPO_DIAG" 2>/dev/null || echo 0)"
if [ "$REPO_DIAG_BEFORE" = "$REPO_DIAG_AFTER" ]; then
  echo "  ✓ 仓库默认用量台账行数未变（$REPO_DIAG_AFTER）⇒ 两个实例都只写自己的"
else
  echo "  ❌ 仓库默认用量台账被写：$REPO_DIAG_BEFORE → $REPO_DIAG_AFTER" >&2
  FAIL=1
fi

# ④ 不产生脏目录
if [ -e "$ROOT/dsh/portable" ]; then
  echo "  ❌ 产生了脏目录 dsh/portable（根目录解析没钉住）" >&2
  FAIL=1
else
  echo "  ✓ 未产生脏目录 dsh/portable"
fi

echo "→ 完整日志：$LOG_DIR/run-A.log ｜ $LOG_DIR/run-B.log"
if [ "$FAIL" -ne 0 ]; then
  echo "❌ 两实例隔离场景失败" >&2
  exit 1
fi
echo "🎉 两实例隔离场景通过（两实例各自跑完、会话/用量互不串、无脏目录；凭据副本已删除）"
