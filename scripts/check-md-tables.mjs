#!/usr/bin/env node
/**
 * Markdown 表体完整性守门（程序化编辑最容易踩的两类"破表"）
 *
 * ## 为什么有它
 *
 * 两份事故同源，都是"人眼看着还行、机器读法已经变了"：
 *
 *   ① `docs/BUG-REPLAYS.md` #33：台账表体里被插了空行 ⇒ Markdown 仍渲染成一张表，
 *      但**按行解析**的工具会把它当成多张表。当时结论是"建议后续加这条守门"，一直没加。
 *   ② 2026-10-18 自己踩到：用脚本改 `docs/design/DSH-MIGRATION-PLAN.md` 时把**一行**表格写成了
 *      4 行、续行还带前导空格 + 单引号 ⇒ 那一行在渲染里断成普通文本（该表少一条实测记录），
 *      而当时**所有现有守门都放行**（`check-doc-links` 只查链接、约定守门只查计数）。
 *
 * ## 判据（刻意窄而确定，避免又变成"守门老误报"）
 *
 *   - **只查我们自己维护的 md**：`git ls-files '*.md'` 去掉 `packs/`（vendored 外部技能包）
 *     与 `vendor/`（上游）。实测：`packs/` 里有合法的行首引号（JSON 代码块），不该被我们判违规。
 *   - **跳过围栏代码块**（``` 与 ~~~，按缩进 ≤3 空格识别围栏）：实测 `DECISIONS.md` 的 JSON 代码块里
 *     就有 ` "layers": …` 这种行，不跳围栏必误报。
 *   - 犯规形态：非代码块内**行首为空格 + 单/双引号**（这正是"表格行被写断后的续行"的形状），
 *     以及紧跟在一行 `|` 表格行之后出现这种行。
 *   - 台账空行**只报告不失败**：实测 `BUG-REPLAYS.md` 表体有 3 处空行，而
 *     `node scripts/knowledge-compile.mjs --check` 仍解析出 **41/41** 条失败模式 ⇒
 *     "空行会让解析漏条"在本仓**没有被证伪，也没被证实**；把它做成失败项会是无证据的硬门禁。
 *     故这里只统计并打印，供人决定。
 *
 * 用法：`node scripts/check-md-tables.mjs`（违规 ⇒ exit 1 并点名 文件:行）
 *      `node scripts/check-md-tables.mjs --json`
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 台账文件：表体空行统计只对它做（其它 md 的表没有"逐行解析"的下游消费者） */
const LEDGER = 'docs/BUG-REPLAYS.md';

/** 我们维护的 md（去掉 vendored 与上游） */
function ownMarkdownFiles() {
  const raw = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' });
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => !f.startsWith('packs/') && !f.startsWith('vendor/'));
}

/** 标记每行是否落在围栏代码块内（``` / ~~~ 成对，围栏行本身也算块内） */
function fenceMask(lines) {
  const inFence = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (fence === null && m) {
      fence = m[1][0];
      inFence[i] = true;
      continue;
    }
    if (fence !== null) {
      inFence[i] = true;
      if (m && m[1][0] === fence) fence = null;
    }
  }
  return inFence;
}

const CONTINUATION = /^ ['"]/;

const problems = [];
const ledgerInfo = [];

for (const file of ownMarkdownFiles()) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  const inFence = fenceMask(lines);
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    if (!CONTINUATION.test(lines[i])) continue;
    const prev = i > 0 && !inFence[i - 1] ? lines[i - 1] : '';
    problems.push({
      file,
      line: i + 1,
      afterTableRow: /^\s*\|/.test(prev),
      text: lines[i].slice(0, 80),
    });
  }

  if (file === LEDGER) {
    // 表体范围：第一条 `| <数字> |` 到最后一个表格行
    let first = -1;
    let last = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (inFence[i]) continue;
      if (/^\| [0-9]+ \|/.test(lines[i]) && first === -1) first = i;
      if (/^\|/.test(lines[i])) last = i;
    }
    if (first !== -1 && last > first) {
      let blanks = 0;
      for (let i = first; i <= last; i += 1) if (lines[i].trim() === '') blanks += 1;
      ledgerInfo.push(`${LEDGER} 表体（第 ${first + 1}–${last + 1} 行）内有 ${blanks} 处空行`);
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scanned: ownMarkdownFiles().length, problems, ledgerInfo }, null, 2));
} else {
  console.log(`扫描我们维护的 md：${ownMarkdownFiles().length} 个（已排除 packs/ 与 vendor/）`);
  for (const info of ledgerInfo) console.log(`  · 提示（不算失败）：${info}`);
  if (problems.length === 0) {
    console.log('✓ 未发现"表格行被写断"的续行残留');
  } else {
    console.error(`❌ 发现 ${problems.length} 处行首引号（多为程序化编辑把表格行写断的续行）：`);
    for (const p of problems) {
      console.error(`   ${p.file}:${p.line}${p.afterTableRow ? '（紧跟表格行 ⇒ 几乎确定是写断）' : ''}  ${p.text}`);
    }
  }
}

process.exit(problems.length === 0 ? 0 : 1);
