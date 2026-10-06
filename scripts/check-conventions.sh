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
if [ -f sync/bootstrap.age ]; then
  if [ ! -f sync/bootstrap.meta.json ]; then
    bad "sync/bootstrap.age 存在但缺 sync/bootstrap.meta.json（成员清单/指纹/生成时间；见 docs/operations/KEY-BOOTSTRAP-ANALYSIS.md）"
  else
    ok "引导包有配套元信息 sync/bootstrap.meta.json"
  fi
  # 仓库是公开的：一旦引导包里混进明文私钥，等于把账号/记忆直接公开 → 两条硬检查
  if head -c 200 sync/bootstrap.age | grep -q 'age-encryption.org/'; then
    ok "引导包是 age 密文（头部正确）"
  else
    bad "sync/bootstrap.age 头部不是 age 密文（可能被替换或未加密）"
  fi
  if grep -qa 'AGE-SECRET-KEY-1' sync/bootstrap.age; then
    bad "sync/bootstrap.age 内含明文私钥（AGE-SECRET-KEY-1）——公开仓库禁止；请重新 pack 并清理 git 历史"
  else
    ok "引导包内无明文私钥残留"
  fi
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

# ── D. 文档里的"结构计数"必须与代码一致 ──
# 这类数字漂移反复发生（golden 步数在 README/FAQ/STRUCTURE/VISION 里各写一遍，12→16→17→19
# 只改了一部分；脚本数写在 STRUCTURE 里、加了脚本没人改）。这里只钉**唯一措辞**的两处，
# 避免误伤历史记录（DECISIONS/PROGRESS 里的"12 步 → 13 步"是史实，不该被校验）。
SCRIPT_COUNT="$(ls scripts | grep -cE '\.(sh|mjs|py)$')"
DOC_SCRIPT_COUNT="$(grep -oE '# [0-9]+ 个运维脚本' STRUCTURE.md | grep -oE '[0-9]+' | head -1)"
if [ -n "$DOC_SCRIPT_COUNT" ] && [ "$DOC_SCRIPT_COUNT" != "$SCRIPT_COUNT" ]; then
  bad "STRUCTURE.md 写的是 $DOC_SCRIPT_COUNT 个运维脚本，实际 $SCRIPT_COUNT 个（改了 scripts/ 记得同步）"
else
  ok "STRUCTURE.md 的脚本数与实际一致（$SCRIPT_COUNT）"
fi

# 步数以"冒烟之前最大的那个编号"为准（4/5 在 --fast 分支里声明两次；第 20 步是 --smoke 专属）
SMOKE_LINE="$(grep -n 'if \[ "\$SMOKE" = "1" \]' scripts/golden-tasks.sh | head -1 | cut -d: -f1)"
GOLDEN_STEPS="$(head -n "${SMOKE_LINE:-99999}" scripts/golden-tasks.sh | grep -oE '^[[:space:]]*step "[0-9]+' | grep -oE '[0-9]+' | sort -n | uniq | tail -1)"

# BUG-REPLAYS 台账：每行必须带**可执行命令**（防"注意一下"式的失效条目——台账的价值就在于可重跑）
if [ -f docs/BUG-REPLAYS.md ]; then
  LEDGER_ROWS="$(grep -cE '^\| [0-9]+ \|' docs/BUG-REPLAYS.md)"
  LEDGER_NO_CMD="$(grep -E '^\| [0-9]+ \|' docs/BUG-REPLAYS.md | grep -vE '(node |bash |npx |scripts/|my-pi\.sh)' || true)"
  if [ "${LEDGER_ROWS:-0}" -lt 5 ]; then
    bad "docs/BUG-REPLAYS.md 台账只剩 $LEDGER_ROWS 行（应 >=5；是不是被删了？）"
  elif [ -n "$LEDGER_NO_CMD" ]; then
    bad "docs/BUG-REPLAYS.md 有 $(( $(printf '%s\n' "$LEDGER_NO_CMD" | wc -l) )) 行没有可执行命令（每行必须能重跑）："
    printf '%s\n' "$LEDGER_NO_CMD" | cut -c1-100 | sed 's/^/       /'
  else
    ok "BUG-REPLAYS 台账每行都带可执行命令（$LEDGER_ROWS 行）"
  fi
fi
DOC_STEPS="$(grep -oE '行为防退化基准 \*\*[0-9]+ 步\*\*' scripts/README.md | grep -oE '[0-9]+' | head -1)"
if [ -n "$DOC_STEPS" ] && [ "$DOC_STEPS" != "$GOLDEN_STEPS" ]; then
  bad "scripts/README.md 写的是 golden $DOC_STEPS 步，实际 $GOLDEN_STEPS 步"
else
  ok "scripts/README.md 的 golden 步数与实际一致（$GOLDEN_STEPS）"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 约定守门全部通过"
  exit 0
fi
echo "❌ 约定守门失败 $FAIL 项"
exit 1
