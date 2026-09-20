#!/bin/bash
# 隔离边界验证脚本
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERRORS=0

echo "🔍 验证隔离边界..."

# 检查 1: .pi/extensions/ 必须为空或不存在
if [ -d "$ROOT/.pi/extensions" ] && [ "$(ls -A "$ROOT/.pi/extensions" 2>/dev/null)" ]; then
    echo "❌ F-01 违反：.pi/extensions/ 下仍有内容"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ .pi/extensions/ 已清空"
fi

# 检查 2: features/*/logic.ts 不得 import vendor/pi
if grep -r "from.*vendor/pi" "$ROOT/custom/features"/*/logic.ts 2>/dev/null; then
    echo "❌ F-02 违反：logic.ts 中 import 了 vendor/pi"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ logic.ts 无 vendor/pi 依赖"
fi

# 检查 3: adapters/ 之外不得 import vendor/pi
VIOLATIONS=$(grep -rl "from.*vendor/pi" "$ROOT/custom" --include="*.ts" 2>/dev/null | grep -v "/adapters/" | grep -v "/core/config.ts" || true)
if [ -n "$VIOLATIONS" ]; then
    echo "❌ F-03 违反：以下文件在 adapters/ 外 import 了 vendor/pi："
    echo "$VIOLATIONS"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ adapters/ 外无 vendor/pi 依赖"
fi

# 检查 4: 禁止存在的目录
for DIR in seams events session-log; do
    if [ -d "$ROOT/custom/$DIR" ]; then
        echo "❌ F-04 违反：custom/$DIR/ 存在"
        ERRORS=$((ERRORS + 1))
    fi
done

# 检查 5: portable/ 下不得有运行时依赖
for DIR in node chromium ffmpeg pi-global .cloakbrowser; do
    if [ -d "$ROOT/portable/$DIR" ]; then
        echo "❌ F-05 违反：portable/$DIR/ 存在"
        ERRORS=$((ERRORS + 1))
    fi
done

# 检查 6: vendor/pi 必须干净（检查 vendor/pi/ 目录下是否有未提交的修改）
cd "$ROOT"
if ! git diff --quiet -- vendor/pi/ 2>/dev/null; then
    echo "❌ F-07 违反：vendor/pi/ 有未提交的修改"
    git diff --stat -- vendor/pi/
    ERRORS=$((ERRORS + 1))
else
    echo "✅ vendor/pi/ 干净"
fi

# 检查 7: LAST_SYNC_POINT 存在
if [ ! -f "$ROOT/vendor/pi/LAST_SYNC_POINT" ]; then
    echo "❌ vendor/pi/LAST_SYNC_POINT 不存在"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ LAST_SYNC_POINT 存在"
fi

echo ""
if [ $ERRORS -eq 0 ]; then
    echo "🎉 所有隔离边界验证通过"
    exit 0
else
    echo "⚠️  发现 $ERRORS 个违规项，请修复"
    exit 1
fi
