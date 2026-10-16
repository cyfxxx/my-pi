/**
 * 量 DSH 侧的**工具声明面**并维护基线（P6 的第一块：工具面字节预算）。
 *
 * ## 为什么要有它
 *
 * pi 侧有一条"工具面顶格"的历史教训（`docs/design/TOOL-BUDGET-DECISION.md`：前缀顶到 0 余量、
 * 加一个中等工具 1.3–1.8 KB 就会顶破）。换到 DSH 后**旧的字节账不能继承**：声明格式不同
 * （DSH 用 `parameterSchemaSpecToJsonSchema` 把逐属性 spec 编译成 JSON Schema），
 * 必须重新量一遍并留一条**可复跑的基线 + 漂移守门**，否则"工具面悄悄膨胀"没有人会知道。
 *
 * ## 口径（模型实际看到的声明）
 *
 *   单个工具声明 = `{ name, description, parameters: <编译后的 JSON Schema>, deferLoading? }`
 *   字节数 = `Buffer.byteLength(JSON.stringify(声明))`（UTF-8；中文描述按真实字节算）
 *   基线 = 全部声明**按 name 排序**后的数组的 sha256 + 每个工具的字节数
 *
 * ✗ 与 pi 侧的 24,785 B **不是同一口径**（那是 system prompt + 声明的整段前缀），
 *   所以**不做减法**，只各自守各自的漂移。
 *
 * 用法（需先 `bash scripts/dsh-build.sh --no-smoke` 产出插件产物）：
 *   node dsh/spike/measure-surface.mjs            # 打印测量结果
 *   node dsh/spike/measure-surface.mjs --check    # 与基线比对（漂移 ⇒ exit 1）
 *   node dsh/spike/measure-surface.mjs --update   # 写入基线（需人工确认后提交）
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools';

import { apply } from '../plugin/dist/my-pi-plugin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(HERE, '..', 'baseline', 'tool-surface.json');
const UPDATE = process.argv.includes('--update');
const CHECK = process.argv.includes('--check') || (!UPDATE && process.argv.includes('--check'));

/** 启动最小 harness、加载插件、返回 { perTool, declarations } */
async function measure() {
  const ctx = new Context();
  ctx.plugin(SystemPrompt);
  ctx.plugin(ToolRuntime);
  await new Promise((r) => setTimeout(r, 300));

  const names = [];
  const register = ctx.tools.register.bind(ctx.tools);
  ctx.tools.register = (def) => {
    names.push(def.name);
    return register(def);
  };

  // 插件注册期会打印"无等价物"上报；测量输出只留数字，但**只过滤我们自己的前缀**，
  // 不吞掉其它错误（否则测量工具自己出问题也看不见）。
  const originalError = console.error;
  console.error = (...args) => {
    const text = args.map(String).join(' ');
    if (!text.startsWith('[dsh-facade]') && !text.startsWith('[dsh-pi-shim]')) originalError(...args);
  };
  const facade = apply(ctx);
  console.error = originalError;

  const declarations = [];
  const perTool = {};
  for (const name of [...names].sort()) {
    const def = ctx.tools.get(name);
    if (!def) throw new Error(`注册表里找不到 ${name}`);
    // ★ 2026-10-18：`defineTool` 编译后，注册表里的 `parameters` **已经是**模型侧 JSON Schema
    //   （`{type:'object', properties:{…}}`）。此前它还是逐属性 spec，所以这里要编译；
    //   现在按形状判断，两种都兼容（否则会把已编译的 schema 再当 spec 编译成垃圾）。
    const raw = def.parameters;
    const looksCompiled = typeof raw === 'object' && raw !== null && raw.type === 'object';
    const declaration = {
      name: def.name,
      description: def.description,
      parameters: looksCompiled ? raw : parameterSchemaSpecToJsonSchema(raw),
      ...(def.deferLoading ? { deferLoading: true } : {}),
    };
    perTool[name] = Buffer.byteLength(JSON.stringify(declaration));
    declarations.push(declaration);
  }
  facade.dispose();
  return { perTool, declarations };
}

const { perTool, declarations } = await measure();
const toolCount = declarations.length;
const totalBytes = Object.values(perTool).reduce((s, n) => s + n, 0);
const sha256 = createHash('sha256').update(JSON.stringify(declarations)).digest('hex');
const measured = {
  generatedBy: 'dsh/spike/measure-surface.mjs --update',
  note: 'DSH 侧工具声明面基线（口径见脚本文件头）；与 pi 侧的 24,785B 前缀口径不同，不可相减',
  dsh: {
    tools: JSON.parse(readFileSync(resolve(HERE, '..', '..', 'dsh', 'spike', 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'), 'utf8')).version,
    cordis: JSON.parse(readFileSync(resolve(HERE, '..', '..', 'dsh', 'spike', 'node_modules', '@deepseek-ai', 'cordis', 'package.json'), 'utf8')).version,
  },
  toolCount,
  totalBytes,
  sha256,
  perTool,
};

const top = Object.entries(perTool).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log('=== DSH 工具声明面 ===');
console.log(`工具数 = ${toolCount}｜合计 = ${totalBytes} B（${(totalBytes / 1024).toFixed(1)} KB）｜sha256 = ${sha256.slice(0, 16)}…`);
console.log(`最大 5 个：${top.map(([n, b]) => `${n}=${b}B`).join('、')}`);

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
  if (base.toolCount !== measured.toolCount) problems.push(`工具数 ${base.toolCount} → ${measured.toolCount}`);
  if (base.totalBytes !== measured.totalBytes) problems.push(`合计字节 ${base.totalBytes} → ${measured.totalBytes}`);
  if (base.sha256 !== measured.sha256) problems.push('声明面 sha256 变了');
  const baseNames = new Set(Object.keys(base.perTool ?? {}));
  const nowNames = new Set(Object.keys(perTool));
  const added = [...nowNames].filter((n) => !baseNames.has(n));
  const removed = [...baseNames].filter((n) => !nowNames.has(n));
  const resized = [...nowNames].filter((n) => baseNames.has(n) && base.perTool[n] !== perTool[n]);
  if (added.length) problems.push(`新增工具：${added.join(', ')}`);
  if (removed.length) problems.push(`移除工具：${removed.join(', ')}`);
  if (resized.length) problems.push(`字节变化：${resized.map((n) => `${n} ${base.perTool[n]}→${perTool[n]}`).join('、')}`);
  if (problems.length) {
    console.error('❌ 工具声明面相对基线漂移：');
    for (const p of problems) console.error(`   · ${p}`);
    console.error('   若确认是有意改动：node dsh/spike/measure-surface.mjs --update 后提交（守门纪律：不擅自抬预算）');
    process.exit(1);
  }
  console.log('✅ 工具声明面与基线一致');
}
