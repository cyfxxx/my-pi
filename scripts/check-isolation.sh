#!/bin/bash
# 隔离边界验证脚本
set -e

# 清掉调用方注入的 git 环境：`git commit <pathspec>`（部分提交）会用**临时索引**并把
# GIT_INDEX_FILE 传给钩子，于是本脚本里的 `git -C vendor/pi diff` 会拿 my-pi 的索引去比对
# vendor 仓库 → `fatal: unable to read <sha>` → 误判 "vendor/pi 有未提交的修改"，
# 提交被 pre-commit 拦下（2026-10-01 实测两次复现）。守门只应依赖自己的参数。
unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERRORS=0

# 复用共享判据（git_repo_readable / git_dirty_state / git_unreadable_hint）。
# 检查 6 曾自行用 `git diff --quiet 2>/dev/null` 判断 vendor/pi 是否干净，会踩 exFAT
# 属主陷阱（详见该处注释与 lib-vendor.sh）；统一到 lib-vendor.sh 避免各脚本口径漂移。
# shellcheck source=scripts/lib-vendor.sh
. "$ROOT/scripts/lib-vendor.sh"

echo "🔍 验证隔离边界..."

# 检查 1: .pi/（若存在）与 portable/ 下无符号链接
# 说明：Termux/PRoot 环境下 `find -type l` 会把部分普通文件误判为符号链接，
# 因此只用 find 枚举路径，用 `test -L` 判定，避免误报。
SYMLINKS=""
while IFS= read -r path; do
    if [ -L "$path" ]; then
        SYMLINKS="${SYMLINKS}${path}"$'\n'
    fi
done < <(find "$ROOT/.pi" "$ROOT/portable" 2>/dev/null || true)
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

# 检查 3: features 逻辑层（index.ts 与 __tests__/ 除外）不得 import Pi 包
# 注意：真实 import 走包名 @earendil-works/*，而非路径 vendor/pi；必须按包名校验。
# logic.ts 现为 barrel，实现下沉到子包，故按整个 features 树校验。
PI_RE="from ['\"]@(earendil-works|mariozechner)/"
LOGIC_HITS=$(grep -rlE "${PI_RE}" "$ROOT/custom/features" --include="*.ts" 2>/dev/null \
    | grep -v "/__tests__/" | grep -v "/index\.ts$" || true)
if [ -n "$LOGIC_HITS" ]; then
    echo "❌ features 逻辑层中 import 了 Pi 包："
    echo "$LOGIC_HITS"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ features 逻辑层无 Pi 包依赖"
fi

# 检查 4: adapters/ 之外不得 runtime import Pi 包（import type 编译后擦除，允许）
# 约定：非适配器文件只能用顶层单行 `import type`。
VIOLATIONS_RUNTIME=$(grep -rlE "${PI_RE}" "$ROOT/custom" --include="*.ts" 2>/dev/null \
    | grep -v "/adapters/" | grep -v "/__tests__/" | while read -r f; do
    if grep -E "${PI_RE}" "$f" 2>/dev/null | grep -vqE "^[[:space:]]*import[[:space:]]+type[[:space:]]"; then
        echo "$f"
    fi
done || true)
if [ -n "$VIOLATIONS_RUNTIME" ]; then
    echo "❌ 以下文件在 adapters/ 外 runtime import 了 Pi 包："
    echo "$VIOLATIONS_RUNTIME"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ adapters/ 外无 Pi 包 runtime 依赖（import type 已允许）"
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
#
# 2026-10-12 修：原实现是 `if ! git diff --quiet 2>/dev/null`，把两类完全不同的失败
# 混成一种：git **读不了仓库**（在 exFAT/网络盘上会因 "dubious ownership" 直接退化为
# `--no-index` 用法错误、退出码 129）与仓库**真的有改动**（退出码 1）。原先 2>/dev/null
# 还把线索吞掉了，于是最终只打印"有未提交的修改"——**指向错误的方向**（实测真实原因
# 是 exFAT 不记录文件属主，vendor/pi 其实是干净的）。
# 现复用 lib-vendor.sh 的共享判据：先判能否读取，再判是否干净，读不了就明确报"无法读取"。
if [ -d "$ROOT/vendor/pi/.git" ]; then
    if ! git_repo_readable "$ROOT/vendor/pi"; then
        echo "❌ vendor/pi/ 无法读取：git 拒绝访问该仓库（不是「有改动」）"
        git -C "$ROOT/vendor/pi" rev-parse --git-dir 2>&1 | head -2 | sed 's/^/     /'
        git_unreadable_hint "$ROOT/vendor/pi"
        ERRORS=$((ERRORS + 1))
    elif git_dirty_state "$ROOT/vendor/pi"; then
        echo "✅ vendor/pi/ 干净"
    else
        echo "❌ vendor/pi/ 有未提交的修改"
        git -C "$ROOT/vendor/pi" status --short | head -20
        ERRORS=$((ERRORS + 1))
    fi
else
    if ! git_repo_readable "$ROOT"; then
        echo "❌ 无法读取主仓库：git 拒绝访问（不是「有改动」）"
        git_unreadable_hint "$ROOT"
        ERRORS=$((ERRORS + 1))
    elif git -C "$ROOT" diff-index --quiet HEAD -- vendor/pi/ 2>/dev/null; then
        echo "✅ vendor/pi/ 干净"
    else
        # 主仓库可读性已在上面确认；这里非 0 只可能是"确有改动"
        echo "❌ vendor/pi/ 有未提交的修改"
        git -C "$ROOT" diff --stat -- vendor/pi/
        ERRORS=$((ERRORS + 1))
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
