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

# Node 解析：本文件有 4 处要跑 .mjs，**不得裸调 node** —— PATH 上没有 node 时命令退出码 127，
# 若把"任何非 0"当成"内容有问题"，就会把「工具缺失」误报成「内容漂移」（两个方向相反，见 bug-030/037）。
. "$(dirname "${BASH_SOURCE[0]}")/lib-vendor.sh"
NODE_BIN="$(pi_resolve_node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "❌ 未找到可用 node（要求 >= ${PI_NODE_MIN}）——本守门需要它跑 .mjs"
  command -v node >/dev/null 2>&1 && node_version_hint
  exit 1
fi

echo "=== 约定守门（A 运行时状态不入库 / B 敏感文件不入库 / C 生产代码规范 / D 文档计数与台账一致 / E 模式资产引用成对 / F 隐私边界 / … / I 便携性 / J DSH 侧基线） ==="

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
  LEDGER_NO_CMD="$(grep -E '^\| [0-9]+ \|' docs/BUG-REPLAYS.md | grep -vE '(node |bash |npx |scripts/|my-pi\.sh|powershell |pwsh |python )' || true)"
  # 2026-10-10 补：**列数**也必须查 ✗ —— 只查"有没有可执行命令"是不够的：
  # 编译器要求 5 列（`cells.length >= 6`，knowledge-compile.mjs），而列数不足的行会被**静默跳过** ✗
  # ⇒ 症状是"守门全绿、知识库里却没有这条"（本会话真的发生过：第 17–19 行 3 列被静默丢弃 ✗✓）。
  LEDGER_BADCOLS="$(grep -E '^\| [0-9]+ \|' docs/BUG-REPLAYS.md | awk -F'|' 'NF!=7' || true)"
  if [ "${LEDGER_ROWS:-0}" -lt 5 ]; then
    bad "docs/BUG-REPLAYS.md 台账只剩 $LEDGER_ROWS 行（应 >=5；是不是被删了？）"
  if [ -n "$LEDGER_BADCOLS" ]; then
    bad "docs/BUG-REPLAYS.md 有行不是 5 列（编译器会**静默跳过**它 ⇒ 知识库里没有这条）:"
    echo "$LEDGER_BADCOLS" | head -3 | sed 's/^/      /'
  fi
  elif [ -n "$LEDGER_NO_CMD" ]; then
    bad "docs/BUG-REPLAYS.md 有 $(( $(printf '%s\n' "$LEDGER_NO_CMD" | wc -l) )) 行没有可执行命令（每行必须能重跑）："
    printf '%s\n' "$LEDGER_NO_CMD" | cut -c1-100 | sed 's/^/       /'
  else
    ok "BUG-REPLAYS 台账每行都带可执行命令（$LEDGER_ROWS 行）"
  fi
  # 换行守门（2026-10-13 补）：.gitattributes 声明了 *.sh=eol=lf / *.ps1=eol=crlf，
  # 但此前**没有守门**，于是实测两次把 pi-supervisor.sh 的 LF 写成了 CRLF。
  # 判据用 git 自己的口径（最权威），**两个方向都查**：
  #   w/crlf 而约定 lf  → 违规（.sh 带 CR）
  #   w/lf   而约定 crlf → 违规（.ps1 缺 CR）
  EOL_BAD="$(git ls-files --eol '*.sh' '*.ps1' '*.md' '*.mjs' 2>/dev/null | awk '
    {
      attr = ""
      for (i = 1; i <= NF; i++) if ($i == "attr/text") attr = $(i + 1)
      if ($2 == "w/crlf" && attr != "eol=crlf") print $NF
      else if ($2 == "w/lf" && attr == "eol=crlf") print $NF
    }' || true)"
  if [ -n "$EOL_BAD" ]; then
    bad "以下文件的换行与 .gitattributes 不符（.sh 须 LF、.ps1 须 CRLF）："
    printf '%s\n' "$EOL_BAD" | sed 's/^/       /'
  else
    ok "换行与 .gitattributes 一致（.sh 全 LF、.ps1 全 CRLF）"
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
# ★ 这里**不能用 `find -type f`**（2026-10-15 实测陷阱）：
#   本机 PRoot/FUSE 会**间歇性**把普通文件报成 `l`（符号链接）——同一路径 `find -printf '%y'`
#   上一秒 `l`、下一秒 `f`；于是 `-type f` 可能命中 **0 个**，守门就报"0 个文件，0KB"（虚假失败），
#   而任何用 `-type f` 做"有没有漏"的脚本则会**虚假通过**（更危险）。
#   稳健口径：`find -print0` 列条目，再用 `[ -f ]`（stat）判类型。
mode_asset_files() {
  find "$MODE_ASSETS_DIR" -print0 2>/dev/null | while IFS= read -r -d '' p; do
    [ -f "$p" ] || continue
    case "$p" in */README.md) continue ;; esac
    printf '%s\n' "$p"
  done
}
if [ -d "$MODE_ASSETS_DIR" ]; then
  ASSET_PATHS="$(mode_asset_files)"
  ASSET_FILES="$(printf '%s\n' "$ASSET_PATHS" | while IFS= read -r p; do [ -n "$p" ] && basename "$p"; done | sort)"
  # 2026-10-12 修：原模式的否定字符类里放了全角标点（（）,，）。在 C.UTF-8 locale 下
  # grep 把 UTF-8 按**字节**处理，那个类会把整个中文件名吞掉 —— 实测 8 个资产只认出 3 个，
  # 甚至匹配不了本行自己的文件名，于是 5 个真实存在的引用被误判成"孤儿资产"。
  # 改为锚定真实引用形态（反引号包裹），只用 ASCII，不依赖 locale。
  ASSET_REFS="$(grep -rhoE '`[0-9]{2}-[^`]+\.(png|jpe?g|webp|gif)`' portable/agent/modes --include='*.md' 2>/dev/null | tr -d '`' | sort -u || true)"
  MISSING_REFS=""
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    printf '%s\n' "$ASSET_FILES" | grep -qxF "$ref" || MISSING_REFS="$MISSING_REFS
       $ref"
  done <<< "$ASSET_REFS"
  ORPHANS="$(printf '%s\n' "$ASSET_FILES" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    printf '%s\n' "$ASSET_REFS" | grep -qxF "$f" || echo "       $f"
  done)"
  ASSET_BYTES="$(printf '%s\n' "$ASSET_PATHS" | while IFS= read -r p; do [ -n "$p" ] && stat -c %s "$p" 2>/dev/null; done | awk '{s+=$1} END{print s+0}')"
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
if "$NODE_BIN" -e '
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
  if "$NODE_BIN" scripts/knowledge-compile.mjs --check >/dev/null 2>&1; then
    ok "知识库与源证据一致（docs/knowledge/）"
  else
    bad "docs/knowledge/ 已漂移（跑 node scripts/knowledge-compile.mjs --update 后提交）"
  fi
