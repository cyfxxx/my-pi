#!/usr/bin/env bash
# ============================================================
# sync-config.sh — 配置同步脚本
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

[ $# -lt 2 ] && { echo "用法: $0 <push|pull> <USER@HOST>"; exit 1; }
ACTION="$1"; TARGET="$2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PI_DIR="$PROJECT_DIR/.pi"

case "$ACTION" in
    push)
        echo -e "${CYAN}推送配置到 $TARGET${NC}"
        [ ! -d "$PI_DIR/agent" ] && fail "配置目录不存在: $PI_DIR/agent"
        rsync -avz --exclude='node_modules' --exclude='sessions' --exclude='stats' --exclude='data' --exclude='logs' "$PI_DIR/" "$TARGET:$PROJECT_DIR/.pi/" && ok "配置目录" || fail "配置目录"
        echo -e "${GREEN}推送完成！${NC}"
        ;;
    pull)
        echo -e "${CYAN}从 $TARGET 拉取配置${NC}"
        mkdir -p "$PI_DIR/agent"
        rsync -avz --exclude='node_modules' --exclude='sessions' --exclude='stats' --exclude='data' --exclude='logs' "$TARGET:$PROJECT_DIR/.pi/" "$PI_DIR/" && ok "配置目录" || fail "配置目录"
        echo -e "${GREEN}拉取完成！${NC}"
        ;;
    *) echo "用法: $0 <push|pull> <USER@HOST>"; exit 1 ;;
esac
