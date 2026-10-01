#!/bin/bash
# check-upstream.sh — 上游变更体检（只读）
#
# 为什么单独一个脚本：sync-upstream.sh 只回答「能不能同步」，不回答「同步后要付多少代价」。
# 上次 v0.87.0 → v0.99.1 一次性跳了 130 个提交、744 个文件（+90664/-24881），事后才发现
# 默认主题改 system、工具链换 TS7/ES2024、新增 MCP/codemode 两个包——这些本该在同步前看到。
#
# 本脚本在同步前给出：
#   1. 目标版本/区间提交数/改动规模
#   2. 各包改动量排行 + 新增包
#   3. changelog 新增版本段与「破坏性/默认值/遥测」关键词
#   4. 本地每个 patches/*.patch 的目标文件是否被上游改过（补丁失配风险）
#   5. custom/adapters 依赖的 Pi 入口文件是否变动 + 逐符号核对导出是否还在
#   6. 结论=可同步 / 已最新 / 需先改补丁
#
# 用法：
#   bash scripts/check-upstream.sh                      # fetch 上游并出报告
#   bash scripts/check-upstream.sh <commit|tag>         # 指定目标
#   PI_CHECK_NO_FETCH=1 bash scripts/check-upstream.sh  # 不联网（只用已 fetch 的 refs）
#   PI_CHECK_STRICT=1   ...                             # 需先改补丁时 exit 2（供钩子/CI 用）
#
# 只读保证：不 checkout、不改 vendor 工作树、不写 patches/、不重建。
# 唯一的对外副作用是 git fetch（只更新 vendor/pi 的 remote-tracking refs）。
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_PI="$ROOT/vendor/pi"
LAST_SYNC_FILE="$VENDOR_PI/LAST_SYNC_POINT"
UPSTREAM_URL="${PI_UPSTREAM_URL:-https://github.com/earendil-works/pi-mono.git}"

if [ ! -d "$VENDOR_PI/.git" ]; then
    echo "❌ vendor/pi 不是独立 git 仓库（fresh checkout 未引导）。先运行 bash scripts/build.sh" >&2
    exit 1
fi
if [ ! -f "$LAST_SYNC_FILE" ]; then
    echo "❌ 找不到 $LAST_SYNC_FILE" >&2
    exit 1
fi

V() { git -C "$VENDOR_PI" "$@"; }
short() { printf '%.9s' "$1"; }
tag_of() { V describe --tags --abbrev=0 "$1" 2>/dev/null || echo no-tag; }

LAST_SYNC=$(grep -v '^#' "$LAST_SYNC_FILE" | head -1 | awk '{print $1}')
LAST_SYNC=$(V rev-parse "$LAST_SYNC^{commit}")

if ! V remote get-url upstream >/dev/null 2>&1; then
    echo "添加 upstream remote: $UPSTREAM_URL"
    V remote add upstream "$UPSTREAM_URL"
fi

if [ "${PI_CHECK_NO_FETCH:-0}" != "1" ]; then
    echo "🔄 拉取上游（超时 ${PI_FETCH_TIMEOUT:-120}s；PI_CHECK_NO_FETCH=1 可跳过）..."
    if ! timeout "${PI_FETCH_TIMEOUT:-120}" git -C "$VENDOR_PI" fetch --quiet upstream; then
        echo "⚠ 拉取失败/超时，改用本地已有 refs 继续——结论可能不是最新上游" >&2
    fi
else
    echo "⏭  跳过 fetch（PI_CHECK_NO_FETCH=1）"
fi

if [ -n "${1:-}" ]; then
    TARGET="$1"
elif V rev-parse --verify -q upstream/main >/dev/null; then
    TARGET="upstream/main"
elif V rev-parse --verify -q upstream/master >/dev/null; then
    TARGET="upstream/master"
else
    echo "❌ 无法确定上游默认分支（既无 upstream/main 也无 upstream/master）。用 PI_CHECK_NO_FETCH=1 + 显式 commit 可离线检查。" >&2
    exit 1
fi
TARGET=$(V rev-parse "$TARGET^{commit}")

