#!/usr/bin/env node
/**
 * tool-stats-sync — 工具使用统计的每日聚合计数同步
 *
 * 迁移自 pi-tools `agent/extensions/pi-context/scripts/tool-stats-sync.mjs`，
 * 按 my-pi 数据布局适配：原始事件源为 `context/usage-stats.ts` 产出的
 * `portable/memory/context/usage.jsonl`（每行一次工具调用的 token/缓存计数），
 * 不再依赖旧的 `tool-use-<device>.jsonl`。
 *
 * 同步模型：
 *   - `--daily`：聚合本机保留窗口事件 → 精简计数 `portable/memory/stats/tool-count-<device>.json`
 *     （每工具调用次数+首末时间，几 KB，可 git 入库共享）
 *   - 默认：合并各设备计数文件 + 本机日内增量 → `portable/agent/stats/tool-usage.json`（本地视图）
 *   - `--prune`：清理本机 usage.jsonl 中超过保留窗口的事件
 *   - `--report`：只输出报告不写文件
 *   - `--days=N`：保留窗口（默认 30）
 */
import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = process.env.PI_CODING_AGENT_DIR || join(ROOT, 'portable', 'agent');
const MEM = process.env.PI_MEMORY_DIR || join(ROOT, 'portable', 'memory');
const EVENTS_FILE = process.env.PI_USAGE_FILE || join(MEM, 'context', 'usage.jsonl');
const STATS_DIR = join(MEM, 'stats');
const TOOL_USAGE = join(AGENT, 'stats', 'tool-usage.json');

const args = process.argv.slice(2);
const ONLY_PRUNE = args.includes('--prune');
const ONLY_REPORT = args.includes('--report');
const DAILY = args.includes('--daily');
const DAYS_ARG = args.find((a) => a.startsWith('--days='));
const RETENTION_DAYS_DEFAULT = 30;
const DAYS_RAW = DAYS_ARG ? DAYS_ARG.slice('--days='.length) : '';
const DAYS_PARSED = DAYS_ARG ? parseInt(DAYS_RAW, 10) : RETENTION_DAYS_DEFAULT;
// 非法值（NaN/<=0）不能流入 cutoff 计算（NaN 会让剪枝失效并把本机计数覆写为 0）
const RETENTION_DAYS = Number.isFinite(DAYS_PARSED) && DAYS_PARSED > 0 ? DAYS_PARSED : RETENTION_DAYS_DEFAULT;
if (DAYS_ARG && RETENTION_DAYS !== DAYS_PARSED) {
  console.warn(`⚠ --days=${DAYS_RAW} 无效（需为 > 0 的整数），回退默认 ${RETENTION_DAYS_DEFAULT} 天`);
}

const DEVICE = process.env.PI_DEVICE_ID || hostname() || 'host';
const DEVICE_TAG = DEVICE.replace(/[^A-Za-z0-9._-]/g, '_');
const COUNT_FILE = join(STATS_DIR, `tool-count-${DEVICE_TAG}.json`);
const DAY_MS = 24 * 60 * 60 * 1000;

const fmtDT = (ts) => {
  if (!ts || !Number.isFinite(ts)) return '-';
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

function parseLine(line) {
  try {
    const e = JSON.parse(line);
    const ts = typeof e.ts === 'number' ? e.ts : Date.parse(e.ts);
    if (!Number.isFinite(ts) || typeof e.tool !== 'string' || !e.tool) return null;
    return { ts, tool: e.tool, input: e.input ?? 0, cacheRead: e.cacheRead ?? 0, cacheWrite: e.cacheWrite ?? 0 };
  } catch {
    return null;
  }
}

/** 读取本机 usage.jsonl 保留窗口内的事件 */
function loadLocalEvents() {
  if (!existsSync(EVENTS_FILE)) return [];
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  const events = [];
  for (const line of readFileSync(EVENTS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = parseLine(line);
    if (e && e.ts >= cutoff) events.push(e);
  }
  return events.sort((a, b) => a.ts - b.ts);
}

function loadCountFiles() {
  const counts = {};
  if (!existsSync(STATS_DIR)) return counts;
  for (const name of readdirSync(STATS_DIR)) {
    if (!name.startsWith('tool-count-') || !name.endsWith('.json')) continue;
    const device = name.slice('tool-count-'.length, -'.json'.length);
    try {
      counts[device] = JSON.parse(readFileSync(join(STATS_DIR, name), 'utf8'));
    } catch {
      /* 损坏计数文件忽略 */
    }
  }
  return counts;
}

function aggregate(events) {
  const acc = new Map();
  for (const e of events) {
    let cur = acc.get(e.tool);
    if (!cur) {
      cur = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, firstTs: e.ts, lastTs: e.ts };
      acc.set(e.tool, cur);
    }
    cur.calls++;
    cur.input += e.input ?? 0;
    cur.cacheRead += e.cacheRead ?? 0;
    cur.cacheWrite += e.cacheWrite ?? 0;
    cur.firstTs = Math.min(cur.firstTs, e.ts);
    cur.lastTs = Math.max(cur.lastTs, e.ts);
  }
  return acc;
}

function mergeCounts(countFiles) {
  const all = new Map();
  for (const [device, data] of Object.entries(countFiles)) {
    const tools = data?.tools || {};
    for (const [tool, v] of Object.entries(tools)) {
      let cur = all.get(tool);
      if (!cur) {
        cur = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, firstTs: Infinity, lastTs: 0, byDevice: {} };
        all.set(tool, cur);
      }
      cur.calls += v.calls ?? 0;
      cur.input += v.input ?? 0;
      cur.cacheRead += v.cacheRead ?? 0;
      cur.cacheWrite += v.cacheWrite ?? 0;
      if (v.firstTs && v.firstTs < cur.firstTs) cur.firstTs = v.firstTs;
      if (v.lastTs && v.lastTs > cur.lastTs) cur.lastTs = v.lastTs;
      cur.byDevice[device] = { calls: v.calls ?? 0, input: v.input ?? 0, lastTs: v.lastTs ?? 0 };
    }
  }
  return all;
}

