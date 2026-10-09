#!/usr/bin/env node
/**
 * 知识索引生成器（WikiSkill 借鉴 A 项，2026-10-08）
 *
 * ## 为什么有它
 *
 * 论文 WikiSkill 的核心之一是 `wiki/index.md`：**知识要能被检索，而不是散落在历史里**。
 * my-pi 的对应物 `DECISIONS.md` / `PROGRESS.md` / `docs/BUG-REPLAYS.md` / `docs/design/*.md` /
 * `docs/development/*.md` 内容质量不低（`BUG-REPLAYS` 每条都带可重跑命令），但**没有索引**——
 * 于是"找先例"只能靠 grep 碰运气，同类判断会被反复重述（实证：工具面预算顶格被提 3 次、
 * 白名单纪律 2 次、"默认关闭"这条边界几乎每批重申）。
 *
 * ## 它生成什么
 *
 * 每个条目一行：`来源 · 标题 · 结论 · 数字 · 证据`。**"数字"与"证据"是刻意抽出来的**——
 * 这正是 my-pi 台账比论文 pattern 页强的地方（实测数字 + 可重跑命令），索引要把它抬到可检索的层面。
 *
 * ## 纪律
 *
 * - **确定性输出**（无时间戳、稳定排序）⇒ `--check` 才能逐字节比对，防索引与源文档漂移。
 * - **不进模型上下文**：它是给人/给下一轮优化查的，`--check` 挂在 `check-conventions.sh` 里守漂移。
 * - 纯读取；不修改任何源文档。
 *
 * 用法：`node scripts/gen-doc-index.mjs --update`（写回）｜`--check`（比对，漂移则退出 1）
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'INDEX.md');

/** 一行结论/数字的截断上限（索引要短，细节留在源文档） */
const CONCLUSION_MAX = 120;
const MAX_NUMBERS = 4;
const MAX_EVIDENCE = 3;

const NUMBER_RE = /\d+(?:\.\d+)?\s*(?:%|B|KB|MB|GB|次|轮|个|条|天|分钟|小时|秒)/g;
const SHA_RE = /\b[0-9a-f]{7,40}\b/g;
const CMD_RE = /(?:npx vitest run|bash scripts\/[\w.-]+\.sh|node scripts\/[\w.-]+\.mjs|node_modules\/\.bin\/vitest run)\s+[^\s`）)]+/g;

/** 第 2 行起、`### ` 之前的第一段非空文本，作为"结论" */
function firstMeaningful(lines) {
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith('|') || s.startsWith('```')) continue;
    return s.replace(/\s+/g, ' ').slice(0, CONCLUSION_MAX);
  }
  return '';
}

function pick(text, re, max) {
  const found = [...new Set(text.match(re) ?? [])].map((s) => s.trim());
  return found.slice(0, max);
}

/**
 * 把源文档里的相对链接**重算成相对 `docs/` 的路径**。
 *
 * 为什么必须有这一步：索引在 `docs/INDEX.md`，而源文档在仓库根（`DECISIONS.md`）或 `docs/design/` 下——
 * 同一个相对目标（如 `docs/design/X.md` 或 `X.md`）在两个位置解析结果不同。照抄就会让**索引自己**产生
 * 一批失效链接（2026-10-08 首次提交被 `check-docs-links` 拦下，6 条）。源文档里就已失效的链接**不带进索引**
 * （否则等于把别人的错变成索引的错）。
 */
function rewriteLinks(body, sourceFile) {
  const srcDir = dirname(join(ROOT, sourceFile));
  const docsDir = join(ROOT, 'docs');
  return body.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, target) => {
    if (/^[a-z]+:/i.test(target)) return m; // http(s)/mailto 等原样
    const path = target.split('#')[0];
    if (!path) return text; // 纯锚点：留在源文档里
    const abs = resolve(srcDir, path);
    if (!existsSync(abs)) return text; // 源头就失效：不传播
    const rel = relative(docsDir, abs).split(sep).join('/');
    return `[${text}](${rel})`;
  });
}

/** 把一段正文压成索引条目 */
function toEntry(source, title, body) {
  body = rewriteLinks(body, source);
  title = rewriteLinks(title, source);
  const lines = body.split('\n');
  const conclusion = firstMeaningful(lines);
  const numbers = pick(body, NUMBER_RE, MAX_NUMBERS);
  const shas = pick(body, SHA_RE, 2);
  const cmds = pick(body, CMD_RE, MAX_EVIDENCE - shas.length > 0 ? MAX_EVIDENCE - shas.length : 0);
  const evidence = [...shas, ...cmds].slice(0, MAX_EVIDENCE);
  const parts = [`\`${source}\``, title];
  if (conclusion) parts.push(conclusion);
  if (numbers.length) parts.push(`数字: ${numbers.join(' / ')}`);
  if (evidence.length) parts.push(`证据: ${evidence.join(' / ')}`);
  return `- ${parts.join(' · ')}`;
}

