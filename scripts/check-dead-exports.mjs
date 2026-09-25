#!/usr/bin/env node
/**
 * check-dead-exports.mjs — 死导出守门（防"写了没接线"）
 *
 * 背景：本项目反复出现"纯逻辑写好、单测通过、但从未被调用"的情况
 * （`pruneThinkingBudget` 曾占上下文 50% 却零调用者；`setCompactThreshold` 从未被调用导致
 * 压力分档基准错误）。`tsc --noUnusedLocals` 只覆盖局部变量，抓不到跨文件未使用的导出。
 *
 * 规则：扫描 `custom/**\/*.ts` 的导出符号（function/const/class），统计它在**其它位置**的引用；
 * 零引用即报错。`scripts/dead-exports-allowlist.txt` 中的符号视为有意保留（逐行 `符号 理由`）。
 *
 * 用法：
 *   node scripts/check-dead-exports.mjs            # 检查（有新增死导出则 exit 1）
 *   node scripts/check-dead-exports.mjs --list     # 只列出，不判失败
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = join(ROOT, 'custom');
const ALLOWLIST = join(ROOT, 'scripts', 'dead-exports-allowlist.txt');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const LIST_ONLY = process.argv.includes('--list');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * 只去掉注释。
 *
 * 有意**不**剥离字符串/模板字面量：模板插值 `${...}` 里就是代码，剥离会漏掉真实引用，
 * 产生误报（曾把 `truncateContent` 误判为死导出）。宁可有少量漏报（字符串里提到符号名
 * 被当作引用），也不能让守门本身误报。
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // 字符串/模板字面量整体保留（内含 `//` 不能当注释；模板插值里是代码）。
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        out += src[i];
        if (src[i] === '\\') {
          i += 2;
          if (i - 1 < n) out += src[i - 1];
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST)) return new Map();
  const map = new Map();
  for (const raw of readFileSync(ALLOWLIST, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [name, ...rest] = line.split(/\s+/);
    map.set(name, rest.join(' ') || '(no reason given)');
  }
  return map;
}

const files = walk(SCAN_DIR);
const code = new Map();
for (const f of files) code.set(f, stripComments(readFileSync(f, 'utf-8')));

const declared = new Map(); // name -> file (first declaration)
const declaredCount = new Map();
for (const [f, src] of code) {
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) {
    const name = m[1];
    if (!declared.has(name)) declared.set(name, f);
    declaredCount.set(name, (declaredCount.get(name) ?? 0) + 1);
  }
}

const allow = loadAllowlist();
const dead = [];
for (const [name, file] of declared) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  let refs = 0;
  for (const [f, src] of code) {
    const hits = (src.match(re) ?? []).length;
    // 减去声明处自身的一次
    refs += f === file ? Math.max(0, hits - 1) : hits;
  }
  if (refs === 0 && !allow.has(name)) dead.push({ name, file: relative(ROOT, file) });
}

const allowlisted = [...allow.keys()].filter((n) => declared.has(n));

console.log(`扫描 ${files.length} 个 ts 文件，导出符号 ${declared.size} 个。`);
if (allowlisted.length > 0) {
  console.log(`白名单（有意保留，${allowlisted.length} 个）：`);
  for (const n of allowlisted) console.log(`  ${n} — ${allow.get(n)}`);
}
if (dead.length > 0) {
  console.log(`\n无引用导出（新增 ${dead.length} 个）：`);
  for (const d of dead) console.log(`  ${d.name}  (${d.file})`);
  console.log('\n处理：接线调用它、删除它，或写入 scripts/dead-exports-allowlist.txt 并说明理由。');
} else {
  console.log('\n无未登记的死导出。');
}

if (LIST_ONLY) process.exit(0);
process.exit(dead.length > 0 ? 1 : 0);
