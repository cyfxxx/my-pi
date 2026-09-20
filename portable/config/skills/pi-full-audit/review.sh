#!/bin/bash
# my-pi pi-full-audit review.sh — 确定性检查脚本（只读，不修改任何文件）
#
# 用法:
#   bash review.sh                 # 审查 git 工作区变更（HEAD + 未跟踪文件）
#   bash review.sh --all <dir>     # 跳过 git，扫描目录内全部源码/配置文件
#   bash review.sh --selfcheck     # 技能自检（文件完整性 + 启用状态）
#   bash review.sh --help          # 用法说明
#
# 检查项: git 卫生 / JSON 合法性 / 隔离边界（npm run check）/ 类型检查（tsc --noEmit）
#         / 可疑模式与密钥模式
# 退出码恒为 0（只报告，不阻断审查者判断；判定以阶段汇总计数为准）。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$SCRIPT_DIR"
AGENT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"      # portable/config
DEFAULT_ROOT="$(cd "$AGENT_DIR/../.." && pwd)"    # my-pi 项目根

# 项目根识别：默认取技能所在仓库；结构不符时回退当前目录
PROJECT_ROOT="$DEFAULT_ROOT"
if [ ! -d "$PROJECT_ROOT/custom" ] || [ ! -d "$PROJECT_ROOT/portable" ]; then
  PROJECT_ROOT="$(pwd)"
fi
export REVIEW_ROOT="$PROJECT_ROOT"

MODE="diff"
SCAN_DIR=""
PASS=0; WARN=0; FAIL=0; SKIP=0

say()  { printf '%s\n' "$*"; }
ok()   { say "  [✓] $*"; PASS=$((PASS+1)); }
warn() { say "  [⚠] $*"; WARN=$((WARN+1)); }
fail() { say "  [✗] $*"; FAIL=$((FAIL+1)); }
skip() { say "  [–] $*"; SKIP=$((SKIP+1)); }

usage() {
  cat <<'EOF'
my-pi pi-full-audit 确定性检查
  默认: 审查 git 工作区变更（HEAD 与未跟踪文件）
  --all <dir>   扫描目录内全部源码/配置文件（无需 git）
  --selfcheck   技能自检（文件完整性 + settings.json 启用状态）
  --help        显示本帮助

检查项: git 卫生 / JSON 合法性 / 隔离边界（npm run check）/ 类型检查（tsc --noEmit）
        / 可疑模式与密钥模式
说明: 只报告不修改，退出码恒为 0。大目录全量扫描耗时，建议重定向落盘后再分析：
      bash review.sh --all /root/my-pi > /tmp/review.log 2>&1
EOF
}

for arg in "$@"; do
  case "$arg" in
    --help) usage; exit 0 ;;
    --selfcheck) MODE="selfcheck" ;;
    --all) MODE="all" ;;
    --all=*) MODE="all"; SCAN_DIR="${arg#--all=}" ;;
    --*) say "未知参数: $arg（用 --help 查看用法）"; exit 0 ;;
    *) [ "$MODE" = "all" ] && SCAN_DIR="$arg" ;;
  esac
done

# ---------- 自检模式 ----------
if [ "$MODE" = "selfcheck" ]; then
  say "== pi-full-audit 技能自检 =="
  REQUIRED=(
    SKILL.md MODULES.md WORKFLOW.md CHECKLIST.md REPORT.md improvements.md review.sh
    references/RUNTIME-CHECK.md references/ERROR-CHECKLIST.md references/EXPERIENCE-BASELINE.md
  )
  for f in "${REQUIRED[@]}"; do
    if [ -f "$SKILL_DIR/$f" ]; then ok "存在 $f"; else fail "缺失 $f"; fi
  done
  if [ -x "$SKILL_DIR/review.sh" ]; then
    ok "review.sh 可执行"
  else
    warn "review.sh 无可执行位（用 bash review.sh 调用不受影响）"
  fi
  SETTINGS="$AGENT_DIR/settings.json"
  if [ -f "$SETTINGS" ] && grep -q 'skills/pi-full-audit/SKILL.md' "$SETTINGS"; then
    ok "settings.json 已启用本技能（+skills/pi-full-audit/SKILL.md）"
  else
    warn "settings.json 未找到本技能启用项（+skills/pi-full-audit/SKILL.md）"
  fi
  if git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    dirty=$(git -C "$PROJECT_ROOT" status --porcelain -- "$SKILL_DIR" 2>/dev/null | wc -l)
    if [ "$dirty" -eq 0 ]; then ok "技能目录无未提交改动"; else warn "技能目录有 $dirty 项未提交改动"; fi
  else
    skip "git 仓库"
  fi
  say ""
  say "自检完成。"
  exit 0