/** 抽 `### ` 条目（DECISIONS / PROGRESS） */
function entriesFromHeadingFile(file, heading = '### ') {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const out = [];
  const lines = src.split('\n');
  let title = null;
  let body = [];
  const flush = () => {
    if (title !== null) out.push(toEntry(file, title, body.join('\n')));
    title = null;
    body = [];
  };
  for (const line of lines) {
    if (line.startsWith(heading)) {
      flush();
      title = line.slice(heading.length).replace(/\s+/g, ' ').trim();
    } else if (title !== null) {
      body.push(line);
    }
  }
  flush();
  return out;
}

/** 抽 `## ` 小节（docs/design/*.md、docs/development/*.md） */
function entriesFromSectionFile(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const out = [];
  const lines = src.split('\n');
  let title = null;
  let body = [];
  const flush = () => {
    if (title !== null && title !== '格式') out.push(toEntry(file, title, body.join('\n')));
    title = null;
    body = [];
  };
  for (const line of lines) {
    if (line.startsWith('## ') && !line.startsWith('### ')) {
      flush();
      title = line.slice(3).replace(/\s+/g, ' ').trim();
    } else if (title !== null) {
      body.push(line);
    }
  }
  flush();
  return out;
}

/** 抽 docs/BUG-REPLAYS.md 的表格行（每条 bug 一行） */
function entriesFromLedgerTable(file) {
  if (!existsSync(join(ROOT, file))) return [];
  const out = [];
  for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3 || /^-+$/.test(cells[0]) || cells.some((c) => /^现象|^#/.test(c))) continue;
    const [idx, symptom, signal, cmd] = cells;
    if (!/^\d+$/.test(idx)) continue;
    out.push(toEntry(file, `#${idx} ${symptom}`.slice(0, CONCLUSION_MAX), `${signal}\n${cmd ?? ''}`));
  }
  return out;
}

function build() {
  const sections = [
    ['决策台账', entriesFromHeadingFile('DECISIONS.md')],
    ['进度记录', entriesFromHeadingFile('PROGRESS.md')],
    ['缺陷回放', entriesFromLedgerTable('docs/BUG-REPLAYS.md')],
    ['设计文档', readdirSync(join(ROOT, 'docs/design')).filter((f) => f.endsWith('.md')).sort().flatMap((f) => entriesFromSectionFile(`docs/design/${f}`))],
    ['开发文档', readdirSync(join(ROOT, 'docs/development')).filter((f) => f.endsWith('.md')).sort().flatMap((f) => entriesFromSectionFile(`docs/development/${f}`))],
  ];
  const lines = [
    '# 知识索引（自动生成，勿手改）',
    '',
    '> 由 `node scripts/gen-doc-index.mjs --update` 生成；`--check` 挂在 `check-conventions.sh` 里防漂移。',
    '> 用途：**找先例**（"这条判断以前做过吗、结论是什么、证据在哪"），由 WikiSkill 借鉴的 A 项引入。',
    '> 它**不进模型上下文**，只是给人/给下一轮优化检索；细节与完整论证仍在源文档里。',
    '> 字段：来源 · 标题 ·（标题后首句结论）· 数字（实测值）· 证据（提交 sha 或可重跑命令）。',
    '',
  ];
  for (const [name, entries] of sections) {
    lines.push(`## ${name}（${entries.length} 条）`, '');
    lines.push(...(entries.length ? entries : ['- （无）']));
    lines.push('');
  }
  return lines.join('\n');
}

const want = build();
const checkOnly = process.argv.includes('--check');
if (checkOnly) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current.trim() !== want.trim()) {
    console.error('❌ docs/INDEX.md 与源文档不一致（索引漂移）。请运行：node scripts/gen-doc-index.mjs --update');
    process.exit(1);
  }
  console.log('✅ 知识索引与源文档一致（docs/INDEX.md）');
} else {
  writeFileSync(OUT, want, 'utf8');
  const n = (want.match(/^- /gm) ?? []).length;
  console.log(`✓ 已生成 docs/INDEX.md（${n} 条）`);
}
