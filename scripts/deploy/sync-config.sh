#!/usr/bin/env bash
# ============================================================
# sync-config.sh — 配置同步脚本
# 在多设备间同步 my-pi 配置
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

# 参数
ACTION=""
TARGET=""

usage() {
    echo "用法: $0 <push|pull> <USER@HOST>"
    echo ""
    echo "示例:"
    echo "  $0 push user@new-device     # 推送配置到新设备"
    echo "  $0 pull user@old-device     # 从旧设备拉取配置"
    exit 1
}

[ $# -lt 2 ] && usage
ACTION="$1"
TARGET="$2"

PI_HOME="${HOME}/.pi/agent"

case "$ACTION" in
    push)
        echo -e "${CYAN}推送配置到 $TARGET${NC}"
        
        info "推送 settings.json..."
        scp "$PI_HOME/settings.json" "$TARGET:$PI_HOME/" && ok "settings.json" || fail "settings.json"
        
        info "推送 modes.json..."
        scp "$PI_HOME/modes.json" "$TARGET:$PI_HOME/" && ok "modes.json" || fail "modes.json"
        
        info "推送 keybindings.json..."
        scp "$PI_HOME/keybindings.json" "$TARGET:$PI_HOME/" && ok "keybindings.json" || fail "keybindings.json"
        
        info "推送 extensions..."
        rsync -avz --exclude='node_modules' "$PI_HOME/extensions/" "$TARGET:$PI_HOME/extensions/" && ok "extensions" || fail "extensions"
        
        info "推送 services..."
        rsync -avz --exclude='node_modules' "$PI_HOME/services/" "$TARGET:$PI_HOME/services/" && ok "services" || fail "services"
        
        info "推送 auth.json..."
        scp "$PI_HOME/auth.json" "$TARGET:$PI_HOME/" && ok "auth.json" || fail "auth.json"
        
        info "推送 models.json..."
        scp "$PI_HOME/models.json" "$TARGET:$PI_HOME/" && ok "models.json" || fail "models.json"
        
        echo -e "${GREEN}推送完成！${NC}"
        ;;
    pull)
        echo -e "${CYAN}从 $TARGET 拉取配置${NC}"
        
        info "拉取 settings.json..."
        scp "$TARGET:$PI_HOME/settings.json" "$PI_HOME/" && ok "settings.json" || fail "settings.json"
        
        info "拉取 modes.json..."
        scp "$TARGET:$PI_HOME/modes.json" "$PI_HOME/" && ok "modes.json" || fail "modes.json"
        
        info "拉取 keybindings.json..."
        scp "$TARGET:$PI_HOME/keybindings.json" "$PI_HOME/" && ok "keybindings.json" || fail "keybindings.json"
        
        info "拉取 extensions..."
        rsync -avz --exclude='node_modules' "$TARGET:$PI_HOME/extensions/" "$PI_HOME/extensions/" && ok "extensions" || fail "extensions"
        
        info "拉取 services..."
        rsync -avz --exclude='node_modules' "$TARGET:$PI_HOME/services/" "$PI_HOME/services/" && ok "services" || fail "services"
        
        info "拉取 auth.json..."
        scp "$TARGET:$PI_HOME/auth.json" "$PI_HOME/" && ok "auth.json" || fail "auth.json"
        
        info "拉取 models.json..."
        scp "$TARGET:$PI_HOME/models.json" "$PI_HOME/" && ok "models.json" || fail "models.json"
        
        echo -e "${GREEN}拉取完成！${NC}"
        ;;
    *)
        usage
        ;;
esac
