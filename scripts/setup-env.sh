#!/usr/bin/env bash
# ============================================================
# setup-env.sh — 环境配置脚本
# 配置 mypi 命令和 PATH
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
echo -e "${CYAN}  环境配置脚本${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
info "项目目录: $PROJECT_DIR"

# 创建 mypi 命令
echo ""
info "创建 mypi 命令..."

cat > /tmp/mypi << EOF
#!/bin/bash
# mypi - my-pi 构建版本
# 使用 ~/.pi 配置（通过符号链接指向项目目录）

exec node $PROJECT_DIR/packages/coding-agent/dist/bundle/cli.js "\$@"
EOF

chmod +x /tmp/mypi

if sudo mv /tmp/mypi /usr/local/bin/mypi 2>/dev/null; then
    ok "mypi 命令安装到 /usr/local/bin/mypi"
else
    mkdir -p ~/bin
    mv /tmp/mypi ~/bin/mypi
    ok "mypi 命令安装到 ~/bin/mypi"
fi

# 配置 PATH
echo ""
info "配置 PATH..."
if grep -q "$PROJECT_DIR/scripts" ~/.bashrc 2>/dev/null; then
    warn "PATH 已配置，跳过"
else
    echo "export PATH=\"$PROJECT_DIR/scripts:\$PATH\"" >> ~/.bashrc
    ok "PATH 已添加到 ~/.bashrc"
fi

# 验证配置
echo ""
info "验证配置..."

if command -v mypi >/dev/null 2>&1; then
    ok "mypi 命令可用"
else
    warn "mypi 命令不可用，请重新加载 shell"
fi

if [ -L "$HOME/.pi" ] || [ -d "$HOME/.pi/agent" ]; then
    ok "配置目录可用"
else
    warn "配置目录不可用，请运行 setup-config.sh"
fi

if [ -f "$PROJECT_DIR/packages/coding-agent/dist/bundle/cli.js" ]; then
    ok "bundle 文件存在"
else
    warn "bundle 文件不存在，请运行构建脚本"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  环境配置完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "请重新加载 shell: source ~/.bashrc"
echo "然后验证安装: mypi --list-models"
echo ""