fi
if [ -f scripts/gen-doc-index.mjs ]; then
  if "$NODE_BIN" scripts/gen-doc-index.mjs --check >/dev/null 2>&1; then
    ok "知识索引与源文档一致（docs/INDEX.md）"
  else
    bad "docs/INDEX.md 已漂移（跑 node scripts/gen-doc-index.mjs --update 后提交）"
  fi
fi
if [ -f scripts/gen-changes-ledger.mjs ]; then
  if "$NODE_BIN" scripts/gen-changes-ledger.mjs --check >/dev/null 2>&1; then
    ok "改动台账与 git 历史一致（docs/CHANGES.jsonl）"
  else
    bad "docs/CHANGES.jsonl 已漂移（跑 node scripts/gen-changes-ledger.mjs --update 后提交）"
  fi
fi

# ── G. packs 内部链接（既有 check-doc-links **有意排除 packs/** ⇒ 这里补上）──
# 为什么单独一条：packs 是 vendored 外部技能包，链接长期无回归保护（一次改名就能让文档指向不存在的目标）。
# 判定口径与上游 reverse-skill 自己的 verify-doc-links.py 一致（相对链接、跳过围栏代码、命中集合 = git 跟踪文件∪目录），
# 但按**本仓的 vendored 布局**（packs/<pkg>/…）判定 —— 上游脚本假定 cwd=它自己的仓库根，在 vendored 下会误读父仓。
if [ -f scripts/check-packs-links.mjs ]; then
  if packs_out=$("$NODE_BIN" scripts/check-packs-links.mjs 2>&1); then
    ok "${packs_out#✓ }"
  else
    bad "packs 内部链接有断链（跑 node scripts/check-packs-links.mjs 看明细）"
    printf '%s\n' "$packs_out" | head -10 | sed 's/^/      /'
  fi
else
  bad "缺少 scripts/check-packs-links.mjs（packs 链接守门）"
fi

# ── H. packs 结构（README 里已成文的约定 ⇒ 变成断言；见脚本文件头"为什么需要它"）──
# 起因（2026-10-15 全量体检）：① README 的经验沉淀计数写着 13、实测 17（数字会被人当基线照抄）；
# ② reverse-skill 同步上游时，git add 被 .gitignore 静默吞掉两个**上游已跟踪**的文件（不报错、git status 也看不见）。
# 两次都属"沉默出错"，所以 R1–R7 里既有结构断言，也有"packs 下不得有未跟踪文件"这条兜底。
if [ -f scripts/check-packs-structure.mjs ]; then
  if packs_s_out=$("$NODE_BIN" scripts/check-packs-structure.mjs 2>&1); then
    ok "${packs_s_out#✓ }"
  else
    bad "packs 结构不符约定（跑 node scripts/check-packs-structure.mjs 看明细）"
    printf '%s\n' "$packs_s_out" | head -10 | sed 's/^/      /'
  fi
