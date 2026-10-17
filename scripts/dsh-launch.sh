#!/usr/bin/env bash
# dsh-launch.sh — 用**一条指令**启动 my-pi（DSH 基座）：web / headless / acp
#
# 设计目标（照主分支的便携化约定）：
#   ① **仓内优先**：宿主取 `runtime/<平台>/ext/dsh`（scripts/dsh-runtime.sh 装的），
#      没有才退回系统 dsh，最后才是 npx 缓存（并对"非便携"**明确警告**，不静默）；
#   ② **状态也在仓内**：`DSH_HOME` 默认 `<repo>/portable/dsh`（gitignored），不碰 `~/.dsh`
#      （那是正在跑的 GUI 的 home —— 我们绝不去动它）；
#   ③ **产物与宿主自洽**：缺产物就现建；仓库根的 `@deepseek-ai/*` 等价物始终指向**当前解析到的宿主**
#      （产物的宿主包是 external，靠它解析）；
#   ④ 凭据：默认从 `$MY_PI_DSH_CREDENTIALS` 或 `~/.dsh/.credentials.yaml` **拷一份 600 到仓内 home**
#      （一次性，之后就用仓内那份；目录已 gitignore，不会被提交）。
#
# 用法：
#   bash scripts/dsh-launch.sh web [--port 3099] [--no-open]   # 浏览器 UI
#   bash scripts/dsh-launch.sh headless "任务…"                 # 一次性执行并打印结果
#   bash scripts/dsh-launch.sh acp [args…]                      # ACP（编辑器/客户端用）
#
# 环境变量：
#   MY_PI_DSH_HOME=…         覆盖仓内 home（默认 <repo>/portable/dsh）
#   MY_PI_DSH_CREDENTIALS=…  凭据来源（默认 ~/.dsh/.credentials.yaml）
#   MY_PI_DSH_PORT=…         web 默认端口（默认 3099；3080 是正在跑的 GUI，刻意避开）
#   MY_PI_DSH_HOST=…         强制指定 dsh 可执行文件（排障用）
#   MY_PI_DSH_EXTRA_PATCH=…  追加覆盖层（`:` 分隔多个）；例：打开可选的"具名 agent 工具"
#   MY_PI_DSH_TRACE_EVENTS=1 打开事件 trace + 末尾一行注册汇总
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
# shellcheck source=scripts/lib-portable.sh
. "$ROOT/scripts/lib-portable.sh"
pi_portable_env >/dev/null 2>&1 || true

die() { echo "❌ $*" >&2; exit 2; }

