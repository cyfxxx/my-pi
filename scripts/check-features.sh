#!/bin/bash
# check-features.sh - 功能完整性检查脚本
#
# 对照 pi-tools 的注册面清单，验证 12 个 feature 的目录、工具、命令、
# 快捷键、钩子事件与适配器 API 是否齐备。缺项输出 ❌ 并以非 0 退出。
#
# 用法：bash scripts/check-features.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# 共享补丁判定（vendor_patch_applied：优先看 vendor 提交历史，避免顺序叠加补丁
# 因后续补丁改写同文件上下文而被 --reverse --check 误判为"状态未知"）
# shellcheck source=lib-vendor.sh
source "$ROOT/scripts/lib-vendor.sh"

MISSING=0
WARN=0

echo "=== my-pi 功能完整性检查 ==="
echo ""

# ---- 注册面基线（生成式）----
# 工具/命令/快捷键清单由 `scripts/gen-registrations.mjs` 从代码生成并落盘为
# `scripts/registration-baseline.json`：代码与基线不一致即失败，需显式 `--update` 刷新
# （刷新进 diff，便于人工确认注册面确实变了）。此前是手写清单，漂移过 18 个工具。
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

# ---- 2. 注册面（工具/命令/快捷键，对照生成式基线）----
echo "2. 注册面（生成式基线）"
if node scripts/gen-registrations.mjs >/tmp/check-features-registrations.log 2>&1; then
  while IFS= read -r line; do echo "  ✅ $line"; done < /tmp/check-features-registrations.log
else
  while IFS= read -r line; do echo "  ❌ $line"; done < /tmp/check-features-registrations.log
  MISSING=$((MISSING + 1))
fi
echo ""

# ---- 3. 适配器 API 覆盖面 ----
echo "3. 适配器 API 覆盖面"
for api in registerTool registerHook registerHooks registerCommand registerShortcut registerMessageRenderer getActiveTools setActiveTools appendEntry sendMessage Key; do
  if grep -rqw "$api" custom/adapters/ 2>/dev/null; then
    echo "  ✅ $api"
  else
    echo "  ❌ $api 未在适配器中实现"
    MISSING=$((MISSING + 1))
  fi
done
echo ""

# ---- 4. 钩子事件覆盖 ----
# 双重校验：事件名必须是 Pi 真实派发的（vendor/pi 类型中存在），且 feature 中确有注册。
echo "4. 钩子事件覆盖"
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

# ---- 5. 关键配置文件 ----
echo "5. 关键配置文件"
for f in portable/agent/settings.json portable/agent/keybindings.json portable/agent/modes.json; do
  if [ -f "$f" ]; then
    echo "  ✅ $f"
  else
    echo "  ❌ $f 缺失"
    MISSING=$((MISSING + 1))
  fi
done
# 每环境独立（gitignore）：缺失只警告，不阻断 fresh checkout
for f in portable/agent/auth.json portable/agent/models.json; do
  if [ -f "$f" ]; then
    echo "  ✅ $f"
  else
    echo "  ⚠ $f 缺失（每环境独立，首次使用需配置）"
    WARN=$((WARN + 1))
  fi
done
# 随仓库分发的资源文件：既要存在，也不能被 ignore（否则 fresh clone 会缺文件）
# 清单对照 .gitignore 白名单维护：agents/**、modes/**、scheduled-seeds.json、injection-baseline.json
# 均为显式放行项，缺失即分发不完整（check-seeds-headless/check-injection-surface 会因此静默跳过）。
for f in custom/features/voice/scripts/pi-whisper.sh custom/features/voice/scripts/whisper-server.py \
         custom/features/voice/scripts/pi-sherpa.sh custom/features/voice/scripts/pi-sherpa-server.py \
         portable/agent/recovery/rescue-prompt.md \
         portable/agent/scheduled-seeds.json portable/agent/injection-baseline.json \
         portable/agent/modes/roleplay.md portable/agent/agents/*.md; do
  if [ ! -f "$f" ]; then
    echo "  ❌ $f 缺失（随仓库分发的资源，功能会退化）"
    MISSING=$((MISSING + 1))
  elif git check-ignore -q "$f" 2>/dev/null; then
    echo "  ❌ $f 被 .gitignore 忽略（fresh clone 会缺文件）"
    MISSING=$((MISSING + 1))
  else
    echo "  ✅ $f"
  fi
done
echo ""

# ---- 6. 运维脚本 ----
echo "6. 运维脚本"
for script in build.sh dev.sh doctor.sh sync-upstream.sh check-isolation.sh check-features.sh check-dead-exports.mjs check-patches-behavior.mjs gen-registrations.mjs check-seeds-headless.mjs install-hooks.sh vendor-bundle.sh run-ts.sh memory-store.mjs memory-lifecycle.mjs reseed-seeds.mjs test-supervisor.sh setup-external.sh patch-playwright-core.mjs golden-tasks.sh check-injection-surface.sh check-doc-links.mjs pi-supervisor.sh pi-source-build.sh daily-health.mjs knowledge-fetch.py tool-stats-sync.mjs task-summarizer.mjs searxng-config.sh knowledge-ingest.mjs sync-memory.sh; do
  if [ -f "scripts/$script" ]; then
    echo "  ✅ scripts/$script"
  else
    echo "  ❌ scripts/$script 缺失"
    MISSING=$((MISSING + 1))
  fi
done
echo ""

# ---- 7. 补丁完整性（对 vendor/pi 可应用或已应用）----
echo "7. 补丁完整性"
if [ -d "vendor/pi" ]; then
  for p in patches/*.patch; do
    [ -e "$p" ] || continue
    base=$(basename "$p")
    if vendor_patch_applied vendor/pi "$p" \
       || git -C vendor/pi apply --check "$ROOT/$p" >/dev/null 2>&1 \
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

# ---- 8. 注册数量统计 ----
echo "8. 注册数量统计"
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
