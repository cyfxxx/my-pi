#!/bin/bash
# setup-external.sh — 可选的外部服务/依赖安装（**全部落到仓库内**，随项目移动）
#
# 对应 pi-tools rebuild.sh 的外部服务安装阶段（my-pi 按需、非强制）。
#
# 2026-10-15 便携化改造：本脚本此前把 SearXNG/whisper/sherpa 的安装位置写死在仓外
# （`/opt/searxng`、`/opt/pi-whisper`、`/opt/pi-sherpa`），于是"项目 + 一堆仓外状态"
# 被拆开，换机器/换路径就散架。现在统一走 `scripts/lib-portable.sh` 的
# `<repo>/runtime/<平台>/ext/<服务>/`，并由 `scripts/portable-runtime.sh` 负责下载安装。
#
# 用法：
#   bash scripts/setup-external.sh                  # 打印各项状态
#   bash scripts/setup-external.sh searxng          # 启动仓内 SearXNG（8889）
#   bash scripts/setup-external.sh searxng-stop     # 停止（按 pidfile，不用 pkill）
#   bash scripts/setup-external.sh fd-rg            # 把 rg/fd **复制**进 runtime/<平台>/bin（随项目移动）
#   bash scripts/setup-external.sh age              # 同上：把 age/age-keygen 复制进仓库（私钥仍留仓外）
#   bash scripts/setup-external.sh tmux             # 安装 tmux（按平台）
#   bash scripts/setup-external.sh whisper          # 打印 whisper 服务安装指引（仓内路径）
#   bash scripts/setup-external.sh all              # fd-rg + tmux（不自动起服务）
#
# 装运行时/依赖（在启动服务之前跑）：
#   bash scripts/portable-runtime.sh all            # Node + 便携 CPython + pack 依赖
#   bash scripts/portable-runtime.sh searxng        # SearXNG 源码 + 依赖 → runtime/<平台>/ext/searxng
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib-portable.sh
. "$ROOT/scripts/lib-portable.sh"
BIN_DIR="$ROOT/portable/agent/bin"

ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠ $1"; }
info() { echo "  → $1"; }

# 说明：portable/ 下禁止符号链接（check-isolation 检查 1），故用 exec shim 而非 ln -s。
write_shim() {
  local name="$1" target="$2"
  printf '#!/bin/sh\nexec "%s" "$@"\n' "$target" > "$BIN_DIR/$name"
  chmod +x "$BIN_DIR/$name"
}

# 把一个系统 CLI **复制进仓库**（runtime/<平台>/bin，随项目移动），再写 exec shim 指过去。
# 为什么不再直接 shim 系统路径（2026-10-15 便携化）：`exec /usr/bin/rg` 这种 shim 里是**绝对
# 路径**，换台机器/换个发行版就失效（或被另一个同名但不同版本的程序顶替）。复制进仓库后，
# `pi_portable_env` 会把 runtime/<平台>/bin 前置进 PATH，工具随项目走。
# 复制失败时退回"shim 指系统路径"，并**明确告警**（不假装便携）。
write_portable_cli() {
  local name="$1" src="$2" dest
  dest="$(pi_bin_dir)/$name"
  if [ -z "$src" ]; then
    warn "未找到 $name（apt install ${name/ fd/fd-find} / pkg install $name）"
    return 1
  fi
  mkdir -p "$(pi_bin_dir)"
  if cp -f "$src" "$dest" 2>/dev/null && chmod +x "$dest" 2>/dev/null; then
    write_shim "$name" "$dest"
    ok "$name → 仓内 $dest（随项目移动；$("$dest" --version 2>/dev/null | head -1)）"
  else
    write_shim "$name" "$src"
    warn "$name 复制进仓库失败，shim 仍指向仓外 $src（换机器会失效）"
  fi
}

setup_fd_rg() {
  mkdir -p "$BIN_DIR"
  local fd_src rg_src
  fd_src="$(command -v fdfind 2>/dev/null || command -v fd 2>/dev/null || true)"
  rg_src="$(command -v rg 2>/dev/null || true)"
  write_portable_cli fd "$fd_src" || true
  write_portable_cli rg "$rg_src" || true
}

