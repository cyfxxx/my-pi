/**
 * lesson-miner：从"干预快照"里挖教训（默认只读，`--ingest` 才入库）。
 *
 * 数据源：`MYPI_INTERVENTIONS_FILE`（默认 `portable/memory/interventions.jsonl`），
 * 每条记录形如 `{type:'abort'|'what'|'why', prompt, correctivePrompt?, lastTool?}`。
 * 这正是自优化闭环的"挖掘"段：把人纠正/打断的地方沉淀成可复用的 solutions。
 *
 * 用法：
 *   node dist/lesson-miner.mjs                 # 只读报告
 *   node dist/lesson-miner.mjs --ingest        # 写入记忆库（自动去重）
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore, saveStore, storeEntry } from '../memory/store';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MEMORY = resolve(HERE, '..', 'memory', 'entries.json');
// 干预快照默认在仓根 portable/memory/ 下；可用 MYPI_INTERVENTIONS_FILE 覆盖。
// 注意：不要写死绝对路径——这个仓会被导出到新仓库/换机器。
const DEFAULT_INTERVENTIONS = resolve(process.env.MYPI_REPO_ROOT ?? resolve(HERE, '..', '..'), 'portable', 'memory', 'interventions.jsonl');

const argv = process.argv.slice(2);
const ingest = argv.includes('--ingest');
const fileIndex = argv.indexOf('--file');
const interventions = fileIndex >= 0 ? argv[fileIndex + 1] : process.env.MYPI_INTERVENTIONS_FILE ?? DEFAULT_INTERVENTIONS;
const memoryFile = process.env.MYPI_MEMORY_FILE ?? DEFAULT_MEMORY;

interface Intervention {
  readonly type?: string;
  readonly prompt?: string;
  readonly correctivePrompt?: string;
  readonly lastTool?: { name?: string } | null;
  readonly ts?: string;
}

if (!existsSync(interventions)) {
  console.log(JSON.stringify({ interviews: 0, note: `没有干预记录：${interventions}` }));
  process.exit(0);
}

const records: Intervention[] = readFileSync(interventions, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => {
    try {
      return JSON.parse(line) as Intervention;
    } catch {
      return null;
    }
  })
  .filter((record): record is Intervention => record !== null);

const candidates = records
  .map((record) => {
    const prompt = (record.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const correction = (record.correctivePrompt ?? '').replace(/\s+/g, ' ').trim();
    const tool = record.lastTool?.name ?? '';
    if (prompt === '' && correction === '') return undefined;
    const kind = record.type ?? 'unknown';
    const title = `干预教训（${kind}）：${prompt || correction.slice(0, 40)}`;
    const content = [
      `场景：用户在 ${tool || '（无工具）'} 处${kind === 'abort' ? '打断' : '提问/纠正'}。`,
      prompt ? `用户原话：「${prompt}」` : '',
      correction ? `纠正内容：「${correction}」` : '',
      '可复用的做法：先确认意图与当前方案，再继续执行；避免在未对齐时推进。',
    ]
      .filter(Boolean)
      .join('\n');
    return { title, content, ts: record.ts ?? '' };
  })
  .filter((candidate): candidate is { title: string; content: string; ts: string } => candidate !== undefined);

if (candidates.length === 0) {
  console.log(JSON.stringify({ mined: 0, note: '没有可挖掘的教训' }));
  process.exit(0);
}

if (!ingest) {
  console.log(JSON.stringify({ mined: candidates.length, dryRun: true, candidates }));
  process.exit(0);
}

const store = loadStore(memoryFile);
const actions: Record<string, number> = { created: 0, merged: 0, updated: 0 };
for (const candidate of candidates) {
  const { action } = storeEntry(store, {
    category: 'solutions',
    title: candidate.title,
    content: candidate.content,
    tags: ['lesson', 'intervention'],
    confidence: 0.6,
    environments: ['all'],
    source: 'extract',
  });
  actions[action] += 1;
}
saveStore(memoryFile, store);
console.log(JSON.stringify({ mined: candidates.length, actions, total: store.entries.length }));
