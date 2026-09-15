#!/usr/bin/env bash
# ============================================================
# migrate-config.sh — 配置迁移脚本
# 从 ~/.pi 迁移到项目目录 .pi，并创建符号链接
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
echo -e "${CYAN}  配置迁移脚本${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
info "项目目录: $PROJECT_DIR"

# 检查源目录
SOURCE_PI="$HOME/.pi"
if [ -L "$SOURCE_PI" ]; then
    REAL_SOURCE=$(readlink -f "$SOURCE_PI")
    if [ "$REAL_SOURCE" = "$PROJECT_DIR/.pi" ]; then
        ok "符号链接已正确配置: ~/.pi -> $PROJECT_DIR/.pi"
        exit 0
    fi
    SOURCE_PI="$REAL_SOURCE"
fi

if [ ! -d "$SOURCE_PI" ]; then
    fail "源目录不存在: $SOURCE_PI"
fi

# 检查目标目录
if [ -d "$PROJECT_DIR/.pi" ] && [ "$(ls -A "$PROJECT_DIR/.pi" 2>/dev/null)" ]; then
    warn "目标目录已存在且不为空"
    read -p "是否覆盖？(y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "已取消"
        exit 0
    fi
fi

# 备份
BACKUP="$PROJECT_DIR/.pi.backup.$(date +%Y%m%d%H%M%S)"
[ -d "$PROJECT_DIR/.pi" ] && cp -r "$PROJECT_DIR/.pi" "$BACKUP" && ok "备份: $BACKUP"

# 创建目标目录
mkdir -p "$PROJECT_DIR/.pi"/{extensions,services,sessions,stats,core}
mkdir -p "$PROJECT_DIR/.pi"/{scripts,packs,deploy,data,logs}

# 迁移配置文件
echo ""
info "迁移配置文件..."
for file in settings.json models.json auth.json modes.json keybindings.json scheduled-seeds.json AGENTS.md APPEND_SYSTEM.md; do
    [ -f "$SOURCE_PI/$file" ] && cp "$SOURCE_PI/$file" "$PROJECT_DIR/.pi/" && ok "$file"
done

# 迁移目录
echo ""
info "迁移目录..."
for dir in extensions services core scripts packs deploy data logs; do
    [ -d "$SOURCE_PI/$dir" ] && cp -r "$SOURCE_PI/$dir/"* "$PROJECT_DIR/.pi/$dir/" 2>/dev/null && ok "$dir"
done

[ -d "$SOURCE_PI/extensions" ] && cp -r "$SOURCE_PI/extensions/"* "$PROJECT_DIR/.pi/extensions/" 2>/dev/null && ok "agent/extensions"
[ -d "$SOURCE_PI/services" ] && cp -r "$SOURCE_PI/services/"* "$PROJECT_DIR/.pi/services/" 2>/dev/null && ok "agent/services"

# 创建符号链接
echo ""
info "创建符号链接..."
if [ -L "$HOME/.pi" ]; then
    rm "$HOME/.pi"
elif [ -d "$HOME/.pi" ]; then
    mv "$HOME/.pi" "$HOME/.pi.bak.$(date +%Y%m%d%H%M%S)"
    ok "备份旧目录"
fi

ln -sf "$PROJECT_DIR/.pi" "$HOME/.pi"
ok "符号链接创建完成: ~/.pi -> $PROJECT_DIR/.pi"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  配置迁移完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "配置目录: $PROJECT_DIR/.pi"
echo "符号链接: ~/.pi -> $PROJECT_DIR/.pi"
[ -n "$BACKUP" ] && echo "备份目录: $BACKUP"
echo ""
echo "验证: mypi --list-models"
echo ""
