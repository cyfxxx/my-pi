#!/usr/bin/env bash
# 社区 TUI 集成断言（未安装则 SKIP）：
#   ① profile 存在；② 组合里有 TUI bundle 的行；③ 本仓插件被挂进去。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
DSH_BIN="$REPO/runtime/$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/aarch64/arm64/; s/x86_64/x64/')/ext/dsh/node_modules/.bin/dsh"
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/dsh-tui"

if [ ! -d "$PROFILE" ]; then
  echo '{"ok":true,"skipped":true,"reason":"未安装社区 TUI（先跑 assistant/scripts/setup-tui.sh）"}'
  exit 0
fi

dump="$(DSH_HOME="${DSH_HOME:-$HOME/.dsh}" timeout 60 "$DSH_BIN" --profile dsh-tui --dump-config 2>/dev/null)"
tui_rows="$(printf '%s' "$dump" | grep -c 'dsh-tui')"
ours="$(printf '%s' "$dump" | grep -c 'mypi-assistant')"
ok=$([ "$tui_rows" -ge 1 ] && [ "$ours" -ge 1 ] && echo true || echo false)
printf '{"ok":%s,"profile":"%s","tuiRows":%s,"mypiMounted":%s}\n' "$ok" "$PROFILE" "$tui_rows" "$ours"
[ "$ok" = "true" ]
