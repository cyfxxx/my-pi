#!/bin/bash
# 隔离边界验证脚本
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERRORS=0

echo "🔍 验证隔离边界..."

# 检查 1: .pi/（若存在）与 portable/ 下无符号链接
SYMLINKS=$(find "$ROOT/.pi" "$ROOT/portable" -type l 2>/dev/null || true)
if [ -n "$SYMLINKS" ]; then
    echo "❌ 配置/数据目录下存在符号链接："
    echo "$SYMLINKS"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ .pi/ 与 portable/ 下无符号链接"
fi

# 检查 2: custom/ 下无禁用目录
DISABLED_DIRS=0
for DIR in seams events session-log src docs tests config; do
    if [ -d "$ROOT/custom/$DIR" ]; then
        echo "❌ custom/$DIR/ 存在"
        DISABLED_DIRS=1
    fi
done
if [ $DISABLED_DIRS -eq 0 ]; then
    echo "✅ custom/ 下无禁用目录"
else
    ERRORS=$((ERRORS + 1))
fi

# 检查 3: features/*/logic.ts 不得 import vendor/pi
if grep -r "from.*vendor/pi" "$ROOT/custom/features"/*/logic.ts 2>/dev/null; then
    echo "❌ logic.ts 中 import 了 vendor/pi"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ logic.ts 无 vendor/pi 依赖"
fi

# 检查 4: adapters/ 之外不得 runtime import vendor/pi（import type 编译后擦除，允许）
VIOLATIONS_RUNTIME=$(grep -rl "from.*vendor/pi" "$ROOT/custom" --include="*.ts" 2>/dev/null | grep -v "/adapters/" | grep -v "/core/config.ts" | while read -r f; do
    if ! grep -q "import type.*from.*vendor/pi" "$f" 2>/dev/null; then
        echo "$f"
    fi
done || true)
if [ -n "$VIOLATIONS_RUNTIME" ]; then
    echo "❌ 以下文件在 adapters/ 外 runtime import 了 vendor/pi："
    echo "$VIOLATIONS_RUNTIME"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ adapters/ 外无 vendor/pi runtime 依赖（import type 已允许）"
fi

# 检查 5: portable/ 下无运行时依赖
RUNTIME_DEPS=0
for DIR in node chromium ffmpeg pi-global .cloakbrowser; do
    if [ -d "$ROOT/portable/$DIR" ]; then
        echo "❌ portable/$DIR/ 存在"
        RUNTIME_DEPS=1
    fi
done
if [ $RUNTIME_DEPS -eq 0 ]; then
    echo "✅ portable/ 下无运行时依赖"
else
    ERRORS=$((ERRORS + 1))
fi

# 检查 6: vendor/pi 必须干净
# 若 vendor/pi 是独立 git 仓库则在其中检查，否则检查主仓库对其的改动
if [ -d "$ROOT/vendor/pi/.git" ]; then
    if ! git -C "$ROOT/vendor/pi" diff --quiet 2>/dev/null; then
        echo "❌ vendor/pi/ 有未提交的修改"
        git -C "$ROOT/vendor/pi" diff --stat
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ vendor/pi/ 干净"
    fi
else
    if ! git -C "$ROOT" diff --quiet -- vendor/pi/ 2>/dev/null; then
        echo "❌ vendor/pi/ 有未提交的修改"
        git -C "$ROOT" diff --stat -- vendor/pi/
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ vendor/pi/ 干净"
    fi
fi

# 检查 7: LAST_SYNC_POINT 存在且含有效 SHA
if [ ! -f "$ROOT/vendor/pi/LAST_SYNC_POINT" ]; then
    echo "❌ vendor/pi/LAST_SYNC_POINT 不存在"
    ERRORS=$((ERRORS + 1))
elif ! grep -Eq '^[0-9a-f]{7,40}([[:space:]]|$)' "$ROOT/vendor/pi/LAST_SYNC_POINT"; then
    echo "❌ vendor/pi/LAST_SYNC_POINT 不含有效 commit SHA"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ LAST_SYNC_POINT 存在且格式有效"
fi

# 检查 8: scripts/ 下无子目录
if find "$ROOT/scripts" -mindepth 1 -type d 2>/dev/null | grep -q .; then
    echo "❌ scripts/ 下存在子目录"
    find "$ROOT/scripts" -mindepth 1 -type d
    ERRORS=$((ERRORS + 1))
else
    echo "✅ scripts/ 下无子目录"
fi

# 检查 9: portable/memory/ 存在
if [ ! -d "$ROOT/portable/memory" ]; then
    echo "❌ portable/memory/ 不存在"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ portable/memory/ 存在"
fi

echo ""
if [ $ERRORS -eq 0 ]; then
    echo "🎉 所有隔离边界验证通过"
    exit 0
else
    echo "⚠️  发现 $ERRORS 个违规项，请修复"
    exit 1
fi
