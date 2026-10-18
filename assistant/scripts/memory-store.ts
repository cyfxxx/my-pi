/**
 * memory-store：headless 记忆入库（零 LLM）。
 *
 * 为什么需要它：自动化流程（定时任务/知识订阅/无扩展的 headless 运行）拿不到插件的工具，
 * 只能直接写库；原项目的自优化闭环就是靠这类脚本喂数据。
 *
 * 用法：
 *   node dist/memory-store.mjs --json '[{"category":"solutions","title":"…","content":"…"}]'
 *   node dist/memory-store.mjs --file entries.json          # JSON 数组或 JSONL
 *   cat entries.jsonl | node dist/memory-store.mjs
 *   均可加 --dry-run / --source manual|extract|digest|auto
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore, saveStore, storeEntry, type MemoryCategory, type MemoryEntry } from '../memory/store';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(HERE, '..', 'memory', 'entries.json');
const CATEGORIES = new Set(['solutions', 'fact', 'preference', 'habit', 'procedure', 'reference']);
const SOURCES = new Set(['manual', 'extract', 'digest', 'auto']);

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const value = (flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const file = process.env.MYPI_MEMORY_FILE ?? DEFAULT_FILE;
const source = value('--source') ?? 'auto';
if (!SOURCES.has(source)) {
  console.error(`--source 取值须为 ${[...SOURCES].join('|')}`);
  process.exit(2);
}

function readInput(): string {
  const inline = value('--json');
  if (inline !== undefined) return inline;
  const path = value('--file');
  if (path !== undefined) {
    if (!existsSync(path)) {
      console.error(`文件不存在：${path}`);
      process.exit(2);
    }
    return readFileSync(path, 'utf8');
  }
  if (process.stdin.isTTY) {
    console.error('用法：memory-store.mjs --json <json> | --file <path> | <stdin>');
    process.exit(2);
  }
  return readFileSync(0, 'utf8');
}

function parseItems(raw: string): Array<Partial<MemoryEntry>> {
  const text = raw.trim();
  if (text === '') return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed as Array<Partial<MemoryEntry>>;
    if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { entries?: unknown[] }).entries)) {
      return (parsed as { entries: Array<Partial<MemoryEntry>> }).entries;
    }
    return [parsed as Partial<MemoryEntry>];
  } catch {
    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Partial<MemoryEntry>);
  }
}

const items = parseItems(readInput());
if (items.length === 0) {
  console.log(JSON.stringify({ stored: 0, note: '没有输入条目' }));
  process.exit(0);
}

const store = loadStore(file);
const actions: Record<string, number> = { created: 0, merged: 0, updated: 0 };
const results: Array<{ title: string; action: string }> = [];
for (const item of items) {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  if (title === '' || content === '') {
    console.error(`跳过：缺少 title 或 content（${JSON.stringify(item).slice(0, 80)}）`);
    continue;
  }
  const category = (CATEGORIES.has(item.category as string) ? item.category : 'fact') as MemoryCategory;
  const { action } = storeEntry(store, {
    category,
    title,
    content,
    tags: Array.isArray(item.tags) ? item.tags : [],
    confidence: typeof item.confidence === 'number' ? item.confidence : 0.7,
    environments: Array.isArray(item.environments) && item.environments.length > 0 ? item.environments : ['all'],
    source,
  });
  actions[action] += 1;
  results.push({ title, action });
}

if (!dryRun) saveStore(file, store);
console.log(JSON.stringify({ file, dryRun, source, actions, results, total: store.entries.length }));
