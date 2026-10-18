#!/usr/bin/env bash
# 自动化组合断言（不需要起宿主）：叠加 schedule.patch.yml 后，组合里应出现
# time-context / schedule / ui-schedule 三行，且 schedule 的工具插件在其中。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
DSH_BIN="$REPO/runtime/$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/aarch64/arm64/; s/x86_64/x64/')/ext/dsh/node_modules/.bin/dsh"
export DSH_HOME="${MYPI_HOME:-$ROOT/.run/home-schedule}"

# 用临时 home + 从 web 模板初始化一个 mypi profile，避免依赖正在跑的实例。
if [ ! -d "$DSH_HOME/profiles/mypi" ]; then
  timeout 120 "$DSH_BIN" --profile mypi --from-default-profile web --dump-config >/dev/null 2>&1
fi
dump="$(timeout 90 "$DSH_BIN" --profile mypi --patch "$ROOT/profile/mypi.patch.yml" --patch "$ROOT/profile/schedule.patch.yml" --dump-config 2>/dev/null)"
rows=$(printf '%s' "$dump" | grep -cE "id: (time-context|schedule|ui-schedule)$")
has_schedule=$(printf '%s' "$dump" | grep -c "dsh-schedule")
has_time=$(printf '%s' "$dump" | grep -c "dsh-time-context")
ok=$([ "$rows" -ge 3 ] && [ "$has_schedule" -ge 1 ] && [ "$has_time" -ge 1 ] && echo true || echo false)
printf '{"ok":%s,"rows":%s,"schedule":%s,"timeContext":%s}\n' "$ok" "$rows" "$has_schedule" "$has_time"
[ "$ok" = "true" ]
