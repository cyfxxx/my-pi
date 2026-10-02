#!/bin/bash
# check-conventions.sh — 约定守门（P4 升格通道第一批，2026-10-01）
#
# 把三条此前只写在 `portable/agent/AGENTS.md` 里的软约定变成确定性检查
# （VISION §3.1：反复有效的软引导必须硬化；§3.2：数据完整性不依赖模型自觉）：
#
#   A 运行时/每环境状态不入库 —— 已踩过两次：`modes.json` 的 `current` 被 git 静默回退；
#     上游新增的 `deviceId` 会落在**入库**的 `settings.json`。
#   B 敏感文件与运行时数据不入库 —— 凭据/私钥/环境文件/会话/扩展安装位。
#   C 生产代码规范 —— `custom/` 非测试代码禁止 `any`、禁止动态（内联）import。
#     两条都在 AGENTS.md「开发规范」里，靠人自觉；现状为 0 违规，故可直接守门。
#
# 用法：bash scripts/check-conventions.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

FAIL=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
note() { echo "     $1"; }

echo "=== 约定守门（A 运行时状态不入库 / B 敏感文件不入库 / C 生产代码规范） ==="

# ── A. 运行时/每环境状态不入库 ──
# 判定：入库的 JSON 里出现这些键即失败（应改写入 gitignored 的 *-state.json）。
A_PAIRS=(
  "portable/agent/settings.json:deviceId"
  "portable/agent/modes.json:current"
)
for pair in "${A_PAIRS[@]}"; do
  f="${pair%%:*}"; key="${pair##*:}"
  if [ ! -f "$f" ]; then
    note "$f 不存在（跳过 $key）"
    continue
  fi
  if grep -qE "\"$key\"[[:space:]]*:" "$f"; then
    bad "$f 含每环境状态键 \"$key\"（应写入被 gitignore 的 *-state.json）"
  else
    ok "$f 无 \"$key\""
  fi
done

# ── B. 敏感文件与运行时数据不入库 ──
# 同时检查已跟踪文件与暂存区（pre-commit 时提交尚未落盘，只看 tracked 会漏）。
SENSITIVE_RE='(^|/)(auth\.json|\.env|\.env\..*|credentials(\.json)?|id_(rsa|ed25519|ecdsa)|.*\.(pem|key|p12|pfx|keystore))$|^portable/agent/(sessions|extensions|npm|git)/|^portable/agent/.*-state\.json$|^portable/memory/tool-outputs/'
candidates="$({
  git ls-files 2>/dev/null
  git diff --cached --name-only 2>/dev/null
} | sort -u | grep -vE '^(vendor|packs|node_modules)/' || true)"
hits="$(printf '%s\n' "$candidates" | grep -E "$SENSITIVE_RE" || true)"
if [ -n "$hits" ]; then
  bad "敏感文件/运行时数据被跟踪或暂存："
  printf '%s\n' "$hits" | sed 's/^/       /'
else
  ok "敏感文件与运行时数据未入库（$(printf '%s\n' "$candidates" | grep -c . ) 个文件已检查）"
fi

# ── B2. 引导包配套元信息（防"无人记得怎么解、内容不明"）──
if [ -f sync/bootstrap.age ] && [ ! -f sync/bootstrap.meta.json ]; then
  bad "sync/bootstrap.age 存在但缺 sync/bootstrap.meta.json（成员清单/指纹/生成时间；见 docs/operations/KEY-BOOTSTRAP-ANALYSIS.md）"
elif [ -f sync/bootstrap.age ]; then
  ok "引导包有配套元信息 sync/bootstrap.meta.json"
else
  note "尚未生成引导包（sync/bootstrap.age 不存在；需要时 bash scripts/bootstrap-key.sh pack）"
fi

# ── C. 生产代码规范 ──
# 只看生产代码：测试与 node_modules 不在此列（测试里允许 `as any` 造桩）。
ANY_HITS="$(grep -rnE '(:[[:space:]]*any\b|<any>|as[[:space:]]+any\b)' custom \
  --include='*.ts' --include='*.tsx' --include='*.mts' \
  --exclude-dir=node_modules --exclude-dir=__tests__ --exclude-dir=dist 2>/dev/null \
  | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)' || true)"
if [ -n "$ANY_HITS" ]; then
  bad "生产代码使用了 any（AGENTS.md 开发规范）："
  printf '%s\n' "$ANY_HITS" | sed 's/^/       /'
else
  ok "生产代码无 any"
fi

DYN_HITS="$(grep -rnE '(^|[^A-Za-z_$.])import\(' custom \
  --include='*.ts' --include='*.tsx' --include='*.mts' \
  --exclude-dir=node_modules --exclude-dir=__tests__ --exclude-dir=dist 2>/dev/null \
  | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)' || true)"
if [ -n "$DYN_HITS" ]; then
  bad "生产代码使用了动态（内联）import（AGENTS.md：只使用顶层导入）："
  printf '%s\n' "$DYN_HITS" | sed 's/^/       /'
else
  ok "生产代码无动态 import"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 约定守门全部通过"
  exit 0
fi
echo "❌ 约定守门失败 $FAIL 项"
exit 1
