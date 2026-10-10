#!/bin/bash
# check-conventions.sh — 约定守门（P4 升格通道第一批，2026-10-01）
#
# 把此前只写在 `portable/agent/AGENTS.md` 里的软约定变成确定性检查
# （VISION §3.1：反复有效的软引导必须硬化；§3.2：数据完整性不依赖模型自觉）：
#
#   A 运行时/每环境状态不入库 —— 已踩过两次：`modes.json` 的 `current` 被 git 静默回退；
#     上游新增的 `deviceId` 会落在**入库**的 `settings.json`。
#   B 敏感文件与运行时数据不入库 —— 凭据/私钥/环境文件/会话/扩展安装位。
#   C 生产代码规范 —— `custom/` 非测试代码禁止 `any`、禁止动态（内联）import。
#     两条都在 AGENTS.md「开发规范」里，靠人自觉；现状为 0 违规，故可直接守门。
#   D 文档里的"结构计数"与代码一致 —— 脚本数/golden 步数/事故台账每行可重跑。
#   E 模式人设的图片资产引用成对 —— 无悬空引用、无孤儿资产、目录有体积上限。
#
# 用法：bash scripts/check-conventions.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

FAIL=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
note() { echo "     $1"; }

echo "=== 约定守门（A 运行时状态不入库 / B 敏感文件不入库 / C 生产代码规范 / D 文档计数与台账一致 / E 模式资产引用成对 / F 隐私边界） ==="

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

# ── E. 模式人设的图片资产：引用与文件必须成对 ──
# 人设（`portable/agent/modes/*.md`）在 system 前缀里点名资产文件名，模型据此 `read`。
# 这类引用此前只靠人自觉，而两种漂移都是**静默**的：
#   - 悬空引用：改了/删了图却忘了改人设 → 模型去 read 一个不存在的文件，只会回一句"找不到"；
#   - 孤儿资产：加了图却没写进人设 → 白占体积（这套目录随仓库分发，便携是硬目标），模型永远不知道它存在。
# 约定：资产文件名一律 `<两位序号>-<内容>.<ext>`，人设与 assets/README.md 都用反引号点它。
MODE_ASSETS_DIR="portable/agent/modes/assets"
MODE_ASSETS_MAX_BYTES=$((8 * 1024 * 1024))
if [ -d "$MODE_ASSETS_DIR" ]; then
  ASSET_FILES="$(find "$MODE_ASSETS_DIR" -type f ! -name 'README.md' -printf '%f\n' 2>/dev/null | sort)"
  ASSET_REFS="$(grep -rhoE '[0-9]{2}-[^ `"'"'"'()（）,，]+\.(png|jpe?g|webp|gif)' portable/agent/modes --include='*.md' 2>/dev/null | sort -u || true)"
  MISSING_REFS=""
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    [ -n "$(find "$MODE_ASSETS_DIR" -name "$ref" -print -quit 2>/dev/null)" ] || MISSING_REFS="$MISSING_REFS
       $ref"
  done <<< "$ASSET_REFS"
  ORPHANS="$(printf '%s\n' "$ASSET_FILES" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    printf '%s\n' "$ASSET_REFS" | grep -qxF "$f" || echo "       $f"
  done)"
  ASSET_BYTES="$(find "$MODE_ASSETS_DIR" -type f -printf '%s\n' 2>/dev/null | awk '{s+=$1} END{print s+0}')"
  if [ -n "$MISSING_REFS" ]; then
    bad "人设/清单点名了不存在的资产文件（悬空引用）：$MISSING_REFS"
  elif [ -n "$ORPHANS" ]; then
    bad "资产目录里有文件没被任何 modes/*.md 引用（孤儿资产；要么写进人设，要么删掉）："
    printf '%s\n' "$ORPHANS"
  elif [ "$ASSET_BYTES" -gt "$MODE_ASSETS_MAX_BYTES" ]; then
    bad "模式资产 $(( ASSET_BYTES / 1048576 ))MB 超过上限 $(( MODE_ASSETS_MAX_BYTES / 1048576 ))MB（整套立绘/语音不入库；只放精选代表图）"
  else
    ok "模式资产引用成对（$(printf '%s\n' "$ASSET_FILES" | grep -c . ) 个文件，$(( ASSET_BYTES / 1024 ))KB，无悬空引用/孤儿）"
  fi
else
  note "尚无模式图片资产（$MODE_ASSETS_DIR 不存在）"
