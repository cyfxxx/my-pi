/**
 * memory-lifecycle：记忆生命周期**只读报告**（对齐原项目"淘汰/升格/冲突/垃圾/聚合"五类候选）。
 *
 * 纪律：只出候选，不自动删改——写操作要人确认（原项目也是这个约定）。
 *
 * 用法：node dist/memory-lifecycle.mjs [--json] [--file <entries.json>]
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jaccard, loadStore, tokenize, type MemoryEntry } from '../memory/store';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(HERE, '..', 'memory', 'entries.json');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const fileIndex = argv.indexOf('--file');
const file = fileIndex >= 0 ? argv[fileIndex + 1] : process.env.MYPI_MEMORY_FILE ?? DEFAULT_FILE;

const DAY = 86_400_000;
const now = Date.now();
const store = loadStore(file);
const live = store.entries.filter((entry) => !entry.deleted);

const ageDays = (entry: MemoryEntry): number => Math.max(0, (now - Date.parse(entry.updatedAt || entry.createdAt)) / DAY);

const stale = live.filter((entry) => ageDays(entry) > 90 && entry.recurrence <= 1 && entry.confidence < 0.6);
const junk = live.filter((entry) => entry.title.trim().length < 3 || entry.content.trim().length < 10);
const promote = live.filter((entry) => entry.recurrence >= 3 && entry.confidence >= 0.8 && !junk.includes(entry));

const duplicates: Array<[string, string, number]> = [];
for (let i = 0; i < live.length; i += 1) {
  for (let j = i + 1; j < live.length; j += 1) {
    const score = jaccard(tokenize(live[i].content), tokenize(live[j].content));
    if (score > 0.9) duplicates.push([live[i].title, live[j].title, Number(score.toFixed(3))]);
  }
}

const report = {
  file,
  total: store.entries.length,
  live: live.length,
  candidates: {
    stale: stale.map((entry) => ({ title: entry.title, ageDays: Math.round(ageDays(entry)), confidence: entry.confidence })),
    junk: junk.map((entry) => ({ title: entry.title, contentLength: entry.content.trim().length })),
    promote: promote.map((entry) => ({ title: entry.title, recurrence: entry.recurrence, confidence: entry.confidence })),
    duplicates: duplicates.slice(0, 20),
  },
};

if (asJson) {
  console.log(JSON.stringify(report));
  process.exit(0);
}

console.log(`记忆库：${report.live} 条（含归档 ${report.total}）  文件：${file}`);
const line = (label: string, items: string[]): void => {
  console.log(`\n## ${label}（${items.length}）`);
  for (const item of items.slice(0, 20)) console.log(`- ${item}`);
};
line('淘汰候选（>90 天、未复现、低置信）', report.candidates.stale.map((c) => `${c.title}（${c.ageDays} 天 / 置信 ${c.confidence}）`));
line('升格候选（复现≥3 且高置信）', report.candidates.promote.map((c) => `${c.title}（复现 ${c.recurrence}）`));
line('垃圾嫌疑（标题/内容过短）', report.candidates.junk.map((c) => `${c.title}（${c.contentLength} 字）`));
line('近似重复（jaccard>0.9）', report.candidates.duplicates.map(([a, b, s]) => `${a} ≈ ${b}（${s}）`));
console.log('\n（只读报告：淘汰/合并需要显式操作，脚本不会自动改库。）');