echo
echo "== 目标 =="
echo "  当前基线: $(short "$LAST_SYNC")  ($(tag_of "$LAST_SYNC"))"
echo "  目标    : $(short "$TARGET")  ($(tag_of "$TARGET"))"

if [ "$TARGET" = "$LAST_SYNC" ]; then
    echo
    echo "结论=已最新（基线未变）。补丁栈无需改动；如需校验补丁行为：bash scripts/golden-tasks.sh --fast"
    exit 0
fi

# 方向校验：目标必须是基线的后继，否则 diff/rev-list 方向是反的，报告会误导。
# （回退到旧 tag、或检查一个与当前基线无祖先关系的分支时会出现。）
if ! V merge-base --is-ancestor "$LAST_SYNC" "$TARGET" 2>/dev/null; then
    echo "  ⚠ 目标不是当前基线的后继（回退或无关联提交）：diff 方向相反，规模统计仅供参考" >&2
fi

echo "  区间提交: $(V rev-list --count "$LAST_SYNC..$TARGET")"
echo "  改动规模: $(V diff --shortstat "$LAST_SYNC" "$TARGET" | sed 's/^ *//')"

echo
echo "== 各包改动量（增+删，Top 10）=="
V diff --numstat "$LAST_SYNC" "$TARGET" | awk -F'\t' '
  $3 ~ /^packages\// {
    split($3, p, "/");
    if ($1 != "-" && $2 != "-") churn[p[2]] += $1 + $2;
  }
  END { for (k in churn) printf "%d\t%s\n", churn[k], k }
' | sort -rn | head -10 | awk -F'\t' '{ printf "  %8d  %s\n", $1, $2 }'

NEW_PKGS=$(V diff --name-only --diff-filter=A "$LAST_SYNC" "$TARGET" -- 'packages/*/package.json' \
    | awk -F/ '{print $2}' | sort -u | tr '\n' ' ')
[ -n "$NEW_PKGS" ] && echo "  新增包: $NEW_PKGS"

echo
echo "== changelog 新增版本段 =="
CHANGELOGS=$(V ls-tree -r --name-only "$TARGET" -- packages | grep -E '/CHANGELOG\.md$' || true)
NEW_SECTIONS=0
for f in $CHANGELOGS; do
    new_vers=$(comm -13 \
        <(V show "$LAST_SYNC:$f" 2>/dev/null | grep -E '^## \[[0-9]' | sort -u) \
        <(V show "$TARGET:$f" 2>/dev/null | grep -E '^## \[[0-9]' | sort -u) || true)
    if [ -n "$new_vers" ]; then
        NEW_SECTIONS=$((NEW_SECTIONS + 1))
        echo "  ${f#packages/}"
        echo "$new_vers" | sed 's/^/    /'
    fi
done
[ "$NEW_SECTIONS" -eq 0 ] && echo "  （无：本区间没有发布新版本段，改动全在 [Unreleased]）"

echo
echo "== 区间 changelog 关键词（破坏性/默认值/遥测/删除）=="
KEYWORDS=$(V diff "$LAST_SYNC" "$TARGET" -- 'packages/*/CHANGELOG.md' \
    | grep -E '^\+' | grep -vE '^\+\+\+' \
    | grep -iE 'breaking|removed|deprecat|no longer|default|telemetry|analytics|opt-in|opt out' || true)
if [ -n "$KEYWORDS" ]; then
    echo "$KEYWORDS" | head -25 | sed 's/^+/  /'
    n=$(echo "$KEYWORDS" | wc -l | tr -d ' ')
    [ "$n" -gt 25 ] && echo "  …（共 $n 行，已截断）"
else
    echo "  （无匹配）"
fi

