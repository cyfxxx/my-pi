#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * knowledge-ingest.mjs —— 知识订阅入库（零 LLM）：解析当日 md → 选取条目 →
 * 直接调用 memory 功能纯逻辑 `storeEntry`（内置去重）逐条写入，不经过 LLM。
 *
 * 用法:
 *   node scripts/knowledge-ingest.mjs <knowledge-md-file> [count] [--keywords a,b,c]
 *     count      默认 5（1-10）
 *     --keywords 用标题关键词精选（逗号分隔）；缺省时取前 count 条
 *
 * 说明：需经 tsx 运行（`custom/` 的 TS 用无扩展名导入，Node 类型剥离不解析）：
 *   bash scripts/run-ts.sh scripts/knowledge-ingest.mjs <md-file> [count]
 * 裸 `node scripts/knowledge-ingest.mjs` 会报 Cannot find module。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const kwIdx = argv.indexOf('--keywords');
const keywords = kwIdx >= 0 && argv[kwIdx + 1] ? argv[kwIdx + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
const positional = argv.filter((a, i) => a !== '--keywords' && (kwIdx < 0 || i !== kwIdx + 1));
const [mdPath, countStr] = positional;
const count = Math.max(1, Math.min(10, parseInt(countStr, 10) || 5));

if (!mdPath || !existsSync(mdPath)) {
  console.error('用法: knowledge-ingest.mjs <md-file> [count] [--keywords a,b,c]');
  process.exit(2);
}

let logic;
try {
  logic = await import(pathToFileURL(join(ROOT, 'custom/features/memory/logic.ts')).href);
} catch (e) {
  console.error(`无法加载 memory 逻辑（需 tsx 解析无扩展名导入；请用 bash scripts/run-ts.sh 运行）：${e.message}`);
  process.exit(3);
}
const { loadEntries, storeEntry, saveEntries } = logic;

const text = readFileSync(mdPath, 'utf-8');
// 条目形如 "- [title](url) (date)"，后续缩进 2 空格行为来源/摘要
const entries = [];
const re = /^- \[([^\]]+)\]\(([^)]+)\)(?:\s*\(([^)]*)\))?\s*\n((?:  .*\n)*)/gm;
let m;
while ((m = re.exec(text)) !== null) {
  entries.push({ title: m[1].trim(), url: m[2].trim(), date: (m[3] || '').trim(), body: m[4].trim() });
}
console.log(`解析到 ${entries.length} 条候选`);

// 选取：有关键词按关键词命中，否则取前 count 条
let picked;
if (keywords.length > 0) {
  picked = entries.filter((e) => keywords.some((k) => e.title.includes(k)));
} else {
  picked = entries.slice(0, count);
}
picked = picked.slice(0, count);
console.log(`选取 ${picked.length} 条`);
if (!picked.length) {
  console.log('无选取条目，跳过入库');
  process.exit(0);
}

// 标签日期：优先 md 文件名中的 YYYY-MM-DD，否则今日
const dateTag = (mdPath.match(/(\d{4}-\d{2}-\d{2})/) || [new Date().toISOString().slice(0, 10)])[1];
const existing = loadEntries();
let stored = 0;
for (const p of picked) {
  const entry = {
    id: createHash('sha256').update(p.title + p.url).digest('hex').slice(0, 16),
    category: 'reference',
    title: p.title,
    content: `${p.date ? p.date + '。' : ''}来源：${p.body.split('\n')[0] || '知识订阅'}。原文：${p.url}`,
    tags: ['knowledge-subscription', dateTag],
    confidence: 0.9,
    source: 'knowledge-fetch',
    recurrence: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accessedAt: new Date().toISOString(),
    // 知识订阅条目面向所有设备可见（不按运行环境过滤）
    environments: ['all'],
  };
  const res = storeEntry(existing, entry);
  existing.length = 0;
  existing.push(...res.entries);
  console.log(`${res.action === 'created' ? '入库' : '去重跳过'} [${res.action}]: ${p.title}`);
  if (res.action === 'created') stored++;
}
saveEntries(existing);
console.log(`完成：入库 ${stored} 条，记忆库现有 ${existing.length} 条`);