else
  bad "缺少 scripts/check-packs-structure.mjs（packs 结构守门）"
fi

# ── I. 便携性（"项目相关内容都在仓库内、随项目移动"）──
# 起因（2026-10-15 实测）：Linux 侧此前"能跑但不可搬"——Node 在 ~/.local/share/pi-node、
# SearXNG 在 /opt/searxng、whisper/sherpa 的 venv 在 /opt/*、npm 缓存写 ~/.npm。
# 这些**都不会报错**，只在换机器/换路径时集中爆出来。判据与"为什么"见脚本文件头。
if [ -f scripts/check-portability.sh ]; then
  if port_out="$(bash scripts/check-portability.sh 2>&1)"; then
    ok "$(printf '%s' "$port_out" | grep -E '^🎉' | sed 's/^🎉 //')"
  else
    bad "便携性守门未通过（跑 bash scripts/check-portability.sh 看明细）"
    printf '%s\n' "$port_out" | grep -E '❌' | head -6 | sed 's/^/      /'
  fi
else
  bad "缺少 scripts/check-portability.sh（便携性守门）"
fi

# ── J. DSH 侧基线（分支 feat/base-switch-dsh 的产物；依赖/产物在才跑，否则跳过）──
# ★ 纪律：**没有守门的地方，错误不会被发现，只会被传播**。工具声明面与注入面的基线
#   在 `dsh/baseline/*.json`，这里做**条件守门**：装了 spike 依赖并构建了产物就比对，
#   否则明确打印"跳过"（而不是静默算通过）。
if [ -d dsh/spike/node_modules/@deepseek-ai/dsh-tools ] && [ -f dsh/plugin/dist/my-pi-plugin.mjs ]; then
  dsh_fail=0
  if ! node dsh/spike/measure-surface.mjs --check >/tmp/dsh-baseline-tools.out 2>&1; then
    dsh_fail=1
    bad "DSH 工具声明面相对基线漂移（明细见 /tmp/dsh-baseline-tools.out；确认有意后跑 node dsh/spike/measure-surface.mjs --update）"
  fi
  if ! node dsh/spike/measure-prompt.mjs --check >/tmp/dsh-baseline-prompt.out 2>&1; then
    dsh_fail=1
    bad "DSH 注入面相对基线漂移（明细见 /tmp/dsh-baseline-prompt.out；确认有意后跑 node dsh/spike/measure-prompt.mjs --update）"
  fi
  if [ "$dsh_fail" -eq 0 ]; then
    ok "DSH 侧基线一致（工具声明面 + 注入面；dsh/baseline/*.json）"
  fi
else
  note "DSH 侧基线跳过（缺 dsh/spike/node_modules 或 dsh/plugin/dist 产物；跑 bash scripts/dsh-build.sh 与 scripts/dsh-spike.sh 后自动生效）"
fi

# ── K. dsh/plugin 的类型检查（条件：DSH 包在才跑，否则跳过）──
# ★ 为什么需要单独一段：官方的 `tsc -p custom/` 只收 custom/**（无 include ⇒ 按 tsconfig 所在
#   目录收文件）⇒ `dsh/` 长期只过 esbuild/tsx（**不做类型检查**），类型错误会一直积累。
#   2026-10-18 手工 typecheck 就抓到 `facade.disposers.push(...)` 与 `readonly DshDisposer[]`
#   冲突（两处）——那正是插件入口每次启动都要跑的一行。
# ★ 为什么条件跑：`dsh/plugin/entry.ts` 会 import `@deepseek-ai/*`，而那是 `dsh-spike.sh`
#   按需安装的；没装时报的是 `Cannot find module`（环境缺失，不是代码错误）⇒ 明确跳过。
if [ -d dsh/spike/node_modules/@deepseek-ai ]; then
  if npx tsc -p dsh/ >/tmp/dsh-tsc.out 2>&1; then
    ok "dsh/plugin 类型检查通过（dsh/tsconfig.json）"
  else
    bad "dsh/plugin 类型检查失败（见 /tmp/dsh-tsc.out；跑 npx tsc -p dsh/ 复现）"
  fi
else
  note "dsh/plugin 类型检查跳过（缺 dsh/spike/node_modules/@deepseek-ai；跑 bash scripts/dsh-spike.sh 后自动生效）"
fi

