#!/usr/bin/env bash
# 自优化闭环的"定时维护"入口（本地 cron 友好，零 LLM）：
#   ① 生命周期报告（只读候选）
#   ② 教训挖掘（默认只读；--ingest 才写库）
#   ③ 摘要修剪（把 summaries.json 压到上限内）
#
# 用法：
#   bash assistant/scripts/maintain.sh              # 报告 + 只读挖掘
#   bash assistant/scripts/maintain.sh --ingest     # 顺带把教训写进记忆库
#
# cron 示例（每天 03:17）：
#   17 3 * * * cd /path/to/my-pi && bash assistant/scripts/maintain.sh >> .run/maintain.log 2>&1
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
NODE="${MYPI_NODE:-node}"
INGEST=""
[ "${1:-}" = "--ingest" ] && INGEST="--ingest"

say() { printf '\n=== %s ===\n' "$1"; }

say "记忆库"
"$NODE" "$ROOT/dist/memory-lifecycle.mjs" 2>&1 | head -40

say "教训挖掘$([ -n "$INGEST" ] && echo '（写库）' || echo '（只读）')"
"$NODE" "$ROOT/dist/lesson-miner.mjs" $INGEST 2>&1 | head -20

say "摘要修剪"
"$NODE" - "$ROOT/memory/summaries.json" <<'NODE_EOF'
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const file = process.argv[2];
if (!existsSync(file)) { console.log('（还没有 summaries.json）'); process.exit(0); }
try {
  const store = JSON.parse(readFileSync(file, 'utf8'));
  const before = store.summaries.length;
  store.summaries = store.summaries.slice(-50);
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`${before} → ${store.summaries.length} 条（上限 50）`);
} catch (error) {
  console.log(`读取失败（跳过）：${error.message}`);
}
NODE_EOF

say "维护完成"
