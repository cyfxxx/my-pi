#!/usr/bin/env node
/**
 * 离线「经验 → 知识」编译器（WikiSkill 借鉴 C 项，2026-10-08）
 *
 * ## 它遵从的写入判据（WikiSkill 附录 E.2，外部材料补读时实测拿到）
 *
 * 编译产物是一个**决策**，键固定为：
 *   · `create_patterns: [{ name, content }]`  新建 pattern 页
 *   · `update_patterns: [{ name, edits }]`    **用新证据更新既有页（不许建重复）**
 *   · `update_index`                          **总是给出完整的新索引内容**
 *
 * **Pattern Documentation Rules**（逐条落实）：
 *   ① 每页四件事：是什么 / 根因（WHY）/ **轨迹里的确切命令序列** / **含确切语法的解法**
 *   ② 成功与失败都记  ③ 不建重复，用新证据更新既有  ④ **10–30 行，不是论文**  ⑤ 只记可泛化的
 *
 * **索引条目格式固定**：`- [name] (patterns/name.md): PROBLEM + ROOT CAUSE + FIX`
 * （论文提示词明说：**索引是最重要的部分**，它决定"下游会不会去读全文"。）
 *
 * ## 证据审计：只用有据的，没据的**不生成**并如实报告
 *
 * | 候选来源 | 结论 |
 * |---|---|
 * | `docs/BUG-REPLAYS.md`（16 条） | **采用**。每行天然含四要素：事故（是什么/根因）/ 指纹（怎么发现）/ 可重跑命令 / 现在由谁挡住（解法） |
 * | 错误指纹（P7 `tool-health.ts` 的 `errorFingerprint`/`observeRepairAttempt`） | **不采用**：它只活在内存（`context/index.ts` 的 `repairBudget`），**未落盘** ⇒ 没有语料。唯一落盘的 `prefix-fingerprints.jsonl` 是**前缀缓存**指纹，不是错误指纹 |
 * | `docs/CHANGES.jsonl` 的 `rejected` | **采用**。抽取判据已修（标记词只在标题里认、reason 取含标记的那一行）⇒ **18 → 7 条，且全是真负结果**。判据第 ② 条要求"成功与失败都记"，这就是失败那一半 |
 *
 * ## 纪律
 *
 * - **确定性输出**（无时间戳、稳定排序）⇒ `--check` 可逐字节比对，防知识库与源文档漂移。
 * - **离线**：产物只供**人**审阅，**不进模型上下文、不改任何运行时行为**。
 * - **自守门**：生成时逐页断言 **10–30 行**，越界即报错退出（判据里最容易失守的一条）。
 * - `last-decision.json` 记的是**本次运行施加的增量**（create/update）⇒ 应用之后增量必然为空，
 *   **天生不可幂等**，所以它**不参与 `--check`**（这是设计决定，不是疏漏）：`--check` 只比对
 *   `patterns/*.md` 与 `index.md` 这两个**状态型**产物。
 *
 * 用法：`node scripts/knowledge-compile.mjs --update`（写盘）｜`--check`（比对，漂移则退出 1）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KNOW = join(ROOT, 'docs', 'knowledge');
const PATTERNS = join(KNOW, 'patterns');
const INDEX = join(KNOW, 'index.md');
const DECISION = join(KNOW, 'last-decision.json');

/** 判据第 ④ 条：不是论文。 */
const MIN_LINES = 10;
const MAX_LINES = 30;

/** 从 `docs/BUG-REPLAYS.md` 抽事故行：`| 序号 | 事故 | 指纹 | 复现命令 | 谁挡住 |` */
function readIncidents() {
  const file = 'docs/BUG-REPLAYS.md';
  const src = readFileSync(join(ROOT, file), 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // 形如 ['', '1', '事故', '指纹', '命令', '挡住', ''] —— 首格必须是纯数字（排除"通用排查入口"表）
    if (cells.length < 6 || !/^\d+$/.test(cells[1])) continue;
    const [, idx, incident, signal, command, guard] = cells;
    if (!incident || !command) continue;
    out.push({ file, idx, incident, signal, command, guard });
  }
  return out;
}

