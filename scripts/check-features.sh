#!/bin/bash
# check-features.sh - 功能完整性检查脚本
#
# 对照 pi-tools 的注册面清单，验证 12 个 feature 的目录、工具、命令、
# 快捷键、钩子事件与适配器 API 是否齐备。缺项输出 ❌ 并以非 0 退出。
#
# 用法：bash scripts/check-features.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

MISSING=0
WARN=0

echo "=== my-pi 功能完整性检查 ==="
echo ""

# ---- 期望清单（与 pi-tools 注册面对齐）----
# 格式：feature:name1,name2
EXPECTED_TOOLS="web-search:web_search,fetch_url,web_fetch link:link_send,link_status browser:browser_navigate,browser_screenshot,browser_click,browser_type,browser_scroll,browser_extract,browser_evaluate,browser_find,browser_wait_for,browser_network,browser_select_option,browser_dialog,browser_download,browser_upload,browser_cookies,browser_pdf,browser_help,browser_close voice:voice_transcribe,voice_speak,voice_record tmux:tmux_run,tmux_status,tmux_read,tmux_send,tmux_stop,tmux_wait memory:memory_store,memory_search,memory_recall,memory_stats,memory_forget plan-mode:todo subagent:subagent autopilot:autopilot_status,autopilot_stats,autopilot_failover context:enable_tool,thinking_level"
EXPECTED_COMMANDS="autopilot:auto,schedule context:context,tools mode:mode plan-mode:plan voice:voice memory:memory link:link intervention:intervention"
EXPECTED_SHORTCUTS="voice plan-mode"
HOOK_EVENTS="session_start before_agent_start context tool_call tool_result tool_execution_start"

