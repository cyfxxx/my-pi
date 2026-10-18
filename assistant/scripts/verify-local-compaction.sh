#!/usr/bin/env bash
# 本地小窗口的压缩判据（慢，约 2 分钟）：瘦身 preset + 内联压缩预算 ⇒ 必须能观测到 compaction/* 事件。
# 不作为主 verify 的一部分（它要连灌 50 轮），单独跑：
#   bash scripts/verify-local-compaction.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
PORT="${MYPI_PORT:-3099}"
export MYPI_HOME="$ROOT/.run/home-cmp-verify" MYPI_PORT="$PORT"
export MYPI_LEAN_TOOLS=1 MYPI_AGENT_PRESET=local
export MYPI_EXTRA_PATCH="$ROOT/profile/local-provider.patch.yml"
export LOCAL_MOCK_KEY="sk-local-dummy"
export MYPI_NOTES_FILE="$ROOT/.run/notes.md"

node host/launch.mjs stop >/dev/null 2>&1
sleep 1
node host/launch.mjs start || exit 1
bash spike/mock.sh start "$ROOT/.run/mock-cmp.log" \
  "$(python3 -c "print('这是本地模型的一段较长的回复，用来把上下文逐步填满，从而观察压缩是否触发。'*10)")" >/dev/null 2>&1
timeout 280 node test/compaction.mjs "$(node host/launch.mjs url)" 50 | tee .run/compaction.json
node host/launch.mjs stop >/dev/null 2>&1
grep -q 'compaction/start' .run/compaction.json || { echo "❌ 没观测到压缩事件"; exit 1; }
echo "✓ 观测到 compaction 事件"
