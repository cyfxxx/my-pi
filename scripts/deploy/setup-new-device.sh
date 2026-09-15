#!/usr/bin/env bash
# ============================================================
# setup-new-device.sh — my-pi 新设备自动化部署脚本
# 一键完成：依赖检查、环境配置、构建、验证
# ============================================================
set -euo pipefail

# 颜色定义
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
title(){ echo -e "\n${CYAN}[$1]${NC} $2"; }

# 参数解析
SKIP_BUILD=0
SKIP_CONFIG=0
SKIP_VERIFY=0
SYNC_FROM=""

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build) SKIP_BUILD=1 ;;
        --skip-config) SKIP_CONFIG=1 ;;
        --skip-verify) SKIP_VERIFY=1 ;;
        --sync-from=*) SYNC_FROM="${1#*=}" ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo "  --skip-build    跳过构建步骤"
            echo "  --skip-config   跳过配置步骤"
            echo "  --skip-verify   跳过验证步骤"
            echo "  --sync-from=USER@HOST  从指定设备同步配置"
            exit 0
            ;;
        *) fail "未知参数: $1" ;;
    esac
    shift
done

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MY_PI_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  my-pi 新设备自动化部署脚本${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
info "工作目录: $MY_PI_DIR"
echo ""

# ============================================================
# Phase 1: 系统依赖检查
# ============================================================
title "1/7" "检查系统依赖"

# 检查 Git
command -v git >/dev/null 2>&1 || fail "未找到 git，请先安装: sudo apt install git"
ok "Git: $(git --version)"

# 检查 Node.js
command -v node >/dev/null 2>&1 || fail "未找到 node，请先安装 Node.js v22+"
NODE_VERSION=$(node -v | sed 's/v//' | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    fail "Node.js 版本过低: $(node -v)，需要 v22+"
fi
ok "Node.js: $(node -v)"

# 检查 npm
command -v npm >/dev/null 2>&1 || fail "未找到 npm"
ok "npm: v$(npm --version)"

# 检查 Python（可选）
if command -v python3 >/dev/null 2>&1; then
    ok "Python3: $(python3 --version 2>&1 | awk '{print $2}')"
else
    warn "Python3 未安装（部分功能可能受限）"
fi

# 检查 ripgrep（可选）
if command -v rg >/dev/null 2>&1; then
    ok "ripgrep: $(rg --version | head -1)"
else
    warn "ripgrep 未安装（搜索功能可能受限）"
fi

# 检查 fd（可选）
if command -v fd >/dev/null 2>&1; then
    ok "fd: $(fd --version | head -1)"
else
    warn "fd 未安装（文件查找可能受限）"
fi

# ============================================================
# Phase 2: 从远程设备同步配置（可选）
# ============================================================
if [ -n "$SYNC_FROM" ]; then
    title "2/7" "从 $SYNC_FROM 同步配置"
    
    info "同步 settings.json..."
    scp "$SYNC_FROM:~/.pi/agent/settings.json" ~/.pi/agent/ 2>/dev/null && ok "settings.json" || warn "settings.json 同步失败"
    
    info "同步 modes.json..."
    scp "$SYNC_FROM:~/.pi/agent/modes.json" ~/.pi/agent/ 2>/dev/null && ok "modes.json" || warn "modes.json 同步失败"
    
    info "同步 keybindings.json..."
    scp "$SYNC_FROM:~/.pi/agent/keybindings.json" ~/.pi/agent/ 2>/dev/null && ok "keybindings.json" || warn "keybindings.json 同步失败"
    
    info "同步 extensions..."
    rsync -avz --exclude='node_modules' "$SYNC_FROM:~/.pi/agent/extensions/" ~/.pi/agent/extensions/ 2>/dev/null && ok "extensions" || warn "extensions 同步失败"
    
    info "同步 services..."
    rsync -avz --exclude='node_modules' "$SYNC_FROM:~/.pi/agent/services/" ~/.pi/agent/services/ 2>/dev/null && ok "services" || warn "services 同步失败"
    
    info "同步 auth.json..."
    scp "$SYNC_FROM:~/.pi/agent/auth.json" ~/.pi/agent/ 2>/dev/null && ok "auth.json" || warn "auth.json 同步失败"
    
    info "同步 models.json..."
    scp "$SYNC_FROM:~/.pi/agent/models.json" ~/.pi/agent/ 2>/dev/null && ok "models.json" || warn "models.json 同步失败"
else
    title "2/7" "跳过远程同步（未指定 --sync-from）"
fi

# ============================================================
# Phase 3: 安装依赖
# ============================================================
title "3/7" "安装依赖"

info "安装根依赖..."
cd "$MY_PI_DIR"
npm install --silent 2>/dev/null && ok "根依赖" || fail "根依赖安装失败"

info "安装扩展依赖..."
cd "$MY_PI_DIR/custom/extensions"
npm install --silent 2>/dev/null && ok "扩展依赖" || fail "扩展依赖安装失败"

cd "$MY_PI_DIR"

# ============================================================
# Phase 4: 构建项目
# ============================================================
if [ "$SKIP_BUILD" -eq 0 ]; then
    title "4/7" "构建项目"
    
    info "运行 npm run build:offline..."
    npm run build:offline 2>/dev/null && ok "构建完成" || fail "构建失败"
else
    title "4/7" "跳过构建（--skip-build）"
fi

# ============================================================
# Phase 5: 配置环境
# ============================================================
if [ "$SKIP_CONFIG" -eq 0 ]; then
    title "5/7" "配置环境"
    
    # 创建配置目录
    mkdir -p ~/.pi/agent
    mkdir -p ~/.pi/agent/sessions
    mkdir -p ~/.pi/agent/stats
    
    # 复制配置文件（如果不存在）
    info "配置 settings.json..."
    if [ ! -f ~/.pi/agent/settings.json ]; then
        cp "$MY_PI_DIR/custom/config/settings.json" ~/.pi/agent/ && ok "settings.json" || warn "settings.json 复制失败"
    else
        ok "settings.json 已存在，跳过"
    fi
    
    info "配置 modes.json..."
    if [ ! -f ~/.pi/agent/modes.json ]; then
        cp "$MY_PI_DIR/custom/config/modes.json" ~/.pi/agent/ && ok "modes.json" || warn "modes.json 复制失败"
    else
        ok "modes.json 已存在，跳过"
    fi
    
    info "配置 keybindings.json..."
    if [ ! -f ~/.pi/agent/keybindings.json ]; then
        cp "$MY_PI_DIR/custom/config/keybindings.json" ~/.pi/agent/ && ok "keybindings.json" || warn "keybindings.json 复制失败"
    else
        ok "keybindings.json 已存在，跳过"
    fi
    
    info "配置 extensions-package.json..."
    if [ ! -f ~/.pi/agent/extensions-package.json ]; then
        cp "$MY_PI_DIR/custom/config/extensions-package.json" ~/.pi/agent/ && ok "extensions-package.json" || warn "extensions-package.json 复制失败"
    else
        ok "extensions-package.json 已存在，跳过"
    fi
    
    # 安装 mypi 命令
    info "安装 mypi 命令..."
    if [ -f /usr/local/bin/mypi ]; then
        sudo rm /usr/local/bin/mypi
    fi
    sudo ln -sf "$MY_PI_DIR/scripts/mypi" /usr/local/bin/mypi && ok "mypi 命令" || warn "mypi 命令安装失败（需要 sudo 权限）"
    
    # 添加到 PATH（如果需要）
    if ! echo "$PATH" | grep -q "$MY_PI_DIR/scripts"; then
        info "添加到 PATH..."
        echo "export PATH=\"$MY_PI_DIR/scripts:\$PATH\"" >> ~/.bashrc
        ok "已添加到 ~/.bashrc"
    fi
else
    title "5/7" "跳过配置（--skip-config）"
fi

# ============================================================
# Phase 6: 验证安装
# ============================================================
if [ "$SKIP_VERIFY" -eq 0 ]; then
    title "6/7" "验证安装"
    
    info "验证 mypi 命令..."
    mypi --list-models >/dev/null 2>&1 && ok "mypi 命令" || warn "mypi 命令验证失败"
    
    info "验证扩展加载..."
    ls "$MY_PI_DIR/custom/extensions/" >/dev/null 2>&1 && ok "扩展目录" || warn "扩展目录不存在"
    
    info "验证配置文件..."
    ls ~/.pi/agent/settings.json >/dev/null 2>&1 && ok "settings.json" || warn "settings.json 不存在"
    ls ~/.pi/agent/modes.json >/dev/null 2>&1 && ok "modes.json" || warn "modes.json 不存在"
    
    # 运行冒烟测试
    if [ -f "$MY_PI_DIR/scripts/test/smoke-test.sh" ]; then
        info "运行冒烟测试..."
        bash "$MY_PI_DIR/scripts/test/smoke-test.sh" >/dev/null 2>&1 && ok "冒烟测试" || warn "冒烟测试失败"
    fi
else
    title "6/7" "跳过验证（--skip-verify）"
fi

# ============================================================
# Phase 7: 完成
# ============================================================
title "7/7" "部署完成"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "快速开始："
echo "  mypi --list-models          # 查看可用模型"
echo "  mypi -p '你好'              # 测试对话"
echo "  mypi -p '搜索最新新闻'      # 测试搜索"
echo ""
echo "文档："
echo "  查看部署指南: cat $MY_PI_DIR/docs/DEPLOYMENT-GUIDE.md"
echo "  查看架构文档: cat $MY_PI_DIR/custom/docs/ARCHITECTURE.md"
echo ""
echo "维护："
echo "  重建项目: npm run build:offline"
echo "  运行测试: ./scripts/test/smoke-test.sh"
echo "  每日健康检查: node scripts/maintenance/daily-health.mjs"
echo ""
echo "多设备同步："
echo "  从当前设备同步到新设备:"
echo "  $0 --sync-from=user@current-device"
echo ""
