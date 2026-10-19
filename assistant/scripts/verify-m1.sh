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
export MY_PI_DSH_EXTRA_PATCH="$ROOT/profile/local-provider.patch.yml"   # 插件由 mypi.sh 默认挂上
export LOCAL_MOCK_KEY="sk-local-dummy"
export MYPI_NOTES_FILE="$ROOT/.run/notes.md"
export SEARXNG_URL="http://127.0.0.1:8899"
export MYPI_MEMORY_FILE="$ROOT/.run/memory-test.json"
export MYPI_SUMMARIES_FILE="$ROOT/.run/summaries-test.json"

fail=0
say() { printf '\n=== %s ===\n' "$1"; }

say "⓪ 插件产物"
if [ ! -f "$ROOT/plugin/dist/plugin.mjs" ]; then
  echo "→ 构建产物（插件 + 脚本）"
  bash "$ROOT/scripts/build.sh" >/dev/null || { echo "✗ 构建失败（先 npm install 或装 esbuild）"; exit 1; }
fi
echo "✓ 插件产物就绪"

say "① 本机模型端点（mock OpenAI 兼容）"
mkdir -p .run
# 清掉上一次遗留的 mock（否则新进程 EADDRINUSE，而旧进程写的是别的日志 ⇒ 假绿）
pids=$(pgrep -f "^node .*mock-openai\.mjs" || true)
[ -n "$pids" ] && kill $pids 2>/dev/null
sleep 1
: >"$MOCK_LOG"
: >"$ROOT/.run/searxng-requests.log"
pids=$(pgrep -f "^node .*mock-searxng\.mjs" || true)
[ -n "$pids" ] && kill $pids 2>/dev/null
setsid node "$ROOT/spike/mock-searxng.mjs" 8899 "$ROOT/.run/searxng-requests.log" >.run/mock-searxng.log 2>&1 &
SEARXNG_PID=$!
node spike/mock-openai.mjs 11435 "$MOCK_LOG" "我是本地模型，在你机器上跑。" >.run/mock.log 2>&1 &
MOCK_PID=$!
cleanup() {
  kill "$MOCK_PID" ${SEARXNG_PID:-} 2>/dev/null
  node "$ROOT/host/launch.mjs" stop >/dev/null 2>&1 || true
  # 兜底：清掉任何以我们 profile 名起的宿主
  local pids; pids=$(pgrep -f "^node .*--profile mypi" || true)
  [ -n "$pids" ] && kill $pids 2>/dev/null
}
trap cleanup EXIT
sleep 1
curl -sf http://127.0.0.1:11435/v1/models >/dev/null || { echo "✗ 端点没起来"; tail -3 .run/mock.log; exit 1; }
grep -q "mock openai on" .run/mock.log || { echo "✗ 端口被别的实例占着（日志里没有本进程的启动行）"; exit 1; }
echo "✓ 端点就绪"

say "② 宿主"
# 先清掉占着端口的旧宿主：否则新进程起不来，只会看到一堆"缺少服务"（假象，真因是 EADDRINUSE）
node "$ROOT/host/launch.mjs" stop >/dev/null 2>&1 || true
pids=$(pgrep -f "^node .*--profile mypi" || true)
[ -n "$pids" ] && kill $pids 2>/dev/null
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && sleep 0.5 || break; done
rm -f .run/url
MYPI_WITH_FACADE="${MYPI_WITH_FACADE:-}" setsid bash scripts/mypi.sh web >.run/verify-host.out 2>&1 &
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

say "⑦ 断奶断言（无 facade + 工具面上限）"
timeout 90 node test/no-facade.mjs "$URL" "$MOCK_LOG" 40 || fail=1

say "⑧ Web 前端（同一宿主的 SPA）"
rm -f .run/cookies.txt
WEB_CODE="$(curl -sL -c .run/cookies.txt -o .run/web.html -w '%{http_code}' "$URL")"
if [ "$WEB_CODE" = "200" ] && grep -q 'id="root"' .run/web.html; then
  echo "✓ Web 入口 200 且挂载了 SPA"
else
  echo "✗ Web 入口异常（HTTP $WEB_CODE）"; fail=1
fi

say "⑨ 网络搜索（SearXNG 接缝）"
timeout 120 node test/web-search.mjs "$URL" "$ROOT/.run/searxng-requests.log" || fail=1

say "⑩ tmux 工具（真链路；没装 tmux 则 SKIP）"
if command -v tmux >/dev/null 2>&1; then
  timeout 120 node test/tmux.mjs "$URL" || fail=1
else
  echo "- SKIP：本机没有 tmux"
fi

say "⑪ 记忆检索排序（BM25 + 质量分 + MMR + 环境过滤）"
timeout 30 node test/retrieval.mjs || fail=1

say "⑫ 自优化管线脚本（入库 / 知识订阅 / 生命周期 / 教训挖掘）"
timeout 60 node test/scripts.mjs || fail=1

say "⑬ 记忆库完整性（迁移保真：schema/条数/字段/环境）"
timeout 30 node test/memory-store.mjs || fail=1

say "⑭ 长期记忆（工具 + append-only 注入 + 前缀稳定）"
rm -f "$MYPI_MEMORY_FILE"
timeout 150 node test/memory.mjs "$URL" "$MOCK_LOG" "$MYPI_MEMORY_FILE" || fail=1

say "⑮ 用量记录（工具名/耗时/成败，不记参数）"
rm -rf "$ROOT/.run/stats"
timeout 120 node test/plugin-tool.mjs "$URL" "$MOCK_LOG" "$MYPI_NOTES_FILE" >/dev/null 2>&1
timeout 30 node test/stats.mjs "$ROOT/.run/stats/tool-events.jsonl" || fail=1

say "⑯ 意图账本（逐字保留有信息量的输入、过滤推进语、重复折叠）"
rm -rf "$ROOT/.run/intents"
timeout 150 node test/intent.mjs "$URL" "$MOCK_LOG" "$ROOT/.run/intents" || fail=1

say "⑰ 会话摘要（回合结束落摘要 + 检索可带回）"
rm -f "$ROOT/.run/summaries-test.json"
timeout 150 node test/summaries.mjs "$URL" "$MYPI_SUMMARIES_FILE" || fail=1

say "⑱ 社区 TUI 集成（未安装则 SKIP）"
timeout 90 bash test/tui-community.sh || fail=1

say "⑲ 自动化组合（DSH 原生 schedule 可挂载）"
MYPI_HOME="$ROOT/.run/home-schedule" timeout 200 bash test/schedule-compose.sh || fail=1

say "⑳ 关闭登录（账号三行禁用、API-key 路线保留）"
MYPI_HOME="$ROOT/.run/home-nologin" timeout 200 bash test/no-login.sh || fail=1

say "㉑ 复原默认模型（用例选过本地，会把 profile 默认改掉）"
timeout 60 node -e "
import('$ROOT/src/transport.mjs').then(async ({ HostClient }) => {
  const c = await new HostClient({ url: process.argv[1] }).connect();
  const { value } = await c.call('session/create', { request: { cwd: '$ROOT' } });
  await c.call('session/selectModel', { request: { sessionId: value.sessionId, provider: 'deepseek-official', model: 'deepseek-flash' } });
  process.exit(0);
});" "$URL" && echo "✓ 默认模型已复原为 online" || { echo "✗ 复原失败"; fail=1; }

say "结果"
if [ "$fail" -eq 0 ]; then echo "🎉 验收全部通过（21 项）"; else echo "❌ 有红项（见上）"; fi
exit "$fail"