setup_tmux() {
  if command -v tmux >/dev/null 2>&1; then ok "tmux 已安装（$(tmux -V 2>/dev/null)）"; return; fi
  if command -v pkg >/dev/null 2>&1; then pkg install -y tmux && ok "tmux 已安装（Termux）" || warn "pkg install tmux 失败"
  elif command -v brew >/dev/null 2>&1; then brew install tmux && ok "tmux 已安装（brew）" || warn "brew install tmux 失败"
  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y tmux && ok "tmux 已安装（apt）" || warn "apt install tmux 失败"
  else warn "未知包管理器，请手动安装 tmux"; fi
}

# ── age（记忆加密同步要用的加密工具，`scripts/sync-memory.sh`）──────────────
# 复制进仓库的理由与 rg/fd 相同：sync-memory 是"项目功能"，不该因为新机器没装 age 就不可用。
# ★ **私钥不随之移动**：`sync-memory.sh init` 默认把私钥放在 `~/.config/my-pi/age.key`（仓外），
#   这是刻意的安全边界（私钥绝不能进仓库/随同步包走）；本函数只搬**可执行文件**。
setup_age() {
  local a k
  a="$(command -v age 2>/dev/null || true)"
  k="$(command -v age-keygen 2>/dev/null || true)"
  [ -n "$a" ] && write_portable_cli age "$a" || warn "未找到 age（apt install age / pkg install age）"
  [ -n "$k" ] && write_portable_cli age-keygen "$k" || true
  info "私钥仍在仓外（默认 ~/.config/my-pi/age.key）——这是刻意的，别搬进仓库"
}

# ── SearXNG（web_search 的本地后端）──────────────────────────────────────────
# 默认位置：<repo>/runtime/<平台>/ext/searxng（源码 + 依赖 + settings + 日志 + pid），
# 一律**仓内**；`SEARXNG_HOME` 仍可覆盖（兼容旧布局 /opt/searxng）。
SEARXNG_HOME="${SEARXNG_HOME:-$(pi_ext_dir searxng)}"
SEARXNG_PORT="${SEARXNG_PORT:-8889}"
SEARXNG_PID="$SEARXNG_HOME/run/searxng.pid"
SEARXNG_LOG="$SEARXNG_HOME/log/searxng.log"

searxng_running() { curl -s --max-time 3 "http://127.0.0.1:$SEARXNG_PORT/" >/dev/null 2>&1; }
searxng_repo_ready() { [ -d "$SEARXNG_HOME/src/searx" ] && [ -d "$SEARXNG_HOME/site" ]; }

# 启动仓内实例：便携 python + PYTHONPATH(src+site) + granian（上游 requirements-server.txt）
#   * **不用** `bin/uvicorn` 之类的 console script：shebang 是绝对路径，仓库一搬就失效
#   * **服务私有 HOME/XDG/TMP**：SearXNG 与 python 的缓存/状态一律落在 ext/searxng 下，
#     不写用户目录（这是"不分散"的硬要求，见 lib-portable.sh 的 pi_service_env）
start_searxng_native() {
  local py i
  py="$(pi_resolve_python 2>/dev/null)" || { warn "找不到 python（先 bash scripts/portable-runtime.sh python）"; return 1; }
  [ -f "$SEARXNG_HOME/settings.yml" ] || { info "缺 settings.yml，先生成"; SEARXNG_HOME="$SEARXNG_HOME" bash "$ROOT/scripts/searxng-config.sh" || true; }
  mkdir -p "$SEARXNG_HOME/log" "$SEARXNG_HOME/run" "$SEARXNG_HOME/home/.cache" "$SEARXNG_HOME/tmp"
  # shellcheck disable=SC2046
  eval "$(pi_service_env searxng)"
  mkdir -p "$HOME" "$TMPDIR" "${XDG_CACHE_HOME:-$HOME/.cache}" 2>/dev/null || true
  info "启动仓内 SearXNG（$SEARXNG_HOME，python=$py）"
  PYTHONPATH="$SEARXNG_HOME/src:$SEARXNG_HOME/site" \
  SEARXNG_SETTINGS_PATH="$SEARXNG_HOME/settings.yml" \
  PI_SEARXNG_LOG="$SEARXNG_LOG" \
    nohup "$py" -m granian --interface wsgi --host 127.0.0.1 --port "$SEARXNG_PORT" searx.webapp:app \
      >>"$SEARXNG_LOG" 2>&1 &
  echo $! > "$SEARXNG_PID"
  for i in $(seq 1 40); do
    sleep 1
    if searxng_running; then ok "SearXNG 已启动（127.0.0.1:$SEARXNG_PORT，pid $(cat "$SEARXNG_PID" 2>/dev/null)）"; return 0; fi
    kill -0 "$(cat "$SEARXNG_PID" 2>/dev/null || echo 0)" 2>/dev/null || break
  done
  warn "SearXNG 未在 40 秒内就绪（见 $SEARXNG_LOG）"
  return 1
}

