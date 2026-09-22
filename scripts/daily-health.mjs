#!/usr/bin/env node
/**
 * daily-health.mjs — 每日健康度量（确定性、零 LLM，只读数据源，仅追加日志）
 *
 * 迁移自 pi-tools `scripts/maintenance/daily-health.mjs`，按 my-pi 数据布局适配：
 *   - 命中率：`portable/memory/context/usage.jsonl`（`context/usage-stats.ts` 产出，
 *     过去 24h ΣcacheRead / Σ(input+cacheRead)）；无数据时命中率记 n/a
 *   - 存储：`portable/memory/entries.json` 大小/条目数
 *   - 种子-任务失配：`portable/agent/scheduled-seeds.json` vs `portable/memory/scheduler/tasks.json`
 *   - 守门脚本防篡改：关键守门脚本有未提交改动 → alert
 *
 * 用法：
 *   node scripts/daily-health.mjs           # 计算并追加 portable/memory/logs/daily-health.log
 *   node scripts/daily-health.mjs --print   # 只输出不落盘
 */
import { readFileSync, statSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = process.env.PI_CODING_AGENT_DIR || join(ROOT, 'portable', 'agent');
const MEM = process.env.PI_MEMORY_DIR || join(ROOT, 'portable', 'memory');
const USAGE = process.env.PI_USAGE_FILE || join(MEM, 'context', 'usage.jsonl');
const ENTRIES = join(MEM, 'entries.json');
const SEEDS = join(AGENT, 'scheduled-seeds.json');
const TASKS = join(MEM, 'scheduler', 'tasks.json');
const LOG = join(MEM, 'logs', 'daily-health.log');
const WINDOW_MS = 24 * 60 * 60 * 1000;
const PRINT_ONLY = process.argv.includes('--print');

const reasons = [];

function loadUsage() {
  if (!existsSync(USAGE)) return [];
  const out = [];
  for (const l of readFileSync(USAGE, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      const ts = typeof r.ts === 'number' ? r.ts : Date.parse(r.ts);
      if (Number.isFinite(ts)) out.push({ ...r, ts });
    } catch {
      /* 跳过损坏行 */
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

const now = Date.now();
const usage = loadUsage().filter((r) => r.ts >= now - WINDOW_MS);
const totInput = usage.reduce((a, r) => a + (r.input || 0), 0);
const totCacheRead = usage.reduce((a, r) => a + (r.cacheRead || 0), 0);
const denom = totInput + totCacheRead;
const hit = denom > 0 ? totCacheRead / denom : null;

let entryCount = 0;
let sizeMB = 0;
try {
  sizeMB = statSync(ENTRIES).size / 1024 / 1024;
  const d = JSON.parse(readFileSync(ENTRIES, 'utf8'));
  entryCount = Array.isArray(d) ? d.length : (d.entries?.length ?? 0);
} catch {
  /* 缺失时保持 0 */
}

let seedDrift = 0;
try {
  const seeds = JSON.parse(readFileSync(SEEDS, 'utf8')).tasks || [];
  const local = {};
  try {
    for (const x of JSON.parse(readFileSync(TASKS, 'utf8')).tasks || []) local[x.name] = x;
  } catch {
    /* 无本地任务文件视为全部未注册 */
  }
  for (const s of seeds) {
    if (!local[s.name]) {
      seedDrift++;
      reasons.push(`种子任务 ${s.name} 未注册`);
    } else if (local[s.name].schedule && s.schedule && local[s.name].schedule !== s.schedule) {
      seedDrift++;
      reasons.push(`种子任务 ${s.name} schedule 漂移(${local[s.name].schedule}≠${s.schedule})`);
    } else if (typeof local[s.name].prompt === 'string' && s.prompt && local[s.name].prompt !== s.prompt) {
      seedDrift++;
      reasons.push(`种子任务 ${s.name} prompt 漂移`);
    }
  }
} catch {
  /* seeds 缺失不阻塞 */
}

const GUARD_SCRIPTS = ['scripts/golden-tasks.sh', 'scripts/daily-health.mjs', 'scripts/check-isolation.sh', 'scripts/check-features.sh'];
try {
  const out = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...GUARD_SCRIPTS], { encoding: 'utf8', timeout: 5000 });
  const dirty = out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  if (dirty.length) reasons.push(`守门脚本有未提交改动: ${dirty.join(', ')}`);
} catch {
  /* git 不可用不阻塞 */
}

if (usage.length >= 3 && hit !== null && hit < 0.9) reasons.push(`命中率 ${(hit * 100).toFixed(1)}%<90%`);
const verdict = reasons.length ? 'alert' : 'ok';

const ts = new Date();
const p = (n) => String(n).padStart(2, '0');
const stamp = `${ts.getFullYear()}-${p(ts.getMonth() + 1)}-${p(ts.getDate())} ${p(ts.getHours())}:${p(ts.getMinutes())}`;
const hitStr = hit === null ? 'n/a(无数据)' : `${(hit * 100).toFixed(1)}%`;
const line = `${stamp} 命中=${hitStr} 调用=${usage.length} 存储=${sizeMB.toFixed(2)}MB 条目=${entryCount} 种子失配=${seedDrift} 结论=${verdict}`;

console.log(line);
if (verdict === 'alert') console.log('  └ 原因: ' + reasons.join('；'));
if (!PRINT_ONLY) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, line + '\n');
  if (verdict === 'alert') appendFileSync(LOG, `  └ 原因: ${reasons.join('；')}\n`);
}