# ── ① 解析宿主（仓内优先；npx 兜底要吭声）──────────────────────────────────
# ★ 这段必须在 MODE 解析**之前**：`--print-host` 要能用它，且不能触发任何副作用
#   （不建 home、不拷凭据、不建 profile —— 便携性守门会反复调它）。
resolve_host() {
  if [ -n "${MY_PI_DSH_HOST:-}" ]; then printf '%s' "$MY_PI_DSH_HOST"; return 0; fi
  local vendored
  vendored="$(pi_runtime_root)/ext/dsh/node_modules/.bin/dsh"
  [ -x "$vendored" ] && { printf '%s' "$vendored"; return 0; }
  local system
  system="$(command -v dsh 2>/dev/null || true)"
  [ -n "$system" ] && { printf '%s' "$system"; return 0; }
  local cand
  for cand in "$HOME"/.npm/_npx/*/node_modules/.bin/dsh; do
    [ -x "$cand" ] && { printf '%s' "$cand"; return 0; }
  done
  return 1
}
DSH_BIN="$(resolve_host || true)"
[ -n "$DSH_BIN" ] || die "找不到 dsh。先跑：bash scripts/dsh-runtime.sh install --from-npx"
case "$DSH_BIN" in
  "$(pi_runtime_root)"/ext/dsh/*) HOST_KIND="仓内宿主（完全便携）"; HOST_TAG=vendored ;;
  *_npx/*)                        HOST_KIND="⚠️ npx 缓存（非便携：建议 bash scripts/dsh-runtime.sh install）"; HOST_TAG=npx ;;
  *)                              HOST_KIND="系统/自定义"; HOST_TAG=system ;;
esac
# `--print-host`：只报告解析结果就退出（给便携性守门做**行为**判定；零副作用）
if [ "${1:-}" = "--print-host" ]; then printf '%s\t%s\n' "$HOST_TAG" "$DSH_BIN"; exit 0; fi

MODE="${1:-web}"
shift || true

# ── ② 仓内 home（绝不碰 ~/.dsh）──────────────────────────────────────────────
HOME_DIR="${MY_PI_DSH_HOME:-$ROOT/portable/dsh}"
mkdir -p "$HOME_DIR" || die "无法创建 $HOME_DIR"
export DSH_HOME="$HOME_DIR"

# ── ③ 产物 + 宿主等价物（产物的 @deepseek-ai/* 是 external，靠仓库根别名解析）──
ARTIFACT="$ROOT/dsh/plugin/dist/my-pi-plugin.mjs"
HOST_MODULES="$(dirname "$(dirname "$DSH_BIN")")"          # <host>/node_modules
if [ ! -f "$ARTIFACT" ]; then
  echo "→ 产物不存在，先构建…"
  bash "$ROOT/scripts/dsh-build.sh" --no-smoke >/dev/null 2>&1 || die "构建失败（bash scripts/dsh-build.sh 看详情）"
fi
# 别名指向"当前宿主"（换宿主后必须重指；逐包建，别整体软链 —— 见 CODING-TRAPS #14）
bash "$ROOT/scripts/dsh-build.sh" --link-host "$HOST_MODULES" >/dev/null 2>&1 || true

# ── ④ 凭据（600 拷进仓内 home；已存在就不动）────────────────────────────────
CRED_DST="$HOME_DIR/.credentials.yaml"
if [ ! -f "$CRED_DST" ]; then
  CRED_SRC="${MY_PI_DSH_CREDENTIALS:-$HOME/.dsh/.credentials.yaml}"
  if [ -f "$CRED_SRC" ]; then
    install -m 600 "$CRED_SRC" "$CRED_DST" && echo "✓ 凭据已拷入 ${CRED_DST}（600，目录已 gitignore）"
  else
    echo "⚠️ 未找到凭据（$CRED_SRC）⇒ 首次请求会失败。可用 MY_PI_DSH_CREDENTIALS=… 指定。"
  fi
fi

# ── ⑤ profile：每种模式一个（模板不同），建过一次就复用 ─────────────────────
PATCH="$ROOT/dsh/profile/my-pi.patch.yml"
# 追加覆盖层（部署层加配置的正当入口；例如 /tmp/na.patch.yml 打开具名 agent 工具）
EXTRA_PATCH_ARGS=()
if [ -n "${MY_PI_DSH_EXTRA_PATCH:-}" ]; then
  IFS=':' read -r -a _extra <<< "$MY_PI_DSH_EXTRA_PATCH"
  for _p in "${_extra[@]}"; do
    [ -n "$_p" ] && EXTRA_PATCH_ARGS+=(--patch "$_p")
  done
fi
ensure_profile() { # $1=profile 名  $2=模板名
  local name="$1" template="$2"
  if [ ! -d "$HOME_DIR/profiles/$name" ]; then
    echo "→ 建 profile '$name'（模板 $template）…"
    "$DSH_BIN" --profile "$name" --from-default-profile "$template" --dump-config >/dev/null 2>&1 \
      || die "建 profile 失败：$name/$template"
  fi
}

# 提示：端口默认避开 3080
has_flag() { local want="$1"; shift; local a; for a in "$@"; do [ "$a" = "$want" ] && return 0; done; return 1; }

echo "=== my-pi on DSH ==="
echo "  宿主：$HOST_KIND  ($DSH_BIN)"
echo "  home：$DSH_HOME"
echo "  产物：$(du -h "$ARTIFACT" 2>/dev/null | cut -f1)"
[ -n "${MY_PI_DSH_TRACE_EVENTS:-}" ] || echo "  想看注册汇总：加 MY_PI_DSH_TRACE_EVENTS=1"

case "$MODE" in
  web)
    PORT_DEFAULT="${MY_PI_DSH_PORT:-3099}"
    ensure_profile mypi-web web
    ARGS=(--profile mypi-web --patch "$PATCH" "${EXTRA_PATCH_ARGS[@]}")
    has_flag --port "$@" || ARGS+=(--port "$PORT_DEFAULT")
    has_flag --no-open "$@" || ARGS+=(--no-open)
    echo "  → http://127.0.0.1:${PORT_DEFAULT}/ （浏览器打开这个地址）"
    exec "$DSH_BIN" "${ARGS[@]}" "$@"
    ;;
  headless)
    ensure_profile mypi-headless headless
    exec "$DSH_BIN" --profile mypi-headless --patch "$PATCH" "${EXTRA_PATCH_ARGS[@]}" "$@"
    ;;
  acp)
    ensure_profile mypi-acp acp
    exec "$DSH_BIN" --profile mypi-acp --patch "$PATCH" "${EXTRA_PATCH_ARGS[@]}" "$@"
    ;;
  *) die "未知模式：$MODE（可用 web | headless | acp）" ;;
esac
