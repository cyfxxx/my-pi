#!/usr/bin/env bash
# ============================================================
# setup-config.sh — 配置目录初始化脚本
# 在项目目录中创建 .pi 配置目录，并创建符号链接 ~/.pi -> 项目目录/.pi
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  配置目录初始化脚本${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
info "项目目录: $PROJECT_DIR"

# 检查是否已存在配置目录
if [ -f "$PROJECT_DIR/.pi/settings.json" ]; then
    warn "配置目录已存在: $PROJECT_DIR/.pi/"
    read -p "是否继续？(y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "已取消"
        exit 0
    fi
fi

# 创建配置目录结构（扁平化，无 agent/ 嵌套）
echo ""
info "创建配置目录结构..."
mkdir -p "$PROJECT_DIR/.pi/extensions"
mkdir -p "$PROJECT_DIR/.pi/services"
mkdir -p "$PROJECT_DIR/.pi/sessions"
mkdir -p "$PROJECT_DIR/.pi/stats"
mkdir -p "$PROJECT_DIR/.pi/core"
mkdir -p "$PROJECT_DIR/.pi/skills"
mkdir -p "$PROJECT_DIR/.pi/data"
mkdir -p "$PROJECT_DIR/.pi/logs"
ok "配置目录结构创建完成"

# 创建符号链接
echo ""
info "创建 ~/.pi 符号链接..."

# 备份旧的 ~/.pi
if [ -L "$HOME/.pi" ]; then
    rm "$HOME/.pi"
    ok "删除旧符号链接"
elif [ -d "$HOME/.pi" ]; then
    mv "$HOME/.pi" "$HOME/.pi.bak.$(date +%Y%m%d%H%M%S)"
    ok "备份旧目录到 ~/.pi.bak.$(date +%Y%m%d%H%M%S)"
fi

ln -sf "$PROJECT_DIR/.pi" "$HOME/.pi"
ok "符号链接创建完成: ~/.pi -> $PROJECT_DIR/.pi"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  配置目录初始化完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "配置目录: $PROJECT_DIR/.pi"
echo "符号链接: ~/.pi -> $PROJECT_DIR/.pi"
echo ""
echo "下一步："
echo "  1. 运行构建: npm run build:offline"
echo "  2. 运行环境配置: ./scripts/setup-env.sh"
echo "  3. 验证安装: mypi --list-models"
echo ""
