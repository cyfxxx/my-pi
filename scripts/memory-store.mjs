#!/usr/bin/env node
/**
 * memory-store.mjs —— 记忆入库（零 LLM，headless 可用）
 *
 * 背景：autopilot 的任务运行器以 `--no-extensions` 执行提示词（带扩展的 `-p` 一次性运行
 * 在本环境不退出，实测挂住），因此任务提示词里**不能用 `memory_store` 等扩展工具**。
 * 本脚本直接调用 memory 功能的纯逻辑 `storeEntry`（内置标题去重/近似合并），
 * 让无扩展的 headless 流程也能写入记忆。
 *
 * 用法：
 *   node scripts/memory-store.mjs --json '[{"category":"solutions","title":"…","content":"…"}]'
 *   node scripts/memory-store.mjs --file entries.json          # JSON 数组或 JSONL
 *   cat entries.jsonl | node scripts/memory-store.mjs          # 从 stdin
 *   以上均可加 --dry-run
 *
 * 字段：category(solutions|fact|preference|habit|procedure|reference，默认 fact)、
 *       title(必填)、content(必填)、tags[]、confidence(0-1，默认 0.7)、environments[]
 *
 * 说明：需经 tsx 运行无扩展名导入：`bash scripts/run-ts.sh scripts/memory-store.mjs ...`（裸 node 会报 Cannot find module）。
 */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = new Set(['solutions', 'fact', 'preference', 'habit', 'procedure', 'reference']);

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const jsonIdx = argv.indexOf('--json');
const fileIdx = argv.indexOf('--file');

function die(msg, code = 2) {
  console.error(`错误：${msg}`);
  process.exit(code);
}

let raw = '';
if (jsonIdx >= 0 && argv[jsonIdx + 1]) {
  raw = argv[jsonIdx + 1];
} else if (fileIdx >= 0 && argv[fileIdx + 1]) {
  try {
    raw = readFileSync(argv[fileIdx + 1], 'utf-8');
  } catch (e) {
    die(`读取 ${argv[fileIdx + 1]} 失败：${e.message}`);
  }
} else if (!process.stdin.isTTY) {
  raw = readFileSync(0, 'utf-8');
} else {
  die('未提供输入。用法见脚本头部（--json / --file / stdin）');
}

if (!raw.trim()) die('输入为空');

/** 解析 JSON 数组或 JSONL */
function parseEntries(text) {
  const t = text.trim();
  if (t.startsWith('[')) {
    const arr = JSON.parse(t);
    if (!Array.isArray(arr)) die('--json 需为数组');
    return arr;
  }
  const out = [];
  for (const [i, line] of t.split('\n').entries()) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch (e) {
      die(`第 ${i + 1} 行不是合法 JSON：${e.message}`);
    }
  }
  return out;
}

let input;
try {
  input = parseEntries(raw);
} catch (e) {
  die(`输入不是合法 JSON：${e.message}`);
}
if (input.length === 0) {
  console.log('无条目，跳过');
  process.exit(0);
}

let logic;
try {
  logic = await import(pathToFileURL(join(ROOT, 'custom/features/memory/logic.ts')).href);
} catch (e) {
  die(`无法加载 memory 逻辑（需 tsx 解析无扩展名导入；请用 bash scripts/run-ts.sh 运行）：${e.message}`, 3);
}
const { loadEntries, storeEntry, saveEntries } = logic;

const now = new Date().toISOString();
const invalid = [];
const normalized = [];
for (const [i, e] of input.entries()) {
  const title = typeof e?.title === 'string' ? e.title.trim() : '';
  const content = typeof e?.content === 'string' ? e.content.trim() : '';
  if (!title || !content) {
    invalid.push(`#${i + 1} 缺 title 或 content`);
    continue;
  }
  const category = CATEGORIES.has(e.category) ? e.category : 'fact';
  const confidence = typeof e.confidence === 'number' && e.confidence >= 0 && e.confidence <= 1 ? e.confidence : 0.7;
  const tags = Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string') : [];
  const environments = Array.isArray(e.environments) ? e.environments.filter((t) => typeof t === 'string') : ['all'];
  normalized.push({
    id: randomUUID(),
    category,
    title,
    content,
    tags,
    confidence,
    source: 'auto',
    recurrence: 1,
    createdAt: now,
    updatedAt: now,
    accessedAt: now,
    environments,
    contentHash: createHash('sha256').update(`${title}\n${content}`).digest('hex'),
  });
}
if (invalid.length) {
  console.error(`跳过 ${invalid.length} 条非法输入：${invalid.join('；')}`);
}
if (normalized.length === 0) {
  die('没有可入库的合法条目', 2);
}

if (dryRun) {
  for (const e of normalized) console.log(`[dry-run] ${e.category} | ${e.title} | conf=${e.confidence}`);
  console.log(`[dry-run] 共 ${normalized.length} 条，未写入`);
  process.exit(0);
}

const existing = loadEntries();
const counts = { created: 0, merged: 0, updated: 0 };
for (const entry of normalized) {
  const res = storeEntry(existing, entry);
  counts[res.action]++;
}
saveEntries(existing);
console.log(
  `记忆入库：新增 ${counts.created}、合并 ${counts.merged}、更新 ${counts.updated}（共 ${normalized.length} 条）`,
);
