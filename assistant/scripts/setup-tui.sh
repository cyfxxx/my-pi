#!/usr/bin/env bash
# 安装/更新社区 TUI（@deepseek-harness-tui/dsh-tui）到共享 DSH_HOME，并把本仓插件挂进去。
#
# 目标：Web（本仓 launcher）与 TUI 用**同一个 DSH_HOME** ⇒ 会话互通、随时接续。
#
# 用法：
#   bash assistant/scripts/setup-tui.sh            # 安装到默认 DSH_HOME（$MYPI_HOME 或 ~/.dsh）
#   MYPI_HOME=/path bash assistant/scripts/setup-tui.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
DSH_BIN="$REPO/runtime/$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/aarch64/arm64/; s/x86_64/x64/')/ext/dsh/node_modules/.bin/dsh"
export DSH_HOME="${MYPI_HOME:-$HOME/.dsh}"
VERSION="${MYPI_TUI_VERSION:-0.16.1}"

say() { printf '\n=== %s ===\n' "$1"; }
[ -x "$DSH_BIN" ] || { echo "✗ 找不到仓内宿主：$DSH_BIN"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "✗ 需要 pnpm（npm i -g pnpm）"; exit 1; }

say "安装 TUI 到 $DSH_HOME/profiles/dsh-tui（版本 $VERSION）"
"$DSH_BIN" plugin --profile dsh-tui add "@deepseek-harness-tui/dsh-tui@$VERSION"

say "把本仓插件挂进 TUI profile"
PATCH_FILE="$DSH_HOME/profiles/dsh-tui/cordis.patch.yml"
PLUGIN_ENTRY="$ROOT/plugin/dist/plugin.mjs"
[ -f "$PLUGIN_ENTRY" ] || { echo "✗ 插件未构建：$PLUGIN_ENTRY（先跑 verify 或 esbuild）"; exit 1; }
if grep -q "mypi-assistant" "$PATCH_FILE" 2>/dev/null; then
  echo "已挂载（跳过）：$PATCH_FILE"
else
  # 模板初始内容是「注释 + []」：空数组后直接追加列表项不是合法 YAML，先把 `[]` 行去掉。
  if grep -q '^\[\]$' "$PATCH_FILE"; then
    awk '!/^\[\]$/' "$PATCH_FILE" >"$PATCH_FILE.tmp" && mv "$PATCH_FILE.tmp" "$PATCH_FILE"
  fi
  cat >>"$PATCH_FILE" <<YAML

# my-pi 插件（记忆 / tmux / 搜索 provider）
- insert:
    - id: mypi-assistant
      name: "$PLUGIN_ENTRY"
YAML
  echo "已写入：$PATCH_FILE"
fi

say "启动方式"
cat <<MSG
  # TUI（与 Web 共用 $DSH_HOME，会话互通）
  MYPI_HOME=$DSH_HOME DSH_HOME=$DSH_HOME node $DSH_HOME/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js

  # 或直接用 mypi.sh（会自动识别）
  MYPI_HOME=$DSH_HOME assistant/scripts/mypi.sh tui
MSG
