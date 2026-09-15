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
if [ -d "$PROJECT_DIR/.pi/agent" ]; then
    warn "配置目录已存在: $PROJECT_DIR/.pi/agent"
    read -p "是否继续？(y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "已取消"
        exit 0
    fi
fi

# 创建配置目录结构
echo ""
info "创建配置目录结构..."
mkdir -p "$PROJECT_DIR/.pi/agent/extensions"
mkdir -p "$PROJECT_DIR/.pi/agent/services"
mkdir -p "$PROJECT_DIR/.pi/agent/sessions"
mkdir -p "$PROJECT_DIR/.pi/agent/stats"
mkdir -p "$PROJECT_DIR/.pi/agent/core"
mkdir -p "$PROJECT_DIR/.pi/scripts"
mkdir -p "$PROJECT_DIR/.pi/packs"
mkdir -p "$PROJECT_DIR/.pi/deploy"
mkdir -p "$PROJECT_DIR/.pi/data"
mkdir -p "$PROJECT_DIR/.pi/logs"
ok "配置目录结构创建完成"

# 复制默认配置文件
echo ""
info "复制默认配置文件..."
for file in settings.json modes.json keybindings.json scheduled-seeds.json; do
    if [ -f "$PROJECT_DIR/custom/config/$file" ]; then
        cp "$PROJECT_DIR/custom/config/$file" "$PROJECT_DIR/.pi/agent/"
        ok "$file"
    fi
done

# 复制扩展和服务
echo ""
info "复制扩展和服务..."
[ -d "$PROJECT_DIR/custom/extensions" ] && cp -r "$PROJECT_DIR/custom/extensions/"* "$PROJECT_DIR/.pi/agent/extensions/" 2>/dev/null && ok "extensions"
[ -d "$PROJECT_DIR/custom/services" ] && cp -r "$PROJECT_DIR/custom/services/"* "$PROJECT_DIR/.pi/agent/services/" 2>/dev/null && ok "services"

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
echo "  1. 运行构建脚本: ./scripts/core/rebuild.sh"
echo "  2. 验证安装: mypi --list-models"
echo ""
