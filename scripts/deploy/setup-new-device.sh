#!/usr/bin/env bash
# ============================================================
# setup-new-device.sh — my-pi 新设备自动化部署脚本
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
title(){ echo -e "\n${CYAN}[$1]${NC} $2"; }

SKIP_BUILD=0; SKIP_CONFIG=0; SKIP_VERIFY=0; SYNC_FROM=""
while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build) SKIP_BUILD=1 ;;
        --skip-config) SKIP_CONFIG=1 ;;
        --skip-verify) SKIP_VERIFY=1 ;;
        --sync-from=*) SYNC_FROM="${1#*=}" ;;
        --help|-h) echo "用法: $0 [--skip-build] [--skip-config] [--skip-verify] [--sync-from=USER@HOST]"; exit 0 ;;
        *) fail "未知参数: $1" ;;
    esac; shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MY_PI_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  my-pi 新设备自动化部署脚本${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
info "工作目录: $MY_PI_DIR"

title "1/6" "检查系统依赖"
command -v git >/dev/null 2>&1 || fail "未找到 git"
ok "Git: $(git --version)"
command -v node >/dev/null 2>&1 || fail "未找到 node"
NODE_VER=$(node -v | sed 's/v//' | cut -d'.' -f1)
[ "$NODE_VER" -lt 22 ] && fail "需要 Node.js v22+，当前: $(node -v)"
ok "Node.js: $(node -v)"
command -v npm >/dev/null 2>&1 || fail "未找到 npm"
ok "npm: v$(npm --version)"

title "2/6" "安装依赖"
cd "$MY_PI_DIR"
npm install --silent 2>/dev/null && ok "根依赖" || fail "根依赖安装失败"

title "3/6" "构建项目"
if [ "$SKIP_BUILD" -eq 0 ]; then
    npm run build:offline 2>/dev/null && ok "构建完成" || fail "构建失败"
else
    warn "跳过构建"
fi

title "4/6" "配置环境"
if [ "$SKIP_CONFIG" -eq 0 ]; then
    # 初始化配置目录
    bash "$MY_PI_DIR/scripts/setup-config.sh" && ok "配置目录" || warn "配置目录初始化失败"

    # 配置环境变量
    bash "$MY_PI_DIR/scripts/setup-env.sh" && ok "环境变量" || warn "环境变量配置失败"
else
    warn "跳过配置"
fi

title "5/6" "验证安装"
if [ "$SKIP_VERIFY" -eq 0 ]; then
    mypi --list-models >/dev/null 2>&1 && ok "mypi 命令" || warn "mypi 命令验证失败"
else
    warn "跳过验证"
fi

title "6/6" "部署完成"
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "快速开始："
echo "  mypi --list-models"
echo "  mypi -p '你好'"
echo ""
echo "配置目录: $MY_PI_DIR/.pi"
echo "符号链接: ~/.pi -> $MY_PI_DIR/.pi"
echo ""
