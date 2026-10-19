/**
 * 把原项目的记忆库搬到新位置（同 schema）。
 *
 * 用法（先构建再跑）：
 *   node_modules/.bin/esbuild scripts/import-memory.ts --bundle --format=esm --platform=node \
 *     --packages=external --outfile=dist/import-memory.mjs
 *   node dist/import-memory.mjs <源 entries.json> <目标 entries.json>
 *
 * 语义：逐条走 storeEntry（标题/hash/近似三级去重），保留 deleted/supersededBy 与时间戳；
 * 已存在的（同 title+hash）只做合并，不重复增加条数。可重复执行（幂等）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore, saveStore, storeEntry, type MemoryCategory, type MemoryEntry } from '../memory/store';

// 默认从仓根 portable/memory/entries.json 迁到本仓 assistant/memory/entries.json；
// 路径都相对定位（不写死绝对路径），换机器/导出到新仓库都能用。
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// 目标固定在本仓 assistant/memory/entries.json（源默认仓根 portable/memory/entries.json）。
const ASSISTANT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [, , src = join(REPO_ROOT, 'portable', 'memory', 'entries.json'), dest = join(ASSISTANT_ROOT, 'memory', 'entries.json')] = process.argv;
if (!existsSync(src)) {
  console.error(`源文件不存在：${src}`);
  process.exit(2);
}

const source = JSON.parse(readFileSync(src, 'utf8')) as { entries?: MemoryEntry[] };
const incoming = source.entries ?? [];
const target = loadStore(dest);
const before = target.entries.length;
const actions = { created: 0, merged: 0, updated: 0 };

for (const entry of incoming) {
  const { action } = storeEntry(target, {
    category: (entry.category ?? 'fact') as MemoryCategory,
    title: entry.title,
    content: entry.content,
    tags: entry.tags ?? [],
    confidence: entry.confidence,
    environments: entry.environments ?? ['all'],
    source: entry.source ?? 'imported',
    now: entry.updatedAt ?? entry.createdAt,
  });
  actions[action] += 1;
}

saveStore(dest, target);
console.log(JSON.stringify({ src, dest, incoming: incoming.length, before, after: target.entries.length, actions }));
