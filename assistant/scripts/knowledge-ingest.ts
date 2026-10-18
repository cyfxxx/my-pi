/**
 * knowledge-ingest：把"知识订阅 md"里的条目灌进记忆库（零 LLM，来源 knowledge-fetch）。
 *
 * 原项目里这是自优化闭环的入口之一（当日知识 md → 记忆条目）；
 * 这里保留同样口径：解析 `- [title](url) (date)` + 缩进摘要行，按关键词或条数选取。
 *
 * 用法：
 *   node dist/knowledge-ingest.mjs <knowledge-md> [count] [--keywords a,b,c] [--dry-run]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore, saveStore, storeEntry } from '../memory/store';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(HERE, '..', 'memory', 'entries.json');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const kwIndex = argv.indexOf('--keywords');
const keywords = kwIndex >= 0 && argv[kwIndex + 1] ? argv[kwIndex + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
const positional = argv.filter((arg, index) => arg !== '--keywords' && arg !== '--dry-run' && (kwIndex < 0 || index !== kwIndex + 1));
const [mdPath, countRaw] = positional;
const count = Math.max(1, Math.min(10, Number.parseInt(countRaw ?? '5', 10) || 5));

if (mdPath === undefined || !existsSync(mdPath)) {
  console.error('用法：knowledge-ingest.mjs <knowledge-md> [count] [--keywords a,b,c] [--dry-run]');
  process.exit(2);
}

const text = readFileSync(mdPath, 'utf8');
const items: Array<{ title: string; url: string; date: string; body: string }> = [];
const re = /^- \[([^\]]+)\]\(([^)]+)\)(?:\s*\(([^)]*)\))?\s*\n((?:  .*\n)*)/gm;
let match: RegExpExecArray | null;
while ((match = re.exec(text)) !== null) {
  items.push({ title: match[1].trim(), url: match[2].trim(), date: (match[3] ?? '').trim(), body: match[4].trim() });
}

let picked = keywords.length > 0 ? items.filter((item) => keywords.some((k) => item.title.includes(k))) : items;
picked = picked.slice(0, count);
if (picked.length === 0) {
  console.log(JSON.stringify({ parsed: items.length, picked: 0, note: '没有可入库条目' }));
  process.exit(0);
}

const dateTag = (mdPath.match(/(\d{4}-\d{2}-\d{2})/) ?? [new Date().toISOString().slice(0, 10)])[0];
const file = process.env.MYPI_MEMORY_FILE ?? DEFAULT_FILE;
const store = loadStore(file);
const actions: Record<string, number> = { created: 0, merged: 0, updated: 0 };
const titles: Array<{ title: string; action: string }> = [];
for (const item of picked) {
  const { action } = storeEntry(store, {
    category: 'reference',
    title: item.title,
    content: `${item.date ? `${item.date}。` : ''}来源：${item.body.split('\n')[0] || '知识订阅'}。原文：${item.url}`,
    tags: ['knowledge-subscription', dateTag],
    confidence: 0.9,
    environments: ['all'],
    source: 'knowledge-fetch',
  });
  actions[action] += 1;
  titles.push({ title: item.title, action });
}

if (!dryRun) saveStore(file, store);
console.log(JSON.stringify({ md: mdPath, parsed: items.length, picked: picked.length, dryRun, actions, titles, total: store.entries.length }));