fi

# ── F. 隐私边界：数据默认不出本机 ──
# 禁用上游外发通道（/share /bug）已被补丁删除；守门查补丁删除的命令是否在 diff 里。
if grep -qE '^-.*\{ name: "share"' patches/010-disable-share-bug.patch && grep -qE '^-.*\{ name: "bug"' patches/010-disable-share-bug.patch; then
  ok "patches/010 已从命令表删除 /share 与 /bug"
else
  bad "patches/010 未完全删除 /share 或 /bug 命令条目"
fi
if grep -qE 'Patch \(010-disable-share-bug\)' patches/010-disable-share-bug.patch && grep -q '此命令在 my-pi 中已禁用' patches/010-disable-share-bug.patch; then
  ok "patches/010 含自标记 + handler 早退提示"
else
  bad "patches/010 缺自标记或 handler 未早退"
fi
if [ -f portable/agent/settings.json ]; then
  if grep -qE '"enableInstallTelemetry"[[:space:]]*:[[:space:]]*false' portable/agent/settings.json; then
    ok "settings.json enableInstallTelemetry:false"
  else
    bad "settings.json 未关闭 enableInstallTelemetry（隐私边界）"
  fi
else
  bad "portable/agent/settings.json 不存在"
fi
for f in scripts/pi-supervisor.sh scripts/dev.sh; do
  if [ -f "$f" ] && grep -qE 'PI_TELEMETRY=0' "$f"; then
    ok "$f PI_TELEMETRY=0"
  else
    bad "$f 未设 PI_TELEMETRY=0"
  fi
done

# ── E. 知识索引不漂移（WikiSkill 借鉴 A 项，2026-10-08）──
# 索引是"找先例"的入口；它一旦与源文档不一致就会误导下一轮优化，所以按**确定性输出**逐字节比对。
# 挂在既有守门里而不是新增 golden 步：步数被第 D 节钉住，加步会连带改好几处计数。
# JSON 语法合法性（2026-10-10 补的守门缺口）：packs/**、scripts/**、sync/** 下我们自己写的 .json。
# 起因：一份**非法 JSON** 的 `packs/security-baseline/tiers.json` 一路提交成功 —— 因为**没有任何守门
# 检查 JSON 语法**（文档链接/约定/死导出都不管它）。用 node 解析，跨平台、无外部依赖。
if node -e '
  const fs=require("fs"),path=require("path");
  const walk=(d,out=[])=>{let es=[];try{es=fs.readdirSync(d)}catch{return out}
    for(const n of es){const f=path.join(d,n);let st;try{st=fs.statSync(f)}catch{continue}
      if(st.isDirectory()){if(n!=="node_modules"&&n!==".venv")walk(f,out)}
      else if(n.endsWith(".json"))out.push(f)}
    return out};
  const files=[...walk("packs"),...walk("scripts"),...walk("sync")];
  let bad=0;
  for(const f of files){try{JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){bad++;console.error("非法 JSON: "+f+" → "+e.message)}}
  if(bad){process.exit(1)}
  ' 2>&1; then
  ok "JSON 语法合法（packs/scripts/sync 下的 .json）"
else
  bad "有非法 JSON（见上）"
fi

if [ -f scripts/knowledge-compile.mjs ]; then
  if node scripts/knowledge-compile.mjs --check >/dev/null 2>&1; then
    ok "知识库与源证据一致（docs/knowledge/）"
  else
    bad "docs/knowledge/ 已漂移（跑 node scripts/knowledge-compile.mjs --update 后提交）"
  fi
fi
if [ -f scripts/gen-doc-index.mjs ]; then
  if node scripts/gen-doc-index.mjs --check >/dev/null 2>&1; then
    ok "知识索引与源文档一致（docs/INDEX.md）"
  else
    bad "docs/INDEX.md 已漂移（跑 node scripts/gen-doc-index.mjs --update 后提交）"
  fi
fi
if [ -f scripts/gen-changes-ledger.mjs ]; then
  if node scripts/gen-changes-ledger.mjs --check >/dev/null 2>&1; then
    ok "改动台账与 git 历史一致（docs/CHANGES.jsonl）"
  else
    bad "docs/CHANGES.jsonl 已漂移（跑 node scripts/gen-changes-ledger.mjs --update 后提交）"
  fi
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 约定守门全部通过"
  exit 0
fi
echo "❌ 约定守门失败 $FAIL 项"
exit 1
