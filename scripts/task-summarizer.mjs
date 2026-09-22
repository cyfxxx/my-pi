#!/usr/bin/env node
/**
 * task-summarizer — 任务完成批量总结层
 *
 * 迁移自 pi-tools `pi-context/scripts/task-summarizer.mjs`，按 my-pi 适配：
 *   - 数据源：`portable/memory/task-records.jsonl`（`context/budget/task-record.ts` 产出）
 *   - 游标：`portable/memory/stats/summarize-cursor`
 *   - 默认：把"上次总结以来的实质任务"聚合为一份 digest 写入
 *     `portable/memory/daily-results/task-summary-<date>.md`（供每日回顾/子代理消费），并推进游标
 *   - `--spawn`：额外 spawn `my-pi.sh -p` 让 pi 依据 digest 调 memory_store 入库并写 SKILL 草稿
 *     （需已配置 provider；子进程设 PI_DISABLE_TASK_RECORD=1 防递归）
 *   - `--dry-run`：只列出待总结清单，不改游标
 *   - `--since=<ISO>`：覆盖游标起点
 *
 * 用法：
 *   node scripts/task-summarizer.mjs --dry-run
 *   node scripts/task-summarizer.mjs
 *   node scripts/task-summarizer.mjs --spawn
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEM = process.env.PI_MEMORY_DIR || join(ROOT, 'portable', 'memory');
const RECORDS = process.env.PI_TASK_RECORD_FILE || join(MEM, 'task-records.jsonl');
const CURSOR = join(MEM, 'stats', 'summarize-cursor');
const RESULTS_DIR = process.env.PI_DAILY_RESULTS_DIR || join(MEM, 'daily-results');
const SESSION_GAP_MS = 8 * 60 * 1000;

export function parseTaskRecords(raw) {
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && r.type === 'task' && Number.isFinite(r.ts)) out.push(r);
    } catch {
      /* 跳过损坏行 */
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** 按时间间隔切分会话 */
export function groupSessions(records, gapMs = SESSION_GAP_MS) {
  const sessions = [];
  let cur = null;
  for (const r of records) {
    if (!cur || r.ts - cur.lastTs > gapMs) {
      cur = { records: [], lastTs: r.ts };
      sessions.push(cur);
    }
    cur.records.push(r);
    cur.lastTs = r.ts;
  }
  return sessions;
}

/** 实质任务：有工具调用（过滤问候/空话轮） */
export function isSubstantial(r) {
  return (r.tools ?? 0) >= 1;
}

export function buildDigest(records) {
  const substantial = records.filter(isSubstantial);
  const sessions = groupSessions(substantial);
  const lines = [`# 任务总结输入（${substantial.length} 条实质任务 / ${sessions.length} 会话）`, ''];
  for (const [i, s] of sessions.entries()) {
    lines.push(`## 会话 ${i + 1}（${new Date(s.records[0].ts).toISOString()}，${s.records.length} 任务）`);
    for (const r of s.records) {
      lines.push(`- 请求: ${r.userRequest || '(空)'} | 工具 ${r.tools} | ctx ${r.contextTokens}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function readCursor() {
  try {
    const t = new Date(readFileSync(CURSOR, 'utf-8').trim()).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

function writeCursor(ts) {
  try {
    mkdirSync(dirname(CURSOR), { recursive: true });
    writeFileSync(CURSOR, new Date(ts).toISOString(), 'utf-8');
  } catch {
    /* 游标写失败不阻塞 */
  }
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

function main() {
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry-run');
  const SPAWN = args.includes('--spawn');
  const sinceArg = args.find((a) => a.startsWith('--since='));
  const since = sinceArg ? Date.parse(sinceArg.split('=')[1]) : readCursor();

  if (!existsSync(RECORDS)) {
    console.log('无任务记录文件，跳过。');
    return;
  }
  const all = parseTaskRecords(readFileSync(RECORDS, 'utf-8'));
  const fresh = all.filter((r) => r.ts > (Number.isFinite(since) ? since : 0));
  const substantial = fresh.filter(isSubstantial);
  if (substantial.length === 0) {
    console.log(`游标以来无实质任务（新增记录 ${fresh.length} 条）。`);
    return;
  }

  const digest = buildDigest(substantial);
  if (DRY) {
    console.log(digest);
    return;
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outFile = join(RESULTS_DIR, `task-summary-${date}.md`);
  writeFileSync(outFile, digest + '\n', 'utf-8');
  console.log(`已写 digest: ${outFile}（${substantial.length} 条）`);
  writeCursor(fresh[fresh.length - 1].ts);

  if (SPAWN) {
    const instruction = `阅读 ${outFile}，将其中可复用的经验提炼后调用 memory_store 入库（procedure/solutions，confidence 0.6）；对成功、可复现、有保存价值的长任务，用 write 生成 SKILL 草稿到 packs/drafts/workticket-<短名>.md（首行 status: proposed）。仅入库/起草，不做其他改动。`;
    const r = spawnSync('bash', [join(ROOT, 'my-pi.sh'), '-p', instruction], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, PI_DISABLE_TASK_RECORD: '1' },
    });
    console.log(`spawn 总结完成，exit=${r.status ?? 'null'}`);
  }
}

if (isMain()) main();
