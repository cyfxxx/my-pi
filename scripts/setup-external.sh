#!/bin/bash
# setup-external.sh — 可选的外部服务/依赖安装
#
# 对应 pi-tools rebuild.sh 的外部服务安装阶段（my-pi 按需、非强制）。
# 用法：
#   bash scripts/setup-external.sh            # 打印各项状态
#   bash scripts/setup-external.sh fd-rg      # 把系统 fd/rg 链接进 portable/agent/bin
#   bash scripts/setup-external.sh tmux       # 安装 tmux（按平台）
#   bash scripts/setup-external.sh searxng    # 启动 SearXNG 容器（8889）
#   bash scripts/setup-external.sh whisper    # 打印 whisper 服务安装指引
#   bash scripts/setup-external.sh all        # fd-rg + tmux（不自动起容器）
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/portable/agent/bin"

ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠ $1"; }
info() { echo "  → $1"; }

setup_fd_rg() {
  mkdir -p "$BIN_DIR"
  local fd_src rg_src
  fd_src="$(command -v fdfind 2>/dev/null || command -v fd 2>/dev/null || true)"
  rg_src="$(command -v rg 2>/dev/null || true)"
  if [ -n "$fd_src" ]; then ln -sf "$fd_src" "$BIN_DIR/fd" && ok "fd → $fd_src"; else warn "未找到 fd/fdfind（apt install fd-find / pkg install fd）"; fi
  if [ -n "$rg_src" ]; then ln -sf "$rg_src" "$BIN_DIR/rg" && ok "rg → $rg_src"; else warn "未找到 rg（apt install ripgrep / pkg install ripgrep）"; fi
}

setup_tmux() {
  if command -v tmux >/dev/null 2>&1; then ok "tmux 已安装（$(tmux -V 2>/dev/null)）"; return; fi
  if command -v pkg >/dev/null 2>&1; then pkg install -y tmux && ok "tmux 已安装（Termux）" || warn "pkg install tmux 失败"
  elif command -v brew >/dev/null 2>&1; then brew install tmux && ok "tmux 已安装（brew）" || warn "brew install tmux 失败"
  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y tmux && ok "tmux 已安装（apt）" || warn "apt install tmux 失败"
  else warn "未知包管理器，请手动安装 tmux"; fi
}

setup_searxng() {
  if curl -s --max-time 3 http://127.0.0.1:8889/ >/dev/null 2>&1; then ok "SearXNG 已在 127.0.0.1:8889 运行"; return; fi
  local runner=""
  command -v docker >/dev/null 2>&1 && runner=docker
  [ -z "$runner" ] && command -v podman >/dev/null 2>&1 && runner=podman
  if [ -z "$runner" ]; then warn "未找到 docker/podman；无法自动启动 SearXNG"; info "参考 README「外部服务安装」或 docs/FAQ.md"; return; fi
  $runner run -d --name searxng -p 8889:8080 searxng/searxng >/dev/null 2>&1 \
    && ok "SearXNG 容器已启动（8889）" \
    || warn "SearXNG 启动失败（容器名冲突？先 $runner rm -f searxng）"
}

setup_whisper() {
  warn "whisper 服务需手动部署（faster-whisper + 服务脚本）"
  info "1) python3 -m venv /opt/pi-whisper/venv && /opt/pi-whisper/venv/bin/pip install faster-whisper"
  info "2) 放置 whisper 服务脚本到 portable/agent/pi-voice.json 的 whisperScript 路径"
  info "3) /voice doctor 验证；端点默认 http://127.0.0.1:18766"
}

status() {
  echo "=== 外部依赖状态 ==="
  command -v tmux >/dev/null 2>&1 && ok "tmux: $(tmux -V)" || warn "tmux 未安装"
  command -v fd >/dev/null 2>&1 || command -v fdfind >/dev/null 2>&1 && ok "fd 可用" || warn "fd 未安装"
  command -v rg >/dev/null 2>&1 && ok "rg 可用" || warn "rg 未安装"
  [ -x "$BIN_DIR/fd" ] && ok "portable/agent/bin/fd 就绪" || warn "portable/agent/bin/fd 未链接（bash scripts/setup-external.sh fd-rg）"
  [ -x "$BIN_DIR/rg" ] && ok "portable/agent/bin/rg 就绪" || warn "portable/agent/bin/rg 未链接（bash scripts/setup-external.sh fd-rg）"
  curl -s --max-time 3 http://127.0.0.1:8889/ >/dev/null 2>&1 && ok "SearXNG 运行中" || warn "SearXNG 未运行"
  curl -s --max-time 3 http://127.0.0.1:18766/health >/dev/null 2>&1 && ok "whisper 运行中" || warn "whisper 未运行"
  command -v docker >/dev/null 2>&1 || command -v podman >/dev/null 2>&1 && ok "docker/podman 可用" || warn "docker/podman 未安装"
}

case "${1:-status}" in
  fd-rg) setup_fd_rg ;;
  tmux) setup_tmux ;;
  searxng) setup_searxng ;;
  whisper) setup_whisper ;;
  all) setup_fd_rg; setup_tmux ;;
  status|"") status ;;
  *) echo "用法: $0 {status|fd-rg|tmux|searxng|whisper|all}"; exit 1 ;;
esac
