#!/usr/bin/env bash
# pi-sherpa.sh — sherpa-onnx (SenseVoice) 常驻转写服务管理（pi-voice 扩展的可选后端）
# 用法: pi-sherpa.sh {start|stop|restart|status|run}
# 与 pi-whisper.sh 并列；独立实现转写，端口 18768 错开。
set -uo pipefail

# my-pi 路径适配：脚本位于 <root>/custom/features/voice/scripts/，运行数据收敛在 portable/。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_HOME="${PI_HOME:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
AGENT_DIR="${MY_PI_AGENT_DIR:-$PI_HOME/portable/agent}"
LOG_DIR="${PI_VOICE_LOG_DIR:-$PI_HOME/portable/memory/logs/voice}/sherpa"
VENV="${PI_SHERPA_VENV:-/opt/pi-sherpa/venv}"
SERVER="$SCRIPT_DIR/pi-sherpa-server.py"
PORT="${PI_SHERPA_PORT:-18768}"
LOG="$LOG_DIR/server.log"
PIDFILE="$LOG_DIR/server.pid"

mkdir -p "$(dirname "$LOG")"

# 从 pi-voice 配置读取共享令牌：优先 sherpaToken，回退 whisperToken（同一信任域/sean）
read_token() {
  local cfg="$AGENT_DIR/pi-voice.json"
  if [ -f "$cfg" ]; then
    python3 -c "import json; v=json.load(open('$cfg')); print(v.get('sherpaToken','') or v.get('whisperToken',''))" 2>/dev/null
  fi
}

# 从 pi-voice 配置读取识别语言（默认 zh，与扩展 setting 同步）
read_language() {
  local cfg="$AGENT_DIR/pi-voice.json"
  if [ -f "$cfg" ]; then
    python3 -c "import json; print(json.load(open('$cfg')).get('language','zh'))" 2>/dev/null
  else
    echo "zh"
  fi
}

# 孤儿进程兜底：同用户匹配 sherpa-server 的 python 解释器实例
orphan_pids() {
  pgrep -u "$(id -un)" -f "python3?.*pi-sherpa-server\.py" 2>/dev/null | grep -v "^$$" || true
}

is_running() {
  { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; } || [ -n "$(orphan_pids)" ]
}

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "sherpa 服务已在运行 (pid $(cat "$PIDFILE"))"
    return 0
  fi
  if [ -n "$(orphan_pids)" ]; then
    echo "检测到无 pidfile 的残留 sherpa 进程，自动清理…"
    stop
  fi
  if [ ! -x "$VENV/bin/python" ]; then
    echo "错误: 未找到 $VENV/bin/python，请先: python3 -m venv $VENV && $VENV/bin/pip install sherpa-onnx numpy" >&2
    return 1
  fi
  if ! "$VENV/bin/python" -c 'import sherpa_onnx' >/dev/null 2>&1; then
    echo "错误: $VENV 中未安装 sherpa-onnx，请执行: $VENV/bin/pip install sherpa-onnx numpy" >&2
    return 1
  fi
  local token lang
  token="$(read_token)"
  lang="$(read_language)"
  local -a envs=()
  [ -n "$token" ] && envs+=(PI_SHERPA_TOKEN="$token")
  [ -n "$lang" ] && envs+=(PI_SHERPA_LANGUAGE="$lang")
  env "${envs[@]}" nohup "$VENV/bin/python" "$SERVER" >>"$LOG" 2>&1 &
  echo "sherpa 服务启动（${token:+Bearer token 鉴权已启用}${lang:+，语言 $lang}）"
  echo $! > "$PIDFILE"
  for _ in $(seq 1 60); do
    if [ -n "$token" ]; then
      curl -fsS -H "Authorization: Bearer $token" "http://127.0.0.1:$PORT/health" >/dev/null 2>&1
    else
      curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1
    fi
    if [ $? -eq 0 ]; then
      echo "sherpa 服务已启动 (pid $(cat "$PIDFILE"))"
      return 0
    fi
    sleep 1
  done
  echo "sherpa 服务启动超时（模型加载中？），日志: $LOG" >&2
  return 1
}

stop() {
  local killed=0
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    killed=1
  fi
  for pid in $(orphan_pids); do
    [ "$pid" = "$(cat "$PIDFILE" 2>/dev/null)" ] && continue
    kill "$pid" 2>/dev/null && killed=1
  done
  rm -f "$PIDFILE"
  [ "$killed" = 1 ] && echo "sherpa 服务已停止" || echo "sherpa 服务未在运行"
}

status() {
  if is_running; then
    echo "sherpa 服务运行中 (pid $(cat "$PIDFILE" 2>/dev/null || echo '(孤儿)'))"
    local token
    token="$(read_token)"
    if [ -n "$token" ]; then
      curl -fsS -m 5 -H "Authorization: Bearer $token" "http://127.0.0.1:$PORT/health" 2>/dev/null || echo "健康检查失败，日志: $LOG"
    else
      curl -fsS -m 5 "http://127.0.0.1:$PORT/health" 2>/dev/null || echo "健康检查失败，日志: $LOG"
    fi
    echo
  else
    echo "sherpa 服务未运行"
  fi
}

run() {
  stop >/dev/null 2>&1 || true
  local token lang
  token="$(read_token)"
  lang="$(read_language)"
  local -a envs=()
  [ -n "$token" ] && envs+=(PI_SHERPA_TOKEN="$token")
  [ -n "$lang" ] && envs+=(PI_SHERPA_LANGUAGE="$lang")
  exec env "${envs[@]}" "$VENV/bin/python" "$SERVER"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  run) run ;;
  *) echo "用法: $0 {start|stop|restart|status|run}"; exit 1 ;;
esac