# 兼容旧的 /opt 原生实例（venv + uvicorn），只作为回退
start_searxng_legacy() {
  info "启动仓外旧实例（$SEARXNG_HOME）..."
  ( cd "$SEARXNG_HOME" && SEARXNG_SETTINGS_PATH="$SEARXNG_HOME/settings.yml" \
      setsid ./venv/bin/uvicorn searx.webapp:app --interface wsgi --host 127.0.0.1 --port "$SEARXNG_PORT" \
      </dev/null >>"$SEARXNG_HOME/searxng.log" 2>&1 & )
  sleep 8
  if searxng_running; then ok "SearXNG 已启动（127.0.0.1:$SEARXNG_PORT）"; else warn "SearXNG 启动失败，见 $SEARXNG_HOME/searxng.log"; fi
}

stop_searxng() {
  if [ ! -f "$SEARXNG_PID" ]; then warn "没有 pidfile（$SEARXNG_PID）—— 可能不是本脚本启动的，不擅自杀进程"; return 1; fi
  local p; p="$(cat "$SEARXNG_PID" 2>/dev/null || echo '')"
  case "$p" in ''|*[!0-9]*) warn "pidfile 内容非法：$p"; rm -f "$SEARXNG_PID"; return 1 ;; esac
  if kill -0 "$p" 2>/dev/null; then
    kill "$p" 2>/dev/null
    local i; for i in 1 2 3 4 5; do sleep 1; kill -0 "$p" 2>/dev/null || break; done
    if kill -0 "$p" 2>/dev/null; then kill -9 "$p" 2>/dev/null; ok "已强制停止（pid $p）"; else ok "已停止（pid $p）"; fi
  else
    info "进程已不在（pid $p）"
  fi
  rm -f "$SEARXNG_PID"
  return 0
}

setup_searxng() {
  if searxng_running; then ok "SearXNG 已在 127.0.0.1:$SEARXNG_PORT 运行"; return 0; fi
  if searxng_repo_ready; then start_searxng_native && return 0; fi
  if [ -x "$SEARXNG_HOME/venv/bin/uvicorn" ]; then start_searxng_legacy; return 0; fi
  local runner=""
  command -v docker >/dev/null 2>&1 && runner=docker
  [ -z "$runner" ] && command -v podman >/dev/null 2>&1 && runner=podman
  if [ -n "$runner" ]; then
    $runner run -d --name searxng -p "$SEARXNG_PORT:8080" searxng/searxng >/dev/null 2>&1 \
      && { ok "SearXNG 容器已启动（$SEARXNG_PORT）"; return 0; } \
      || warn "容器启动失败（名字冲突？先 $runner rm -f searxng）"
  fi
  warn "仓内没有 SearXNG，也没找到 docker/podman"
  info "装进仓库（推荐）：bash scripts/portable-runtime.sh searxng"
  info "然后：bash scripts/setup-external.sh searxng"
  return 1
}

setup_whisper() {
  local venv; venv="$(pi_ext_dir whisper)/venv"
  warn "whisper 服务需手动部署（faster-whisper 依赖较重，服务端脚本已随仓库分发）"
  info "1) 建仓内 venv（**不要**建到 /opt）：bash scripts/portable-runtime.sh python && \\"
  info "     \$(pi_resolve_python 2>/dev/null || echo python3) -m venv $venv"
  info "2) 装依赖：$venv/bin/python -m pip install faster-whisper opencc-python-reimplemented"
  info "3) 启动：bash custom/features/voice/scripts/pi-whisper.sh start（默认就用 $venv；PI_WHISPER_VENV 可覆盖）"
  info "4) /voice doctor 验证；端点默认 http://127.0.0.1:18766"
  info "备选（SenseVoice/onnx）：venv $(pi_ext_dir sherpa)/venv + pip install sherpa-onnx numpy，然后 bash custom/features/voice/scripts/pi-sherpa.sh start"
}

have() { command -v "$1" >/dev/null 2>&1; }