/**
 * 是什么 / 根因 的切分。
 *
 * 台账的"事故"栏常写成 `症状：根因` 的形式（例如"切了模式、重启后没生效：`modes.json` 里的全局
 * `current` 被任何 git 操作静默退回 `full`"）。**只在确实有分隔符时**才切；没有就如实写
 * "未独立记录"，**不替它编一个根因**（判据第 ① 条要求写根因，但不许编）。
 */
function splitCause(incident) {
  const at = incident.indexOf('：');
  if (at <= 0) return { what: incident, why: '未独立记录（见「是什么」原文）' };
  return { what: incident.slice(0, at).trim(), why: incident.slice(at + 1).trim() };
}

/** 名字用稳定的 ASCII 别名（中文标题进页内与索引的 PROBLEM 段，不进文件名） */
function nameFor(idx) {
  return `bug-${String(idx).padStart(3, '0')}`;
}

function renderPattern(it) {
  const { what, why } = splitCause(it.incident);
  const what2 = defuse(what);
  const why2 = defuse(why);
  return [
    `# 失败模式：${what2}`,
    '',
    `**来源**：\`${it.file}\` 第 ${it.idx} 条（使用层面故障台账，代码检查全绿但用起来才炸）。`,
    '',
    '**是什么**',
    what,
    '',
    '**根因（WHY）**',
    why,
    '',
    '**确切命令序列**（复现/回归都靠它）',
    '```bash',
    defuse(it.command),
    '```',
    '',
    '**怎么发现它（指纹）**',
    it.signal || '未记录',
    '',
    '**含确切语法的解法**',
    it.guard || '未记录',
    '',
  ].join('\n');
}

/** 索引条目：格式固定为 `- [name] (patterns/name.md): PROBLEM + ROOT CAUSE + FIX` */
function renderIndexEntry(it) {
  const { what, why } = splitCause(it.incident);
  const slug = nameFor(it.idx);
  return `- [${slug}](patterns/${slug}.md): ${what} + ${why} + ${it.guard || '见页内'}`;
}

/** 更新既有页时说明**哪个字段**变了（可审计，不是黑箱"重写"） */
function editsFor(oldSrc, newSrc) {
  const fieldOf = (s) => {
    const grab = (label) => {
      const i = s.indexOf(`**${label}**`);
      if (i < 0) return '';
      const j = s.indexOf('\n**', i + 1);
      return s.slice(i, j < 0 ? undefined : j).trim();
    };
    return {
      是什么: grab('是什么'),
      根因: grab('根因（WHY）'),
      命令: grab('确切命令序列'),
      指纹: grab('怎么发现它（指纹）'),
      解法: grab('含确切语法的解法'),
    };
  };
  const a = fieldOf(oldSrc);
  const b = fieldOf(newSrc);
  return Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => `${k} 更新`);
}

/**
 * 从 `docs/CHANGES.jsonl` 抽 `kind:"rejected"` 的负结果（判据第 ② 条：**成功与失败都记**）。
 *
 * 只读、不做质量过滤：抽取侧（`gen-changes-ledger.mjs`）已在 2026-10-08 收紧为
 * "标记词只在标题里认 + reason 取含标记那一行"，实测 18 → 7 条且全是真负结果。
 */
function readRejected() {
  const file = 'docs/CHANGES.jsonl';
  const src = readFileSync(join(ROOT, file), 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // 非法行由守门负责报，这里不猜
    }
    if (row.kind !== 'rejected') continue;
    if (!row.proposal || !row.reason) continue; // 缺关键字段 ⇒ 宁可少产出
    out.push({ file, ts: row.ts ?? '未标日期', proposal: row.proposal, reason: row.reason, evidence: row.evidence || '', source: row.source || file });
  }
  return out;
}

/**
 * **拆解 `](` 成对模式**（2026-10-08 预防性处理）。
 *
 * 本会话已有**三次**因为"文档里出现完整的 markdown 链接写法"被 `check-doc-links.mjs` 当成真链接而拦下提交。
 * 知识页的文本来自台账/台账抽取，**可能含括号路径**；这里统一把 `](` 断开成 `] (`，
 * 使守门不会把编译产物当成自己的失效链接（对正常文本是无操作）。
 */
