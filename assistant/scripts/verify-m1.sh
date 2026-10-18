#!/usr/bin/env bash
# M1 最小闭环的可执行验收：一条命令跑完四项，全绿才算过。
#   ① 宿主起来（仓内 vendored DSH，独立 home，独立端口）
#   ② 终端前端（pi-tui）在真实 pty 里能对话
#   ③ 同一会话两个客户端直播流逐字一致（TUI ↔ Web 的数据同步）
#   ④ 本地模型路线真的打到本机端点（在线路线默认跳过，避免烧额度；MYPI_VERIFY_ONLINE=1 打开）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
PORT="${MYPI_PORT:-3099}"
HOME_DIR="$ROOT/.run/home"
MOCK_LOG="$ROOT/.run/mock-requests.log"
export MYPI_HOME="$HOME_DIR" MYPI_PORT="$PORT"
export MY_PI_DSH_EXTRA_PATCH="$ROOT/spike/local-provider.patch.yml"   # 插件由 mypi.sh 默认挂上
export LOCAL_MOCK_KEY="sk-local-dummy"
export MYPI_NOTES_FILE="$ROOT/.run/notes.md"

fail=0
say() { printf '\n=== %s ===\n' "$1"; }

say "⓪ 插件产物"
if [ ! -f "$ROOT/plugin/dist/plugin.mjs" ]; then
  echo "→ 构建 assistant/plugin（缺产物）"
  ( cd "$ROOT/.." && node_modules/.bin/esbuild assistant/plugin/entry.ts --bundle --format=esm \\
      --platform=node --packages=external --outfile=assistant/plugin/dist/plugin.mjs --log-level=warning ) \
    || { echo "✗ 插件构建失败"; exit 1; }
fi
echo "✓ 插件产物就绪"

say "① 本机模型端点（mock OpenAI 兼容）"
mkdir -p .run
# 清掉上一次遗留的 mock（否则新进程 EADDRINUSE，而旧进程写的是别的日志 ⇒ 假绿）
pids=$(pgrep -f "^node .*mock-openai\.mjs" || true)
[ -n "$pids" ] && kill $pids 2>/dev/null
sleep 1
: >"$MOCK_LOG"
node spike/mock-openai.mjs 11435 "$MOCK_LOG" "我是本地模型，在你机器上跑。" >.run/mock.log 2>&1 &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null' EXIT
sleep 1
curl -sf http://127.0.0.1:11435/v1/models >/dev/null || { echo "✗ 端点没起来"; tail -3 .run/mock.log; exit 1; }
grep -q "mock openai on" .run/mock.log || { echo "✗ 端口被别的实例占着（日志里没有本进程的启动行）"; exit 1; }
echo "✓ 端点就绪"

say "② 宿主"
# 先清掉占着端口的旧宿主：否则新进程起不来，只会看到一堆"缺少服务"（假象，真因是 EADDRINUSE）
pids=$(pgrep -f "^node .*--profile mypi-web" || true)
[ -n "$pids" ] && kill $pids 2>/dev/null
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && sleep 0.5 || break; done
rm -f .run/url
setsid bash scripts/mypi.sh web >.run/verify-host.out 2>&1 &
for _ in $(seq 1 240); do [ -s .run/url ] && break; sleep 0.5; done
URL="$(cat .run/url 2>/dev/null || true)"
[ -n "$URL" ] && echo "✓ 宿主就绪（$PORT）" || { echo "✗ 宿主没起来"; tail -5 .run/host.log; exit 1; }

say "③ 终端前端（真实 pty）"
MYPI_PROVIDER=local MYPI_MODEL=mock-local \
  timeout 90 python3 test/tui-pty.py --via-launcher "$URL" "你是谁" "我是本地模型" || fail=1

say "④ 两端同步"
timeout 60 node test/sync.mjs "$URL" || fail=1

say "⑤ 本地模型路线"
timeout 60 node test/local-route.mjs "$URL" "$MOCK_LOG" || fail=1

say "⑥ 自写插件工具（工具面 + 真执行 + 结果回灌）"
: >"$MYPI_NOTES_FILE" 2>/dev/null || true
timeout 90 node test/plugin-tool.mjs "$URL" "$MOCK_LOG" "$MYPI_NOTES_FILE" || fail=1

say "⑦ Web 前端（同一宿主的 SPA）"
rm -f .run/cookies.txt
WEB_CODE="$(curl -sL -c .run/cookies.txt -o .run/web.html -w '%{http_code}' "$URL")"
if [ "$WEB_CODE" = "200" ] && grep -q 'id="root"' .run/web.html; then
  echo "✓ Web 入口 200 且挂载了 SPA"
else
  echo "✗ Web 入口异常（HTTP $WEB_CODE）"; fail=1
fi

say "⑧ 复原默认模型（用例选过本地，会把 profile 默认改掉）"
timeout 60 node -e "
import('$ROOT/src/transport.mjs').then(async ({ HostClient }) => {
  const c = await new HostClient({ url: process.argv[1] }).connect();
  const { value } = await c.call('session/create', { request: { cwd: '$ROOT' } });
  await c.call('session/selectModel', { request: { sessionId: value.sessionId, provider: 'deepseek-official', model: 'deepseek-flash' } });
  process.exit(0);
});" "$URL" && echo "✓ 默认模型已复原为 online" || { echo "✗ 复原失败"; fail=1; }

say "结果"
if [ "$fail" -eq 0 ]; then echo "🎉 M1 五项全过"; else echo "❌ 有红项（见上）"; fi
exit "$fail"
