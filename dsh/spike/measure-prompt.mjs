/**
 * 量 DSH 侧的**注入面**（P6 第二块）：把提示词服务组装出的 system prompt 哈希成基线。
 *
 * ## 为什么比 pi 侧的那条更硬
 *
 * pi 侧的 `check-injection-surface.sh` 哈希的是**源文件**（APPEND_SYSTEM.md / AGENTS.md /
 * hard-rules.ts）——它只能证明"我们的输入没变"。换到 DSH 后，输入之外还多了一层**组装**
 * （`SystemPrompt.section` 的 order 决定落位、harness 自己的段会插进来），
 * 所以这里直接哈希 **`renderPrompt(await ctx.systemPrompt.assemble())`** —— 模型真正看到的那段文本。
 * 两者互补：源文件守 "我们改了什么"，本基线守 "模型最终看到什么"。
 *
 * 口径与诚实说明：
 *   * 组装发生在**最小 harness**（SystemPrompt + ToolRuntime + 我们的插件）里；
 *     真实 profile 会额外注入 persona/更多段 ⇒ 字节数**不可与 pi 侧前缀相减**，
 *     但"我们的段在不在、落位在哪、总长是否漂移"这三件事在本口径下都成立。
 *   * 组装结果里的 section **不带 order**（`AssembledSection` 只有 name/text）⇒ 落位不靠 order 判断，
 *     改为**直接判断我们的文本是不是渲染结果的结尾**（`isSuffix`）+ 末尾还有多少个字符
 *     （`charsAfter`）。这比"比较 order"更直接，也不用相信我们对 harness 内部顺序的推断。
 *
 * 用法（需先 `bash scripts/dsh-build.sh --no-smoke`）：
 *   node dsh/spike/measure-prompt.mjs [--check|--update]
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '@deepseek-ai/cordis';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

import { apply } from '../plugin/dist/my-pi-plugin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BASELINE = resolve(HERE, '..', 'baseline', 'system-prompt.json');
const UPDATE = process.argv.includes('--update');
const CHECK = process.argv.includes('--check');
const MY_SECTION = 'my-pi:append-system';
const SOURCE = resolve(ROOT, 'portable', 'agent', 'APPEND_SYSTEM.md');

const sha = (text) => createHash('sha256').update(text).digest('hex');

const ctx = new Context();
ctx.plugin(SystemPrompt);
ctx.plugin(ToolRuntime);
await new Promise((r) => setTimeout(r, 300));

const reports = [];
const originalError = console.error;
console.error = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[my-pi-dsh]') || text.startsWith('[dsh-facade]')) reports.push(text);
  else originalError(...args);
};
const facade = apply(ctx, { root: ROOT });
console.error = originalError;

const assembly = await ctx.systemPrompt.assemble();
const rendered = renderPrompt(assembly);
const sections = assembly.sections.map((s) => ({
  name: s.name,
  bytes: Buffer.byteLength(s.text ?? ''),
  sha256: sha(s.text ?? '').slice(0, 16),
}));
const mineEntry = assembly.sections.find((s) => s.name === MY_SECTION);
const myIndex = mineEntry ? rendered.indexOf(mineEntry.text) : -1;
const isSuffix = myIndex >= 0 && rendered.trimEnd().endsWith((mineEntry?.text ?? '').trimEnd());
const charsAfter = myIndex >= 0 ? rendered.length - (myIndex + (mineEntry?.text?.length ?? 0)) : null;
const mine = mineEntry
  ? { present: true, name: MY_SECTION, bytes: Buffer.byteLength(mineEntry.text ?? ''), isSuffix, charsAfter }
  : { present: false };
const measured = {
  generatedBy: 'dsh/spike/measure-prompt.mjs --update',
  note: 'DSH 侧注入面基线：renderPrompt(assemble()) 的哈希（最小 harness 口径；与 pi 侧整段前缀口径不同）',
  harness: 'SystemPrompt + ToolRuntime + my-pi 插件产物',
  source: {
    file: 'portable/agent/APPEND_SYSTEM.md',
    exists: existsSync(SOURCE),
    sha256: existsSync(SOURCE) ? sha(readFileSync(SOURCE, 'utf8')) : null,
  },
  mySection: mine,
  sectionCount: sections.length,
  renderedBytes: Buffer.byteLength(rendered),
  renderedSha256: sha(rendered),
  sections,
};

console.log('=== DSH 注入面（system prompt）===');
console.log(`段数 = ${measured.sectionCount}｜渲染字节 = ${measured.renderedBytes}（${(measured.renderedBytes / 1024).toFixed(1)} KB）｜sha256 = ${measured.renderedSha256.slice(0, 16)}…`);
console.log(
  measured.mySection.present
    ? `我们的段：${MY_SECTION} ${measured.mySection.bytes}B；**是渲染结果的结尾 = ${measured.mySection.isSuffix}**（末尾还有 ${measured.mySection.charsAfter} 字符）`
    : `❌ 我们的段 ${MY_SECTION} 不在组装结果里（注入没生效！）`,
);
console.log(`源文件 portable/agent/APPEND_SYSTEM.md：${measured.source.exists ? 'sha256 ' + measured.source.sha256.slice(0, 16) + '…' : '不存在'}`);

if (UPDATE) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(measured, null, 2)}\n`, 'utf8');
  console.log(`✓ 已写入基线：${BASELINE}（请人工确认后提交）`);
  process.exit(0);
}

if (CHECK) {
  if (!existsSync(BASELINE)) {
    console.error(`❌ 基线不存在：${BASELINE}（先跑 --update 并提交）`);
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const problems = [];
  if (!measured.mySection.present) problems.push(`我们的段 ${MY_SECTION} 消失了（注入失效）`);
  if (base.renderedSha256 !== measured.renderedSha256) problems.push(`渲染文本 sha256 变了（${base.renderedBytes} → ${measured.renderedBytes} B）`);
  if (base.source?.sha256 !== measured.source.sha256) problems.push('源文件 APPEND_SYSTEM.md 变了（同步核对 pi 侧的 check-injection-surface.sh）');
  const baseSections = new Map((base.sections ?? []).map((s) => [s.name, s]));
  for (const s of measured.sections) {
    const b = baseSections.get(s.name);
    if (!b) problems.push(`新增段：${s.name}（${s.bytes}B）`);
    else if (b.sha256 !== s.sha256) problems.push(`段内容变了：${s.name}（${b.bytes} → ${s.bytes} B）`);
  }
  for (const name of baseSections.keys()) if (!measured.sections.some((s) => s.name === name)) problems.push(`段消失：${name}`);
  if (base.mySection?.isSuffix !== measured.mySection.isSuffix) {
    problems.push(`我们的段是否落在末尾变了：${base.mySection?.isSuffix} → ${measured.mySection.isSuffix}（设计假设：在末尾）`);
  }
  if (problems.length) {
    console.error('❌ 注入面相对基线漂移：');
    for (const p of problems) console.error(`   · ${p}`);
    console.error('   若确认是有意改动：node dsh/spike/measure-prompt.mjs --update 后提交');
    process.exit(1);
  }
  console.log('✅ 注入面与基线一致');
}

facade.dispose();