# ── L. Markdown 表体完整性（程序化编辑把表格行写断 / 台账表体空行）──
# ★ 为什么有这一段（两份同源事故）：
#   ① `BUG-REPLAYS.md` #33：台账表体被插空行 ⇒ 人眼仍看成一张表，按行解析的工具当成多张。
#      当时结论是"建议后续加这条守门"，一直没加。
#   ② 2026-10-18 自己踩到：用脚本改 `DSH-MIGRATION-PLAN.md` 时把**一行**表格写成 4 行、续行还带
#      前导空格 + 单引号 ⇒ 那行在渲染里断成普通文本（该表少一条实测记录），而**当时所有守门都放行**。
# ★ 判据放在 `scripts/check-md-tables.mjs` 里（要跳过围栏代码块、要排除 vendored 的 packs/，
#   用 grep 表达不了 —— 直接 grep 会误报 60+ 个合法文件）。台账空行只报告不失败：实测
#   `knowledge-compile --check` 在 3 处空行下仍解析出 41/41 条 ⇒ 做成硬门禁属于无证据。
if [ -f scripts/check-md-tables.mjs ]; then
  if "$NODE_BIN" scripts/check-md-tables.mjs >/tmp/md-tables.out 2>&1; then
    ok "Markdown 表体完整（表行未被写断；明细见 /tmp/md-tables.out）"
  else
    bad "Markdown 表体守门失败（表行被写断；明细见 /tmp/md-tables.out）"
  fi
fi

# ── M. assistant/（拼接架构那一层）的静态守门 ──
# ★ 为什么需要：`custom/` 与 `dsh/` 都有各自 tsconfig 守门，而 assistant/ 是新增的一层
#   （原生客户端 + pi-tui 渲染 + 自写插件），不纳入就等于"新代码没人拦"。
# ★ 为什么只做静态检查（不跑 verify-m1.sh）：真跑要起宿主 + 占端口，会打扰正在用的实例；
#   端到端验收是 `assistant/scripts/verify-m1.sh`，由人和 pre-push 之外的场景显式触发。
if [ -f assistant/tsconfig.json ] && [ -d node_modules/@deepseek-ai ]; then
  if npx tsc -p assistant/tsconfig.json >/tmp/assistant-tsc.out 2>&1; then
    ok "assistant 插件类型检查通过（assistant/tsconfig.json）"
  else
    bad "assistant 插件类型检查失败（见 /tmp/assistant-tsc.out）"
  fi
  # ★ 编码 CODING-TRAPS #23：插件就近 package.json 有 name 缺 version ⇒ 每个 DeepSeek 请求
  #   都以 REQUEST_EXTENSION 静默失败。这条用一行断言把那次事故钉住。
  if "$NODE_BIN" -e "const p=require('./assistant/package.json');process.exit(p.name&&p.version?0:1)"; then
    ok "assistant/package.json 有 name+version（TRAPS #23 的硬条件）"
  else
    bad "assistant/package.json 缺 name 或 version ⇒ 在线模型会以 REQUEST_EXTENSION 全线失败"
  fi
  if node --check assistant/src/transport.mjs >/dev/null 2>&1 \
     && node --check assistant/src/tui.mjs >/dev/null 2>&1 \
     && node --check assistant/host/launch.mjs >/dev/null 2>&1 \
     && node --check assistant/spike/mock-openai.mjs >/dev/null 2>&1; then
    ok "assistant 的 .mjs 语法检查通过"
  else
    bad "assistant 的 .mjs 有语法错误（node --check 复现）"
  fi
  # ★ 接缝预算：宿主只允许在 plugin/entry.ts 里被 import（这是"可替换性"的可回归度量）。
  stray="$(grep -rl "@deepseek-ai/" assistant/src assistant/bin assistant/host 2>/dev/null | tr '\n' ' ')"
  if [ -z "$stray" ]; then
    ok "接缝预算：宿主 import 只出现在 plugin/entry.ts"
  else
    bad "接缝预算被突破：这些文件 import 了 @deepseek-ai/* ⇒ $stray"
  fi
  # 行数预算：超出即报警（不是警告后继续）。
  seam_lines="$(cat assistant/src/*.mjs assistant/bin/*.mjs assistant/host/*.mjs 2>/dev/null | wc -l)"
  if [ "$seam_lines" -le 900 ]; then
    ok "接缝行数 $seam_lines ≤ 900"
  else
    bad "接缝行数 $seam_lines 超过预算 900（新增的耦合要给出理由并显式抬预算）"
  fi
else
  note "assistant 静态守门跳过（缺 assistant/tsconfig.json 或 node_modules/@deepseek-ai）"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 约定守门全部通过"
  exit 0
fi
echo "❌ 约定守门失败 $FAIL 项"
exit 1