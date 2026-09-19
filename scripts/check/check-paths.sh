#!/usr/bin/env bash
# ============================================================
# check-paths.sh — 路径一致性检查
# 检查脚本中是否存在硬编码的旧路径引用
# 用法: bash scripts/check/check-paths.sh [--fix]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

# 旧路径模式（应该被替换）
LEGACY_PATTERNS=(
  'PI_HOME/agent/extensions'
  'PI_HOME/agent/settings'
  'PI_HOME/agent/models'
  'PI_HOME/agent/auth'
  'PI_HOME/agent/modes'
  'PI_HOME/agent/pi-voice'
  'PI_HOME/agent/node_modules'
  '\.pi/agent/extensions'
  '\.pi/agent/settings'
  '\.pi/agent/models'
)

# 允许的旧路径（特定场景保留）
ALLOWED_PATTERNS=(
  'PI_HOME/agent/bin'  # fd/rg 符号链接
)

# 检查单个文件
check_file() {
  local file="$1"
  local fix_mode="${2:-0}"
  local issues=0

  for pattern in "${LEGACY_PATTERNS[@]}"; do
    # 检查是否是允许的模式
    local allowed=0
    for allowed_pattern in "${ALLOWED_PATTERNS[@]}"; do
      if [[ "$pattern" == "$allowed_pattern" ]]; then
        allowed=1
        break
      fi
    done

    if [ "$allowed" = "0" ]; then
      local matches
      matches=$(grep -n "$pattern" "$file" 2>/dev/null || true)
      if [ -n "$matches" ]; then
        if [ "$fix_mode" = "1" ]; then
          warn "发现旧路径: $file"
          echo "$matches" | head -5
        else
          fail "发现旧路径: $file"
          echo "$matches" | head -5
        fi
        issues=$((issues+1))
      fi
    fi
  done

  return $issues
}

# 主函数
main() {
  local fix_mode=0
  local total_issues=0

  if [ "${1:-}" = "--fix" ]; then
    fix_mode=1
    echo "=== 路径检查（修复模式）==="
  else
    echo "=== 路径检查 ==="
  fi

  echo ""
  echo "检查脚本目录: $SCRIPTS_DIR"
  echo ""

# 检查所有 shell 脚本（排除自身和 paths.sh）
while IFS= read -r file; do
  if [[ "$file" == *check-paths.sh ]] || [[ "$file" == *paths.sh ]]; then continue; fi
  if ! check_file "$file" "$fix_mode"; then
    total_issues=$((total_issues+1))
  fi
done < <(find "$SCRIPTS_DIR" -name "*.sh" -type f 2>/dev/null)

# 检查所有 mjs 脚本
while IFS= read -r file; do
  if ! check_file "$file" "$fix_mode"; then
    total_issues=$((total_issues+1))
  fi
done < <(find "$SCRIPTS_DIR" -name "*.mjs" -type f 2>/dev/null)

  echo ""
  if [ "$total_issues" -eq 0 ]; then
    ok "未发现旧路径引用"
  else
    fail "发现 $total_issues 个文件包含旧路径引用"
    echo ""
    echo "修复方法:"
    echo "  1. 手动修复: 将旧路径替换为新路径"
    echo "  2. 使用 paths.sh 中的变量替代硬编码路径"
    echo "  3. 参考: docs/maintenance/LESSONS-LEARNED.md"
  fi

  return $total_issues
}

# 运行主函数
main "$@"
