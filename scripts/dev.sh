#!/bin/bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 开发模式：直接运行 TypeScript 源码，不构建 custom/
cd "$ROOT"

# pi 只识别 PI_CODING_AGENT_DIR；PI_MEMORY_DIR 由 custom/core/config.ts 解析
export PI_CODING_AGENT_DIR="$ROOT/portable/agent"
export PI_MEMORY_DIR="$ROOT/portable/memory"

CLI_SRC="$ROOT/vendor/pi/packages/coding-agent/src/cli.ts"
[ -f "$CLI_SRC" ] || { echo "❌ 未找到 $CLI_SRC，请先运行：bash scripts/build.sh" >&2; exit 1; }

# 模式 = 启动档位：与 supervisor 走同一套解析（lib-mode.sh），否则 dev 下静默缺人设。
# 模式按会话记录（modes-sessions.json）；这里同样只认 `--session <绝对路径>`。
# shellcheck source=scripts/lib-mode.sh
. "$ROOT/scripts/lib-mode.sh"
mode_resolve "$ROOT/portable/agent" "$(mode_session_arg "$@")"
export PI_MEMORY_NAMESPACE="$MODE_NS"
export PI_SESSION_MODE="$MODE_NAME"
MODE_ARGS=()
if [ -n "$MODE_APPEND_ABS" ]; then
    MODE_ARGS=(--append-system-prompt "$MODE_APPEND_ABS")
fi
if [ "$MODE_NAME" != "full" ]; then
    echo "[dev] 模式: $MODE_NAME${MODE_APPEND_ABS:+（已注入人设）}" >&2
fi

# tsx 真值来源是 custom/package.json（npm 提升到根 node_modules）。
# 不要再依赖 vendor/pi 那份：上游 v0.99.0 起已删除该依赖，本地副本只是升级残留，
# fresh `npm ci` 后会消失（见 docs/operations/UPSTREAM-UPDATE.md 常见坑）。
TSX="$ROOT/node_modules/.bin/tsx"
if [ -x "$TSX" ]; then
    exec "$TSX" "$CLI_SRC" --extension "$ROOT/custom/bootstrap.ts" --no-context-files ${MODE_ARGS[@]+"${MODE_ARGS[@]}"} "$@"
fi
# 兜底：vendor 残留（旧布局）→ npx（需网络）
if [ -x "$ROOT/vendor/pi/node_modules/.bin/tsx" ]; then
    echo "⚠ 未找到根 node_modules/.bin/tsx，回退 vendor 残留副本（运行 npm install 修正）" >&2
    exec "$ROOT/vendor/pi/node_modules/.bin/tsx" "$CLI_SRC" --extension "$ROOT/custom/bootstrap.ts" --no-context-files ${MODE_ARGS[@]+"${MODE_ARGS[@]}"} "$@"
fi
echo "⚠ 未找到 tsx（先运行 npm install），回退 npx tsx（需网络）" >&2
exec npx --yes tsx "$CLI_SRC" --extension "$ROOT/custom/bootstrap.ts" --no-context-files ${MODE_ARGS[@]+"${MODE_ARGS[@]}"} "$@"