function defuse(s) {
  return String(s).split('](').join('] (');
}

/** 负结果的页名：**内容哈希**而非序号——序号会因"新增一条更早的负结果"而集体改号（页名就不稳定了） */
function nameForRejected(proposal) {
  return `rej-${createHash('sha1').update(proposal).digest('hex').slice(0, 6)}`;
}

/**
 * 抽取侧给的是**含标记的那一整行**，而决策条目里那行常是"半句 + 另起一句"（例如
 * "并防止缓存失效。要求先分析可行性。查证过程分四步，最后一步的实测把方案否掉了。"）。
 * 这里取**含标记的那一句**（仍**原文照录**、只是切句，不重写、不编造）；切不出来就用原样。
 */
function reasonSentence(reason) {
  const NEG = /否掉|不迁移|不推荐|负结果|不做|暂不做|不采用|予以否决|拒绝采纳/;
  const parts = String(reason)
    .split('。')
    .map((s) => s.trim())
    .filter(Boolean);
  const hit = parts.filter((s) => NEG.test(s)).pop();
  if (!hit) return reason;
  return /[。：；，、]$/.test(hit) ? hit : `${hit}。`;
}

function renderRejectedPattern(r) {
  const proposal = defuse(r.proposal);
  const reason = defuse(reasonSentence(r.reason));
  const evidence = r.evidence ? defuse(r.evidence) : '';
  return [
    `# 被否提案：${proposal}`,
    '',
    `**来源**：\`${r.file}\` 的 rejected 条目（${r.ts}；抽取自 \`${defuse(r.source)}\`）。`,
    '',
    '**是什么**',
    proposal,
    '',
    '**根因（WHY）**',
    `为什么被否：${reason}`,
    '',
    '**确切命令序列**（复现/回归都靠它）',
    '未记录（该提案**未被实施** ⇒ 没有可复现的命令序列；**不编造**）',
    '',
    '**怎么发现它（指纹）**',
    '由 `gen-changes-ledger.mjs` 从决策台账抽出的**负结果**条目（判据第 ② 条：成功与失败都记）。',
    '',
    '**含确切语法的解法**',
    evidence ? `未实施；相关证据/线索：${evidence}` : '未记录（该提案被否、未实施，也没有留下证据指针）',
    '',
  ].join('\n');
}

function renderRejectedIndexEntry(r) {
  return `- [${nameForRejected(r.proposal)}](patterns/${nameForRejected(r.proposal)}.md): ${defuse(r.proposal)} + ${defuse(r.reason)} + 未实施（被否）`;
}