status() {
  echo "=== 外部依赖状态（仓内优先）==="
  have tmux && ok "tmux: $(tmux -V)" || warn "tmux 未安装（bash scripts/setup-external.sh tmux）"
  have fdfind || have fd && ok "fd 可用" || warn "fd 未安装"
  have rg && ok "rg 可用" || warn "rg 未安装"
  if [ -x "$(pi_bin_dir)/fd" ]; then ok "fd 已复制进仓库：$(pi_bin_dir)/fd（随项目移动）"
  elif [ -x "$BIN_DIR/fd" ]; then warn "fd 只有仓外 shim（换机器会失效）：bash scripts/setup-external.sh fd-rg"
  else warn "fd 未就绪（bash scripts/setup-external.sh fd-rg）"; fi
  if [ -x "$(pi_bin_dir)/rg" ]; then ok "rg 已复制进仓库：$(pi_bin_dir)/rg（随项目移动）"
  elif [ -x "$BIN_DIR/rg" ]; then warn "rg 只有仓外 shim（换机器会失效）：bash scripts/setup-external.sh fd-rg"
  else warn "rg 未就绪（bash scripts/setup-external.sh fd-rg）"; fi
  if [ -x "$(pi_bin_dir)/age" ]; then ok "age 已复制进仓库：$(pi_bin_dir)/age（私钥仍应在仓外）"
  elif have age; then warn "age 只有系统版本（bash scripts/setup-external.sh age 可复制进仓库）"
  else warn "age 未就绪（记忆加密同步需要；bash scripts/setup-external.sh age）"; fi
  have ffmpeg && ok "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')" || warn "ffmpeg 未安装（语音转码需要）"
  have chromium-browser || have chromium || have google-chrome && ok "chromium 可用" || warn "chromium 未安装（browser_* 需要）"
  have espeak || have espeak-ng && ok "espeak 可用（TTS fallback）" || warn "espeak 未安装"
  have piper && ok "piper 可用（TTS 首选）" || warn "piper 未安装（可选，TTS 首选）"
  have sherpa-onnx || have sherpa-onnx-cli && ok "sherpa 可用（stt 后端）" || warn "sherpa 未安装（可选 stt 后端）"
  # SearXNG：先看仓内是否装好，再看是否在跑
  local sx; sx="$(pi_ext_dir searxng)"
  if [ -d "$sx/src/searx" ]; then
    ok "SearXNG 已装入仓库：$sx（source ${SEARXNG_SRC_COMMIT:-见 scripts/portable-artifacts.txt}）"
  elif [ -d "${SEARXNG_HOME:-/nonexistent}/src/searx" ]; then
    ok "SearXNG 源码在 $SEARXNG_HOME"
  else
    warn "SearXNG 未装入仓库（bash scripts/portable-runtime.sh searxng）"
  fi
  searxng_running && ok "SearXNG 运行中（127.0.0.1:$SEARXNG_PORT）" || warn "SearXNG 未运行（web_search 将降级为 HTTP fallback；bash scripts/setup-external.sh searxng）"
  curl -s --max-time 3 http://127.0.0.1:18766/health >/dev/null 2>&1 && ok "whisper 运行中（127.0.0.1:18766）" || warn "whisper 未运行（voice 转写不可用）"
  # 一键体检里也带上"便携性"结论（node/python 是否已在仓内）
  pi_portable_status | sed 's/^/  | /'
}

# SearXNG 原生部署（无 docker/podman 时，Termux/Linux 可用）
setup_web() {
  if searxng_running; then ok "SearXNG 已在 127.0.0.1:$SEARXNG_PORT 运行"; return; fi
  if searxng_repo_ready || have docker || have podman || [ -x "$SEARXNG_HOME/venv/bin/uvicorn" ]; then setup_searxng; return; fi
  warn "还没把 SearXNG 装进仓库，提供便携部署路径（需网络）"
  info "1) bash scripts/portable-runtime.sh searxng     # 源码+依赖 → runtime/<平台>/ext/searxng"
  info "2) bash scripts/setup-external.sh searxng       # 启动（127.0.0.1:8889）"
  info "3) bash scripts/setup-external.sh status        # 自检；web_search 默认就用这个地址"
}

case "${1:-status}" in
  fd-rg) setup_fd_rg ;;
  age) setup_age ;;
  tmux) setup_tmux ;;
  web|searxng) setup_web ;;
  searxng-stop|web-stop) stop_searxng ;;
  whisper) setup_whisper ;;
  all) setup_fd_rg; setup_age; setup_tmux ;;
  status|"") status ;;
  *) echo "用法: $0 {status|fd-rg|age|tmux|web|searxng|searxng-stop|whisper|all}" >&1; exit 1 ;;
esac
