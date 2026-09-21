#!/usr/bin/env node
/**
 * check-doc-links.mjs — 文档内部链接一致性守门
 *
 * 扫描 my-pi 自身文档（根 md、docs/、portable/agent 下 md）中的相对链接，校验目标存在。
 * 排除 vendor/、node_modules/、packs/（外部技能包，链接不由本仓保证）。
 * 用法：node scripts/check-doc-links.mjs
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['.', 'docs', 'portable/agent'];
const SKIP = new Set(['node_modules', 'vendor', 'packs', '.git']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = new Set();
for (const d of SCAN_DIRS) for (const f of walk(join(ROOT, d))) files.add(f);

const broken = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    continue;
  }
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let target = m[1].trim();
    if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) continue;
    if (target.startsWith('mailto:') || target.startsWith('tel:')) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    const abs = resolve(dirname(file), target);
    if (!existsSync(abs)) broken.push({ file: file.slice(ROOT.length + 1), target });
  }
}

if (broken.length === 0) {
  console.log(`✓ 文档链接一致（扫描 ${files.size} 个 md）`);
  process.exit(0);
}
console.error(`❌ 发现 ${broken.length} 个失效文档链接：`);
for (const b of broken.slice(0, 50)) console.error(`  ${b.file} → ${b.target}`);
process.exit(1);