fi

# ---------- 收集待审文件 ----------
declare -a FILES=()
if [ "$MODE" = "diff" ]; then
  if ! git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    say "项目根不是 git 仓库: $PROJECT_ROOT"
    exit 0
  fi
  say "== 审查范围: my-pi 工作区变更（HEAD + 未跟踪） =="
  say "项目根: $PROJECT_ROOT"
  # -z 分隔 + 解析两字段：重命名行取新路径；未跟踪目录展开为目录内文件
  mapfile -t FILES < <(git -C "$PROJECT_ROOT" status --porcelain -z | python3 -c '
import sys, os
root = os.environ["REVIEW_ROOT"]
data = sys.stdin.buffer.read().split(b"\0")
i = 0
out = []
while i < len(data):
    entry = data[i]
    if not entry:
        i += 1
        continue
    parts = entry.split(b" ", 1)
    xy = parts[0].decode()
    rest = parts[1] if len(parts) > 1 else b""
    path = rest.decode()
    i += 1
    if xy.startswith("R"):
        if i < len(data) and data[i]:
            path = data[i].decode()
            i += 1
    p = os.path.join(root, path)
    if os.path.isdir(p) and not xy.startswith("D"):
        for r, _d, fs in os.walk(p):
            for f in fs:
                out.append(os.path.join(r, f))
    elif not xy.startswith("D") and os.path.isfile(p):
        out.append(p)
print("\n".join(out))
' 2>/dev/null | grep -v '^$')
else
  [ -n "$SCAN_DIR" ] || { say "请指定目录: --all <dir>"; exit 0; }
  [ -d "$SCAN_DIR" ] || { say "目录不存在: $SCAN_DIR"; exit 0; }
  SCAN_DIR="$(cd "$SCAN_DIR" && pwd)"
  say "== 审查范围: $SCAN_DIR =="
  # 排除第三方依赖与运行时数据（node_modules/vendor/构建产物/会话/归档），避免拖垮扫描
  mapfile -t FILES < <(find "$SCAN_DIR" -type f \
    \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.sh' \
       -o -name '*.json' -o -name '*.yml' -o -name '*.yaml' -o -name '.env' -o -name '.env.*' \) \
    ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/custom/dist/*' \
    ! -path '*/vendor/pi/*' ! -path '*/.artifacts/*' ! -path '*/coverage/*' \
    ! -path '*/portable/sessions/*' ! -path '*/portable/memory/*' \
    ! -path '*/portable/extensions/*' ! -path '*/portable/config/sessions/*' \
    2>/dev/null)
  TOTAL_FILES=$(find "$SCAN_DIR" -type f \
    \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.sh' \
       -o -name '*.json' -o -name '*.yml' -o -name '*.yaml' \) \
    ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/custom/dist/*' \
    ! -path '*/vendor/pi/*' 2>/dev/null | wc -l)
  say "扫描预览: 源码/配置文件 $TOTAL_FILES 个（已排除 node_modules/vendor/pi/custom-dist/运行时数据）"
  if [ "$TOTAL_FILES" -gt 300 ]; then
    say "  目录分布（前 15）:"
    printf '%s\n' "${FILES[@]:-}" | sed "s|$SCAN_DIR/||" | cut -d/ -f1-2 | sort | uniq -c | sort -rn | head -15
  fi
fi

# 过滤掉删除的文件（仅剩磁盘上存在的）
declare -a EXISTING=()
for f in "${FILES[@]:-}"; do
  [ -n "$f" ] && [ -f "$f" ] && EXISTING+=("$f")
done
FILES=("${EXISTING[@]:-}")

if [ "${#FILES[@]}" -eq 0 ]; then
  say "没有可审查的文件（无变更或目录为空）。"
  exit 0
fi
say "待审文件: ${#FILES[@]} 个"

file_ext() { echo "${1##*.}"; }
is_shell() {
  case "$1" in
    *.sh|*.bash) return 0 ;;
  esac
  head -c 100 "$1" 2>/dev/null | grep -q '#!/.*\(bash\|sh\)'
}
rel() { printf '%s' "${1#$PROJECT_ROOT/}"; }

