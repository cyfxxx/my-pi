#!/usr/bin/env node
/**
 * daily-health.mjs — 每日健康度量（确定性、零 LLM，只读数据源，仅追加日志）
 *
 * 迁移自 pi-tools `scripts/maintenance/daily-health.mjs`，按 my-pi 数据布局适配：
 *   - 加权命中率 / 未命中每次 / 输出占比：`portable/memory/context/.usage-diag.jsonl`
 *     （`context/usage-diag/diag.ts` 产出的**每轮**用量，含 input/cacheRead/output），
 *     过去 24h ΣcacheRead / Σ(input+cacheRead)。**注意不要改用 `context/usage.jsonl`**：
 *     那是工具级台账，只有 outputTokens，没有缓存字段 → 命中率恒为 n/a（2026-09-26..29
 *     的日报连续多天 n/a，命中率跌到 80% 也未告警）。
 *   - 前缀前端变更次数：`portable/memory/logs/prefix-fingerprints.jsonl`，system/tools/
 *     head/level 任一变化都使整段前缀缓存失效（每次≈一次全价重算），是成本退化的先行指标。
 *   - 存储：`portable/memory/entries.json` 大小/条目数
 *   - 种子-任务失配：`portable/agent/scheduled-seeds.json` vs `portable/memory/scheduler/tasks.json`
 *   - 守门脚本防篡改：关键守门脚本有未提交改动 → alert
 *
 * 环境变量：`PI_HEALTH_HIT_FLOOR`（默认 0.97）、`PI_HEALTH_UNCACHED_CEIL`（默认 3000）。
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
// 每轮真实用量（含 input/cacheRead/output/reasoning）。`usage.jsonl` 只有工具级 outputTokens，
// 拿它算命中率永远是 n/a —— 2026-09-26..09-29 的日报因此连续多天写 "命中=n/a(无数据)"，
// 命中率跌到 80% 也没触发告警。这里改读用量诊断文件（context/usage-diag/diag.ts 产出）。
const USAGE_DIAG = process.env.PI_USAGE_DIAG_FILE || join(MEM, 'context', '.usage-diag.jsonl');
// 运行时前缀指纹（context/budget/prefix-fingerprint.ts 产出）：分段记录 system/tools/head/
// level/total 的变化，前端任一变化即整段缓存失效。
const FINGERPRINTS = process.env.PI_PREFIX_FINGERPRINT_FILE || join(MEM, 'logs', 'prefix-fingerprints.jsonl');
/** 缓存安全线：低于此命中率视为退化（日常应在 97% 以上；加权口径） */
const HIT_FLOOR = Number(process.env.PI_HEALTH_HIT_FLOOR) || 0.97;
/** 每次调用的未命中输入上限：超过说明存在整段重算 */
const UNCACHED_PER_CALL_CEIL = Number(process.env.PI_HEALTH_UNCACHED_CEIL) || 3000;
const ENTRIES = join(MEM, 'entries.json');
const SEEDS = join(AGENT, 'scheduled-seeds.json');
const TASKS = join(MEM, 'scheduler', 'tasks.json');
const LOG = join(MEM, 'logs', 'daily-health.log');
const WINDOW_MS = 24 * 60 * 60 * 1000;
const PRINT_ONLY = process.argv.includes('--print');

const reasons = [];

function loadJSONL(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) {
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

function loadUsage() {
  return loadJSONL(USAGE);
}

const now = Date.now();
const inWindow = (r) => r.ts >= now - WINDOW_MS;

// 主口径：每轮用量（含缓存字段）。usage.jsonl 仅作工具级调用计数兜底。
const diag = loadJSONL(USAGE_DIAG).filter(inWindow);
const records = diag.filter((r) => typeof r.input === 'number' && typeof r.cacheRead === 'number');
const usage = loadUsage().filter(inWindow);

const totInput = records.reduce((a, r) => a + (r.input || 0), 0);
const totCacheRead = records.reduce((a, r) => a + (r.cacheRead || 0), 0);
const totOutput = records.reduce((a, r) => a + (r.output || 0), 0);
const denom = totInput + totCacheRead;
const hit = denom > 0 ? totCacheRead / denom : null;
const uncachedPerCall = records.length > 0 ? totInput / records.length : null;

// 前端变更：system/tools/head/level 任一变化都会让整段前缀失效（每个都是一次全价重算）
const fps = loadJSONL(FINGERPRINTS).filter(inWindow);
const FRONT_SEGMENTS = new Set(['system', 'tools', 'head', 'level']);
const frontChanges = fps.filter((f) => (f.changed || []).some((c) => FRONT_SEGMENTS.has(c)));
const totalOnly = fps.filter((f) => (f.changed || []).includes('total'));

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

if (records.length >= 3 && hit !== null && hit < HIT_FLOOR) {
  reasons.push(`加权命中率 ${(hit * 100).toFixed(1)}%<${(HIT_FLOOR * 100).toFixed(0)}%`);
}
if (records.length >= 3 && uncachedPerCall !== null && uncachedPerCall > UNCACHED_PER_CALL_CEIL) {
  reasons.push(`未命中/轮 ${Math.round(uncachedPerCall)}>${UNCACHED_PER_CALL_CEIL}（疑似整段重算）`);
}
if (frontChanges.length > 0) {
  const segs = [...new Set(frontChanges.flatMap((f) => f.changed.filter((c) => FRONT_SEGMENTS.has(c))))].join('+');
  reasons.push(`前缀前端变更 ${frontChanges.length} 次（${segs}）→ 每次整段缓存失效`);
}
const verdict = reasons.length ? 'alert' : 'ok';

const ts = new Date();
const p = (n) => String(n).padStart(2, '0');
const stamp = `${ts.getFullYear()}-${p(ts.getMonth() + 1)}-${p(ts.getDate())} ${p(ts.getHours())}:${p(ts.getMinutes())}`;
const hitStr = hit === null ? 'n/a(无数据)' : `${(hit * 100).toFixed(1)}%`;
const unStr = uncachedPerCall === null ? 'n/a' : String(Math.round(uncachedPerCall));
const outPct = totInput + totCacheRead + totOutput > 0 ? ((totOutput / (totInput + totCacheRead + totOutput)) * 100).toFixed(1) : 'n/a';
const line = `${stamp} 命中=${hitStr} 未命中/轮=${unStr} 输出占比=${outPct}% 前端变更=${frontChanges.length} 轮数=${records.length} 工具调用=${usage.length} 存储=${sizeMB.toFixed(2)}MB 条目=${entryCount} 种子失配=${seedDrift} 结论=${verdict}`;

console.log(line);
if (totalOnly.length > 0) console.log(`  └ 提示: ${totalOnly.length} 次请求中段内容被改写（changed=total，命中率之外的前缀风险）`);
if (verdict === 'alert') console.log('  └ 原因: ' + reasons.join('；'));
if (!PRINT_ONLY) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, line + '\n');
  if (verdict === 'alert') appendFileSync(LOG, `  └ 原因: ${reasons.join('；')}\n`);
}