function overlayLocalDelta(all, generatedAt) {
  const cutoffTs = generatedAt ? new Date(generatedAt).getTime() || 0 : 0;
  const fresh = loadLocalEvents().filter((e) => e.ts > cutoffTs);
  for (const e of fresh) {
    let cur = all.get(e.tool);
    if (!cur) {
      cur = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, firstTs: e.ts, lastTs: e.ts, byDevice: {} };
      all.set(e.tool, cur);
    }
    cur.calls++;
    cur.input += e.input ?? 0;
    cur.cacheRead += e.cacheRead ?? 0;
    cur.firstTs = Math.min(cur.firstTs, e.ts);
    cur.lastTs = Math.max(cur.lastTs, e.ts);
    const d = cur.byDevice[DEVICE] ?? { calls: 0, input: 0, lastTs: 0 };
    d.calls++;
    d.input += e.input ?? 0;
    d.lastTs = Math.max(d.lastTs, e.ts);
    cur.byDevice[DEVICE] = d;
  }
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  renameSync(tmp, path);
}

function pruneLocal() {
  if (!existsSync(EVENTS_FILE)) return 0;
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  const lines = readFileSync(EVENTS_FILE, 'utf8').split('\n');
  const kept = [];
  let removed = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const e = parseLine(line);
    if (e && e.ts < cutoff) removed++;
    else kept.push(line);
  }
  if (removed > 0) {
    const tmp = EVENTS_FILE + '.tmp.' + process.pid;
    writeFileSync(tmp, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
    renameSync(tmp, EVENTS_FILE);
  }
  return removed;
}

function writeDeviceCounts() {
  const events = loadLocalEvents();
  const agg = aggregate(events);
  const tools = {};
  let totalCalls = 0;
  for (const [tool, v] of agg) {
    tools[tool] = { calls: v.calls, input: v.input, cacheRead: v.cacheRead, cacheWrite: v.cacheWrite, firstTs: v.firstTs, lastTs: v.lastTs };
    totalCalls += v.calls;
  }
  const count = { device: DEVICE, generatedAt: new Date().toISOString(), windowDays: RETENTION_DAYS, totalCalls, tools };
  writeJson(COUNT_FILE, count);
  return count;
}

function report(all, countFiles, freshEvents) {
  console.log(`\n工具使用统计（跨设备合并，${RETENTION_DAYS} 天窗口）\n`);
  const devices = [];
  for (const [device, data] of Object.entries(countFiles)) {
    const tools = data?.tools || {};
    let calls = 0;
    let firstTs = Infinity;
    let lastTs = 0;
    for (const v of Object.values(tools)) {
      calls += v.calls ?? 0;
      if (v.firstTs && v.firstTs < firstTs) firstTs = v.firstTs;
      if (v.lastTs && v.lastTs > lastTs) lastTs = v.lastTs;
    }
    devices.push({ device, calls, firstTs, lastTs });
  }
  if (freshEvents.length) {
    const d = devices.find((x) => x.device === DEVICE) || { device: DEVICE, calls: 0, firstTs: Infinity, lastTs: 0 };
    d.calls += freshEvents.length;
    d.lastTs = Math.max(d.lastTs, freshEvents[freshEvents.length - 1].ts);
    if (!devices.some((x) => x.device === DEVICE)) devices.push(d);
  }
  devices.sort((a, b) => b.calls - a.calls);
  console.log('设备         调用数   最早               最晚');
  for (const d of devices) {
    console.log(`${d.device.padEnd(13)} ${String(d.calls).padStart(6)}   ${fmtDT(d.firstTs)}   ${fmtDT(d.lastTs)}`);
  }
  console.log('\n工具            调用数   first    last');
  const rows = [...all.entries()].sort((a, b) => b[1].calls - a[1].calls).slice(0, 20);
  for (const [tool, v] of rows) {
    console.log(`${tool.padEnd(16)} ${String(v.calls).padStart(5)}   ${fmtDT(v.firstTs).slice(5)}   ${fmtDT(v.lastTs).slice(5)}`);
  }
  console.log(`\n聚合已写: ${TOOL_USAGE}`);
}

// ── 主流程 ──
if (ONLY_PRUNE) {
  const n = pruneLocal();
  console.log(`已清理本机(${DEVICE}) ${RETENTION_DAYS} 天前事件 ${n} 条`);
  process.exit(0);
}

let pruned = 0;
let freshEvents = [];
const countFiles = loadCountFiles();
if (DAILY) {
  pruned = pruneLocal();
  const count = writeDeviceCounts();
  if (!ONLY_REPORT) console.log(`已生成本机计数(${DEVICE}) ${count.totalCalls} 次调用 → ${COUNT_FILE.replace(ROOT + '/', '')}`);
}
const all = mergeCounts(countFiles);
if (!DAILY) {
  const mine = countFiles[DEVICE_TAG] || countFiles[DEVICE];
  const cutoffTs = mine?.generatedAt ? new Date(mine.generatedAt).getTime() || 0 : 0;
  freshEvents = loadLocalEvents().filter((e) => e.ts > cutoffTs);
  overlayLocalDelta(all, mine?.generatedAt);
}

if (!ONLY_REPORT) {
  writeJson(TOOL_USAGE, Object.fromEntries(all));
  if (pruned > 0) console.log(`已清理本机(${DEVICE}) ${RETENTION_DAYS} 天前事件 ${pruned} 条`);
}
report(all, countFiles, freshEvents);
