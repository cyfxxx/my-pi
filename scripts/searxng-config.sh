#!/usr/bin/env bash
# searxng-config.sh — 生成 SearXNG settings.yml（迁移自 pi-tools searxng/generate-config.sh）
#
# 背景/注意（原项目经验）：默认 SearXNG 会启用一批被 GFW 封锁的引擎（google/duckduckgo/
# brave/wikipedia/wikidata…），它们在本机网络下全部 timeout，且阻塞整次搜索直到超时，
# 表现为 web_search 返回空结果或超时。因此必须显式把不可达引擎 disabled，并把 bing 的
# base_url 指向 https://cn.bing.com。
#
# 用法:
#   bash scripts/searxng-config.sh           已存在则跳过（幂等）
#   bash scripts/searxng-config.sh --force   强制重新生成（国内可达默认分组）
#   bash scripts/searxng-config.sh --probe   连通性探测后生成（可达启用/不可达禁用）
#   bash scripts/searxng-config.sh --force --probe
#
# 环境变量:
#   SEARXNG_HOME    SearXNG 安装目录（默认 /opt/searxng），settings 写为 $SEARXNG_HOME/settings.yml
#   SEARXNG_PORT    监听端口（默认 8889）
set -e

DIR="${SEARXNG_HOME:-/opt/searxng}"
PORT="${SEARXNG_PORT:-8889}"
CONFIG="$DIR/settings.yml"

FORCE=0; PROBE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --probe) PROBE=1 ;;
    *) echo "未知参数: $arg（支持 --force / --probe）" >&2 ;;
  esac
done

if [ -f "$CONFIG" ] && [ "$FORCE" != "1" ]; then
  echo "settings.yml 已存在，跳过（--force 覆盖 / --probe 探测后覆盖）"
  exit 0
fi

# 候选引擎: "名称|探测URL"（bing 保留 base_url 特写）
ENGINE_PROBES=(
  "baidu|https://www.baidu.com"
  "bing|https://cn.bing.com"
  "sogou|https://www.sogou.com"
  "360search|https://www.so.com"
  "bilibili|https://search.bilibili.com"
  "yandex|https://yandex.com"
  "stackoverflow|https://stackoverflow.com"
  "github|https://github.com"
  "google|https://www.google.com"
  "duckduckgo|https://duckduckgo.com"
  "wikipedia|https://zh.wikipedia.org"
  "brave|https://search.brave.com"
  "yahoo|https://search.yahoo.com"
  "startpage|https://www.startpage.com"
  "wikidata|https://www.wikidata.org"
)

probe_reachable() {
  local url="$1" code
  code=$(curl -sI -o /dev/null -w '%{http_code}' --max-time 4 -A "Mozilla/5.0" "$url" 2>/dev/null)
  [ "$code" != "000" ] && [ -n "$code" ]
}

REACHABLE=""
if [ "$PROBE" = "1" ]; then
  echo "探测 ${#ENGINE_PROBES[@]} 个引擎连通性（每个最多 4s）..."
  for entry in "${ENGINE_PROBES[@]}"; do
    name="${entry%%|*}"; url="${entry##*|}"
    if probe_reachable "$url"; then REACHABLE="$REACHABLE $name"; echo "  ✓ $name ($url)"
    else echo "  ✗ $name ($url)"; fi
  done
fi

engine_disabled() {
  local name="$1"
  if [ "$PROBE" = "1" ]; then
    case " $REACHABLE " in *" $name "*) echo "false" ;; *) echo "true" ;; esac
  else
    case "$name" in
      baidu|bing|sogou|360search|bilibili|yandex|stackoverflow|github) echo "false" ;;
      *) echo "true" ;;
    esac
  fi
}

# 保留已有 secret_key（避免每次重建使会话失效）；无则生成
SECRET_KEY=""
if [ -f "$CONFIG" ]; then
  SECRET_KEY=$(sed -n 's/^[[:space:]]*secret_key:[[:space:]]*"\(.*\)".*/\1/p' "$CONFIG" | head -1)
fi
[ -n "$SECRET_KEY" ] || SECRET_KEY=$(python3 -c "import secrets;print(secrets.token_hex(32))")

mkdir -p "$DIR"
cat > "$CONFIG" <<CONFIGEOF
use_default_settings: true

general:
  debug: false
  instance_name: "my-pi SearXNG"

search:
  safe_search: 0
  autocomplete: 'duckduckgo'
  formats:
    - html
    - json

server:
  secret_key: "$SECRET_KEY"
  limiter: false
  image_proxy: true
  bind_address: "127.0.0.1"
  port: $PORT

ui:
  static_use_hash: true
  default_theme: simple
  default_locale: zh-Hans-CN

enabled_plugins:
  - 'Basic Calculator'
  - 'Hash plugin'
  - 'Self Information'
  - 'Tracker URL scraper'
  - 'Search on category select'

outgoing:
  request_timeout: 10
  max_request_timeout: 30
  useragent_suffix: ""
  max_redirects: 5

engines:
$(for entry in "${ENGINE_PROBES[@]}"; do
  name="${entry%%|*}"
  echo "  - name: $name"
  if [ "$name" = "bing" ]; then
    echo "    engine: bing"
    echo "    base_url: https://cn.bing.com"
  fi
  echo "    disabled: $(engine_disabled "$name")"
done)
CONFIGEOF

chmod 600 "$CONFIG"
echo "已生成 $CONFIG（secret_key 已写入，不回显）"

# 自动重启（若正在运行）
PID_FILE="$DIR/searxng.pid"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "检测到 SearXNG 运行中，重启以加载新配置..."
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  sleep 1
  rm -f "$PID_FILE"
  echo "已停止旧进程；执行 bash scripts/setup-external.sh web 重新启动。"
fi