# ---- 1. 扩展目录完整性 ----
echo "1. 扩展目录完整性"
FEATURE_COUNT=0
for dir in custom/features/*/; do
  name=$(basename "$dir")
  FEATURE_COUNT=$((FEATURE_COUNT + 1))
  if [ -f "$dir/index.ts" ] && [ -f "$dir/logic.ts" ]; then
    echo "  ✅ $name (index.ts + logic.ts)"
  else
    echo "  ❌ $name 缺少 index.ts 或 logic.ts"
    MISSING=$((MISSING + 1))
  fi
done
[ "$FEATURE_COUNT" -eq 12 ] && echo "  ✅ feature 数量: 12" || { echo "  ❌ feature 数量: $FEATURE_COUNT（期望 12）"; MISSING=$((MISSING + 1)); }
echo ""

# ---- 2. 工具注册面 ----
echo "2. 工具注册面"
for entry in $EXPECTED_TOOLS; do
  feature="${entry%%:*}"
  names="${entry#*:}"
  IFS=',' read -r -a arr <<< "$names"
  for tool in "${arr[@]}"; do
    if grep -q "name: '$tool'" "custom/features/$feature/index.ts" 2>/dev/null; then
      echo "  ✅ $feature → $tool"
    else
      echo "  ❌ $feature → $tool 未注册"
      MISSING=$((MISSING + 1))
    fi
  done
done
echo ""

# ---- 3. 命令注册面 ----
echo "3. 命令注册面"
for entry in $EXPECTED_COMMANDS; do
  feature="${entry%%:*}"
  names="${entry#*:}"
  IFS=',' read -r -a arr <<< "$names"
  for cmd in "${arr[@]}"; do
    if grep -q "registerCommand(pi, '$cmd'" "custom/features/$feature/index.ts" 2>/dev/null; then
      echo "  ✅ $feature → /$cmd"
    else
      echo "  ❌ $feature → /$cmd 未注册"
      MISSING=$((MISSING + 1))
    fi
  done
done
echo ""

# ---- 4. 快捷键注册面 ----
echo "4. 快捷键注册面"
for feature in $EXPECTED_SHORTCUTS; do
  if grep -q "registerShortcut(pi" "custom/features/$feature/index.ts" 2>/dev/null; then
    echo "  ✅ $feature → registerShortcut"
  else
    echo "  ❌ $feature 未注册快捷键"
    MISSING=$((MISSING + 1))
  fi
done
echo ""

# ---- 5. 适配器 API 覆盖面 ----
echo "5. 适配器 API 覆盖面"
for api in registerTool registerHook registerHooks registerCommand registerShortcut registerMessageRenderer getActiveTools setActiveTools appendEntry sendMessage Key; do
  if grep -rqw "$api" custom/adapters/ 2>/dev/null; then
    echo "  ✅ $api"
  else
    echo "  ❌ $api 未在适配器中实现"
    MISSING=$((MISSING + 1))
  fi
done
echo ""

# ---- 6. 钩子事件覆盖 ----
# 双重校验：事件名必须是 Pi 真实派发的（vendor/pi 类型中存在），且 feature 中确有注册。
echo "6. 钩子事件覆盖"
PI_TYPES="vendor/pi/packages/coding-agent/src/core/extensions/types.ts"
for event in $HOOK_EVENTS; do
  used=0; valid=0
  grep -rq "event: '$event'" custom/features/ 2>/dev/null && used=1
  if [ -f "$PI_TYPES" ]; then
    grep -q "type: \"$event\"" "$PI_TYPES" && valid=1
  else
    valid=1  # fresh checkout 无 vendor，跳过契约校验（仅警告）
  fi
  if [ "$used" -eq 1 ] && [ "$valid" -eq 1 ]; then
    echo "  ✅ $event"
  elif [ "$used" -eq 0 ]; then
    echo "  ❌ $event 未被任何 feature 注册"
    MISSING=$((MISSING + 1))
  else
    echo "  ❌ $event 不是 Pi 派发的事件（vendor 类型中不存在）"
    MISSING=$((MISSING + 1))
  fi
done
# 反向检查：feature 中不得出现 Pi 不派发的事件名
if [ -f "$PI_TYPES" ]; then
  while IFS= read -r bad; do
    [ -z "$bad" ] && continue
    echo "  ❌ feature 使用了 Pi 不派发的事件: $bad"
    MISSING=$((MISSING + 1))
  done < <(grep -rhoE "event: '[a-z_]+'" custom/features/ 2>/dev/null | sed "s/event: '//; s/'//" | sort -u | while read -r ev; do
    grep -q "type: \"$ev\"" "$PI_TYPES" || echo "$ev"
  done)
fi
echo ""

# ---- 7. 关键配置文件 ----
echo "7. 关键配置文件"
for f in portable/agent/settings.json portable/agent/auth.json portable/agent/keybindings.json portable/agent/modes.json; do
  if [ -f "$f" ]; then
    echo "  ✅ $f"
  else
    echo "  ❌ $f 缺失"
    MISSING=$((MISSING + 1))
  fi
done
echo ""

# ---- 8. 运维脚本 ----
echo "8. 运维脚本"
for script in build.sh dev.sh sync-upstream.sh check-isolation.sh check-features.sh setup-external.sh patch-playwright-core.mjs golden-tasks.sh check-injection-surface.sh check-doc-links.mjs pi-supervisor.sh pi-source-build.sh daily-health.mjs knowledge-fetch.py tool-stats-sync.mjs task-summarizer.mjs searxng-config.sh; do
  if [ -f "scripts/$script" ]; then
    echo "  ✅ scripts/$script"
  else
    echo "  ❌ scripts/$script 缺失"
    MISSING=$((MISSING + 1))
  fi
done
echo ""

# ---- 9. 补丁完整性（对 vendor/pi 可应用或已应用）----
echo "9. 补丁完整性"
if [ -d "vendor/pi" ]; then
  for p in patches/*.patch; do
    [ -e "$p" ] || continue
    base=$(basename "$p")
    if git -C vendor/pi apply --check "$ROOT/$p" >/dev/null 2>&1 \
       || git -C vendor/pi apply --check --reverse "$ROOT/$p" >/dev/null 2>&1; then
      echo "  ✅ $base（可应用或已应用）"
    else
      echo "  ❌ $base 无法应用（路径/hunk 失配）"
      MISSING=$((MISSING + 1))
    fi
  done
else
  echo "  ⚠️  vendor/pi 不存在（fresh checkout，先运行 scripts/build.sh）"
  WARN=$((WARN + 1))
fi
echo ""

# ---- 10. 注册数量统计 ----
echo "10. 注册数量统计"
echo "  工具注册调用数: $(grep -rh "registerTool(pi" custom/features/*/index.ts 2>/dev/null | wc -l | tr -d ' ')"
echo "  命令注册调用数: $(grep -rh "registerCommand(pi" custom/features/*/index.ts 2>/dev/null | wc -l | tr -d ' ')"
echo "  快捷键注册调用数: $(grep -rh "registerShortcut(pi" custom/features/*/index.ts 2>/dev/null | wc -l | tr -d ' ')"
echo "  钩子注册调用数: $(grep -rhE "registerHooks?\(pi" custom/features/*/index.ts 2>/dev/null | wc -l | tr -d ' ')"
echo ""

echo "=== 检查完成 ==="
if [ "$MISSING" -gt 0 ]; then
  echo "❌ $MISSING 项缺失（⚠️ $WARN 项警告）"
  exit 1
fi
echo "🎉 所有功能检查通过（⚠️ $WARN 项警告）"
exit 0
