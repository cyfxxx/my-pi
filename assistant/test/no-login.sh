#!/usr/bin/env bash
# 断言：默认组合里账号登录三行被禁用、API-key 路线仍在；MYPI_LOGIN=1 时不带这个 patch。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
DSH_BIN="$REPO/runtime/$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/aarch64/arm64/; s/x86_64/x64/')/ext/dsh/node_modules/.bin/dsh"
export DSH_HOME="${MYPI_HOME:-$ROOT/.run/home-nologin}"
[ -d "$DSH_HOME/profiles/mypi" ] || timeout 120 "$DSH_BIN" --profile mypi --from-default-profile web --dump-config >/dev/null 2>&1

dump="$(timeout 90 "$DSH_BIN" --profile mypi --patch "$ROOT/profile/mypi.patch.yml" --patch "$ROOT/profile/no-login.patch.yml" --dump-config 2>/dev/null)"
disables=$(printf '%s' "$dump" | grep -c "disabled: true")
targeted=0
for id in deepseek-account llm-deepseek-account ui-settings-account; do
  # 取该 id 的整块（到下一个 - id: 之前），再找 disabled: true
  block="$(printf '%s' "$dump" | awk -v id="$id" '$0 == "- id: " id {flag=1; next} /^- id: / {flag=0} flag')"
  printf '%s' "$block" | grep -q "disabled: true" && targeted=$((targeted+1))
done
api_key_route=$(printf '%s' "$dump" | grep -c "dsh-llm-deepseek-api-key")
account_row=$(printf '%s' "$dump" | grep -c "dsh-deepseek-account-platform")
ok=$([ "$targeted" -ge 3 ] && [ "$api_key_route" -ge 1 ] && echo true || echo false)
printf '{"ok":%s,"targetedDisabled":%s,"allDisabledRows":%s,"apiKeyRoute":%s,"accountPackageRows":%s}\n' "$ok" "$targeted" "$disables" "$api_key_route" "$account_row"
[ "$ok" = "true" ]