# ---------- 阶段 A: Git 卫生 ----------
say ""
say "== 阶段 A: Git 卫生 =="
if [ "$MODE" = "diff" ]; then
  if git -C "$PROJECT_ROOT" diff --check >/dev/null 2>&1; then
    ok "git diff --check 无空白错误"
  else
    fail "git diff --check 发现空白错误（行尾空格/尾随空白行）:"
    git -C "$PROJECT_ROOT" diff --check 2>&1 | sed 's/^/      /' | head -20
  fi

  # vendor/pi 只读约束
  if [ -d "$PROJECT_ROOT/vendor/pi/.git" ]; then
    vd=$(git -C "$PROJECT_ROOT/vendor/pi" status --porcelain 2>/dev/null | wc -l)
    if [ "$vd" -eq 0 ]; then ok "vendor/pi 干净（只读约束）"; else fail "vendor/pi 有 $vd 项改动（禁止直接修改，应经 patches/ 管理）"; fi
  elif [ -d "$PROJECT_ROOT/vendor/pi" ]; then
    vd=$(git -C "$PROJECT_ROOT" status --porcelain -- vendor/pi 2>/dev/null | wc -l)
    if [ "$vd" -eq 0 ]; then ok "vendor/pi 干净（只读约束）"; else fail "vendor/pi 有 $vd 项改动（禁止直接修改）"; fi
  else
    skip "vendor/pi 未引导（fresh checkout 需先 bash scripts/build.sh）"
  fi

  # portable 运行时数据误入库
  runtime_tracked=0
  while IFS= read -r f; do
    case "$f" in
      portable/sessions/*|portable/memory/*|portable/extensions/*)
        fail "运行时数据被 git 跟踪: $f"; runtime_tracked=1 ;;
      portable/config/*)
        case "${f##*/}" in
          settings.json|keybindings.json|AGENTS.md|APPEND_SYSTEM.md|.gitkeep) ;;
          *) fail "portable/config 运行时文件被 git 跟踪: $f"; runtime_tracked=1 ;;
        esac ;;
    esac
  done < <(git -C "$PROJECT_ROOT" ls-files -- portable 2>/dev/null)
  [ "$runtime_tracked" = "0" ] && ok "portable/ 运行时数据未被跟踪"

  # 大文件/二进制
  big=0
  for f in "${FILES[@]:-}"; do
    case "$f" in
      */node_modules/*|*/custom/dist/*|*/vendor/pi/*) continue ;;
    esac
    size=$(stat -c%s "$f" 2>/dev/null || echo 0)
    if [ "$size" -gt 1048576 ]; then
      big=1
      warn "大文件（>1MB, ${size} 字节）: $(rel "$f")"
    fi
    if file "$f" 2>/dev/null | grep -q 'binary'; then
      big=1
      warn "二进制文件: $(rel "$f")"
    fi
  done
  [ "$big" = "0" ] && ok "无大文件/二进制文件入库"
else
  skip "git 卫生（--all 模式跳过）"
fi

# ---------- 阶段 A2: 密钥扫描（脱敏） ----------
say ""
say "== 阶段 A2: 疑似密钥扫描（仅报告位置） =="
SECRET_PAT='((^|[^A-Za-z0-9])sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|gho_[A-Za-z0-9]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|password[[:space:]]*[:=][[:space:]]*[^[:space:]]+|api[_-]?key[[:space:]]*[:=][[:space:]]*[^[:space:]]+|secret[[:space:]]*[:=][[:space:]]*[^[:space:]]+)'
found=0
for f in "${FILES[@]:-}"; do
  case "$f" in
    *.lock|*package-lock.json|*pnpm-lock.yaml) continue ;;
    */node_modules/*|*/vendor/pi/*|*/custom/dist/*) continue ;;
  esac
  [ -f "$f" ] || continue
  # 排除示例/测试/文档（命中多为占位）
  case "$f" in
    *test*|*spec*|*/examples/*|*/docs/*|*/tests/*) continue ;;
  esac
  if grep -qE "$SECRET_PAT" "$f" 2>/dev/null; then
    found=1
    while IFS= read -r line; do
      num=${line%%:*}
      content=${line#*:}
      hit=$(echo "$content" | grep -oE '(^|[^A-Za-z0-9])sk-[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|AKIA[A-Z0-9]+|gho_[A-Za-z0-9]+|BEGIN [A-Z ]*PRIVATE KEY|password|api[_-]?key|secret' | head -1 | sed -E 's/^([^A-Za-z0-9])?sk-/sk-/')
      fail "$(rel "$f"):$num: [已脱敏] 疑似密钥/凭据（$hit********）"
    done < <(grep -nE "$SECRET_PAT" "$f" 2>/dev/null | head -5)
  fi
done
[ "$found" = "0" ] && ok "未发现疑似密钥/凭据"

# ---------- 阶段 B: JSON 合法性 / Shell 语法 ----------
say ""
say "== 阶段 B: JSON 合法性 / Shell 语法 =="
if command -v python3 >/dev/null 2>&1; then
  json_err=0
  for f in "${FILES[@]:-}"; do
    case "$f" in
      *.json) ;;
      *) continue ;;
    esac
    case "$f" in
      *package-lock.json|*pnpm-lock.yaml) continue ;;
    esac
    if ! python3 -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8'))" "$f" >/dev/null 2>&1; then
      json_err=1
      fail "JSON 解析错误: $(rel "$f")"
    fi
  done
  [ "$json_err" = "0" ] && ok "JSON 解析通过"
else
  skip "python3（JSON 检查）"
fi

if command -v bash >/dev/null 2>&1; then
  sh_err=0
  for f in "${FILES[@]:-}"; do
    if is_shell "$f"; then
      if ! bash -n "$f" >/dev/null 2>&1; then
        sh_err=1
        fail "Shell 语法错误: $(rel "$f")"
      fi
    fi
  done
  [ "$sh_err" = "0" ] && ok "Shell 语法检查通过"
else
  skip "bash（Shell 语法检查）"
fi

# ---------- 阶段 C: 隔离边界（npm run check） ----------
say ""
say "== 阶段 C: 隔离边界（npm run check） =="
if [ "$MODE" = "all" ] && [ "$SCAN_DIR" != "$PROJECT_ROOT" ]; then
  skip "扫描目录非项目根，跳过隔离边界检查"
elif [ ! -f "$PROJECT_ROOT/package.json" ]; then
  skip "无 package.json"
elif ! command -v npm >/dev/null 2>&1; then
  skip "npm 未安装"
elif ! grep -q '"check"' "$PROJECT_ROOT/package.json"; then
  skip "package.json 无 check 脚本"
else
  out=$(cd "$PROJECT_ROOT" && npm run check 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "npm run check（scripts/check-isolation.sh）通过"
  else
    fail "npm run check 失败（exit=$rc）:"
    echo "$out" | sed 's/^/      /' | tail -20
  fi
fi

# ---------- 阶段 D: 类型检查（tsc --noEmit） ----------
say ""
say "== 阶段 D: 类型检查（tsc --noEmit -p custom/） =="
if [ "$MODE" = "all" ] && [ "$SCAN_DIR" != "$PROJECT_ROOT" ]; then
  skip "扫描目录非项目根，跳过类型检查"
elif [ ! -f "$PROJECT_ROOT/custom/tsconfig.json" ]; then
  skip "无 custom/tsconfig.json"
elif ! command -v npx >/dev/null 2>&1; then
  skip "npx 未安装"
else
  out=$(cd "$PROJECT_ROOT" && npx tsc --noEmit -p custom/ 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "类型检查通过（custom/）"
  else
    fail "类型检查失败（exit=$rc）:"
    echo "$out" | sed 's/^/      /' | tail -30
  fi
fi

# ---------- 阶段 E: 可疑模式 ----------
say ""
say "== 阶段 E: 可疑模式标记（供人工判断） =="
# 说明：features/*/index.ts 的 console.log 是模块注册日志，属正常，不计入本阶段
c_found=0
for f in "${FILES[@]:-}"; do
  [ -f "$f" ] || continue
  case "$f" in
    */node_modules/*|*/vendor/pi/*|*/custom/dist/*|*package-lock.json) continue ;;
  esac
  hits=$(grep -nE '(debugger|TODO|FIXME|HACK|\beval\(|child_process|rm[[:space:]]+-rf|dangerouslySetInnerHTML|innerHTML)' "$f" 2>/dev/null | head -5)
  if [ -n "$hits" ]; then
    c_found=1
    say "  [i] $(rel "$f"):"
    echo "$hits" | sed 's/^/      /'
  fi
done
[ "$c_found" = "0" ] && ok "未发现可疑残留标记"

# ---------- 汇总 ----------
say ""
say "== 汇总 =="
say "  通过: $PASS | 警告: $WARN | 失败: $FAIL | 跳过: $SKIP"
if [ "$FAIL" = "0" ]; then
  say "结论: 确定性检查全部通过。请继续按 SKILL.md 检查清单进行人工审查。"
else
  say "结论: 存在 $FAIL 项确定性失败，请先按 references/ERROR-CHECKLIST.md 定性，再进入人工审查。"
fi
exit 0