echo
echo "== 本地补丁 vs 上游改动（补丁失配风险）=="
RISK=0
shopt -s nullglob
for p in "$ROOT"/patches/*.patch; do
    base=$(basename "$p")
    files=$(grep -E '^\+\+\+ b/' "$p" | sed 's|^+++ b/||' | sort -u)
    if [ -z "$files" ]; then
        echo "  ⚠ $base —— 补丁里没有文件路径（格式异常？）"
        RISK=$((RISK + 1))
        continue
    fi
    hit=$(V diff --name-only "$LAST_SYNC" "$TARGET" -- $files | sed '/^$/d' || true)
    if [ -n "$hit" ]; then
        RISK=$((RISK + 1))
        echo "  ⚠ $base —— 目标文件被上游改过（需人工改补丁）："
        echo "$hit" | sed 's/^/      /'
    else
        echo "  ✅ $base —— 目标文件未变，可原样重放"
    fi
done

echo
echo "== API 面（custom/adapters 依赖）=="
API_FILES="packages/coding-agent/src/index.ts packages/coding-agent/package.json \
packages/tui/src/index.ts packages/tui/package.json \
packages/coding-agent/src/core/extensions/types.ts packages/coding-agent/src/core/footer-data-provider.ts"
api_changed=$(V diff --name-only "$LAST_SYNC" "$TARGET" -- $API_FILES | sed '/^$/d' || true)
if [ -n "$api_changed" ]; then
    echo "$api_changed" | sed 's|^|  ⚠ 入口/类型文件已改动: |'
else
    echo "  ✅ 入口与类型文件均未改动"
fi

# 逐符号核对：adapters 从两个 Pi 包 import 的每个符号，在目标源码里是否仍有 export 声明。
# 注意这只是**快速预检**：符号可能被移到别的文件、或经 index.ts 再导出；最终判定以
# sync-upstream.sh 第 6 步的 `npx tsc --noEmit -p custom/` 为准。
API_REPORT=$(grep -hE "^import (type )?\{.*\} from '@earendil-works/" "$ROOT"/custom/adapters/*.ts \
    | while IFS= read -r line; do
        pkg=$(echo "$line" | sed -E "s/.*from '@earendil-works\/([^']+)'.*/\1/")
        syms=$(echo "$line" | sed -E 's/^import (type )?\{([^}]*)\}.*/\2/')
        dir="packages/coding-agent/src"
        case "$pkg" in *pi-tui) dir="packages/tui/src" ;; esac
        # 只保留左侧导入名：`ToolDefinition as PiToolDefinition` → ToolDefinition
        # （别反过来取别名——别名是本地起的，上游当然找不到）
        echo "$syms" | tr ',' '\n' | sed -E 's/ +as +[A-Za-z0-9_$]+//; s/^ *//; s/ *$//' | grep -v '^$' \
        | while read -r sym; do
            if ! V grep -qE "^export.*(^|[^A-Za-z0-9_])${sym}([^A-Za-z0-9_]|$)" "$TARGET" -- "$dir" 2>/dev/null; then
                echo "    ⚠ $pkg 的 $sym 在目标源码里找不到 export（可能已删除/改名）"
            fi
        done
    done || true)
if [ -n "$API_REPORT" ]; then
    echo "$API_REPORT"
    API_MISSING=$(echo "$API_REPORT" | grep -c '⚠' || true)
else
    echo "  ✅ adapters 导入的符号在目标源码里都有 export 声明"
    API_MISSING=0
fi

echo
if [ "$RISK" -gt 0 ] || [ "$API_MISSING" -gt 0 ]; then
    echo "结论=需先改补丁/适配（补丁风险 $RISK 个，API 缺失 $API_MISSING 个）"
    echo "  1. 按上面列出的文件逐个比对：git -C vendor/pi diff $LAST_SYNC $TARGET -- <文件>"
    echo "  2. 改 patches/ 后：bash scripts/sync-upstream.sh   （任一补丁失配会整体回滚，不留半完成状态）"
    echo "  3. 不想接受的变更：见 docs/operations/UPSTREAM-UPDATE.md「不想要的变更怎么处理」"
    [ "${PI_CHECK_STRICT:-0}" = "1" ] && exit 2
else
    echo "结论=可同步（补丁目标文件与 adapters API 面均未受影响）"
    echo "  下一步：bash scripts/sync-upstream.sh   （自动重建 vendor dist + 类型检查 custom/）"
    echo "  仍然建议先扫一眼上面的 changelog 关键词段落：补丁可以不改，但默认值和新增包会影响运行时行为。"
fi