function build() {
  const incidents = readIncidents();
  const rejected = readRejected();
  const creates = [];
  const updates = [];
  const pages = new Map();

  // 两个来源共用同一条"建/更/无变化"路径 ⇒ 判据③（**不建重复，用新证据更新既有**）对两者一致成立
  const sources = [
    ...incidents.map((it) => ({ name: nameFor(it.idx), content: renderPattern(it) })),
    ...rejected.map((r) => ({ name: nameForRejected(r.proposal), content: renderRejectedPattern(r) })),
  ];
  for (const s of sources) {
    pages.set(s.name, s.content);
    const file = join(PATTERNS, `${s.name}.md`);
    if (!existsSync(file)) {
      creates.push(s);
      continue;
    }
    const old = readFileSync(file, 'utf8');
    if (old === s.content) continue; // 证据没变 ⇒ 什么都不做（不制造无意义 diff）
    updates.push({ name: s.name, edits: editsFor(old, s.content), content: s.content });
  }

  // 知识库里存在的页若**已无证据支撑**（源条目被删），必须报出来而不是悄悄留着
  const orphans = existsSync(PATTERNS)
    ? readdirSync(PATTERNS)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
        .filter((n) => !pages.has(n))
    : [];

  const indexLines = [
    '# 知识索引（离线编译产物，供人审阅）',
    '',
    '> 由 `node scripts/knowledge-compile.mjs --update` 生成；`--check` 用于防漂移。',
    '> **写入判据来自 WikiSkill 附录 E.2**：新建用 `create_patterns`、**不建重复而用新证据更新既有页**、',
    '> **索引总是整份重写**（论文提示词明说"索引是最重要的部分"——它决定下游是否会去读全文）。',
    '> 每页四件事：是什么 / 根因 / **确切命令序列** / **含确切语法的解法**；篇幅 **10–30 行**；只记可泛化的。',
    '> **本产物不自动进模型上下文、不改任何运行时行为**，只供人审阅。',
    '',
    `## 失败模式（${incidents.length} 条，来源：\`docs/BUG-REPLAYS.md\`）`,
    '',
    ...incidents.map(renderIndexEntry),
    '',
    `## 被否提案（${rejected.length} 条，来源：\`docs/CHANGES.jsonl\` 的 rejected）`,
    '',
    '> 判据第 ② 条：**成功与失败都记**。这些是"试过但被否"的提案，留着是为了**不被重复提出**。',
    '',
    ...rejected.map(renderRejectedIndexEntry),
    '',
    '## 证据不足、**故意未生成**的来源（判据第 ⑤ 条：宁可少产出）',
    '',
    '- **错误指纹（P7）**：`errorFingerprint`/`observeRepairAttempt` 的状态只活在内存里（`custom/features/context/index.ts` 的 `repairBudget`），**未落盘** ⇒ 没有语料可编译。落盘的 `portable/memory/logs/prefix-fingerprints.jsonl` 是**前缀缓存**指纹，不是错误指纹。',
    '',
  ];
  if (orphans.length) {
    indexLines.push('## 已无证据支撑的页（需人工处理）', '', ...orphans.map((n) => `- ${n}`), '');
  }
  const index = indexLines.join('\n');

  return { creates, updates, index, orphans, count: incidents.length, rejectedCount: rejected.length };
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const built = build();

// 判据第 ④ 条自守门：每页 10–30 行
for (const p of [...built.creates, ...built.updates]) {
  const n = p.content.trimEnd().split('\n').length;
  if (n < MIN_LINES || n > MAX_LINES) fail(`${p.name} 有 ${n} 行，越出 10–30 行（判据第 ④ 条）`);
}

const decision = {
  create_patterns: built.creates.map((p) => ({ name: p.name })),
  // 内容以 `patterns/*.md` 为单一真源，这里只记"改了哪些字段"，便于人审阅"用新证据更新了谁"
  update_patterns: built.updates.map((p) => ({ name: p.name, edits: p.edits })),
  update_index: true,
};
const decisionText = JSON.stringify(decision, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const problems = [];
  for (const p of built.creates) problems.push(`缺页 ${p.name}.md`);
  for (const p of built.updates) problems.push(`页 ${p.name}.md 与源证据不一致（${p.edits.join('、')}）`);
  if (!existsSync(INDEX) || readFileSync(INDEX, 'utf8') !== built.index) problems.push('index.md 漂移');
  if (problems.length) fail(`知识库与源证据不一致：\n  - ${problems.join('\n  - ')}\n跑 node scripts/knowledge-compile.mjs --update`);
  console.log(
    `✅ 知识库与源证据一致（失败模式 ${built.count} 条 + 被否提案 ${built.rejectedCount} 条；本次 --check 的决策：create ${built.creates.length} / update ${built.updates.length}）`,
  );
} else {
  mkdirSync(PATTERNS, { recursive: true });
  for (const p of [...built.creates, ...built.updates]) writeFileSync(join(PATTERNS, `${p.name}.md`), p.content, 'utf8');
  writeFileSync(INDEX, built.index, 'utf8');
  writeFileSync(DECISION, decisionText, 'utf8');
  console.log(
    `✓ 已编译：create ${built.creates.length} / update ${built.updates.length} / 失败模式 ${built.count} 条 + 被否提案 ${built.rejectedCount} 条` +
      (built.orphans.length ? `（另有 ${built.orphans.length} 个页已无证据支撑）` : ''),
  );
}
