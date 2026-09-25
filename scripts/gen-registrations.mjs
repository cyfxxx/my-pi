#!/usr/bin/env node
/**
 * gen-registrations.mjs — 注册面基线生成/校验
 *
 * 背景：`check-features.sh` 原本把 12 个功能的工具/命令/快捷键清单**手写**在脚本里，
 * 每次新增工具都要手工同步（历史上就漏检过 18 个工具）。改为从代码生成基线并做棘轮校验：
 * 代码与 `scripts/registration-baseline.json` 不一致即失败，提示用 `--update` 显式刷新
 * （刷新会进 diff，便于人工确认"注册面确实变了"）。
 *
 * 用法：
 *   node scripts/gen-registrations.mjs            # 校验（不一致 exit 1）
 *   node scripts/gen-registrations.mjs --update   # 重新生成基线
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES = join(ROOT, 'custom', 'features');
const BASELINE = join(ROOT, 'scripts', 'registration-baseline.json');
const UPDATE = process.argv.includes('--update');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const tools = {};
const commands = {};
const shortcuts = {};

for (const feature of readdirSync(FEATURES)) {
  const dir = join(FEATURES, feature);
  if (!statSync(dir).isDirectory()) continue;
  const t = new Set();
  const c = new Set();
  const s = new Set();
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/registerTool\(\s*(?:pi\s*,\s*)?\{(.{0,400}?)\bname\s*:\s*['"]([a-zA-Z0-9_]+)['"]/gs)) {
      t.add(m[2]);
    }
    for (const m of src.matchAll(/registerCommand\(\s*(?:pi\s*,\s*)?['"]([a-zA-Z0-9_-]+)['"]/g)) {
      c.add(m[1]);
    }
    for (const m of src.matchAll(/registerShortcut\(\s*pi\s*,\s*Key\.([A-Za-z0-9_]+)\(([^)]*)\)/g)) {
      s.add(`${m[1]}(${m[2].trim()})`);
    }
    for (const m of src.matchAll(/registerShortcut\(\s*pi\s*,\s*Key\.([A-Za-z0-9_]+)\b(?!\()/g)) {
      s.add(m[1]);
    }
  }
  if (t.size) tools[feature] = [...t].sort();
  if (c.size) commands[feature] = [...c].sort();
  if (s.size) shortcuts[feature] = [...s].sort();
}

const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const current = {
  tools: sortObj(tools),
  commands: sortObj(commands),
  shortcuts: sortObj(shortcuts),
};

const toolCount = Object.values(current.tools).reduce((n, v) => n + v.length, 0);
const cmdCount = Object.values(current.commands).reduce((n, v) => n + v.length, 0);
const shortCount = Object.values(current.shortcuts).reduce((n, v) => n + v.length, 0);

if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`✓ 已更新基线 ${relative(ROOT, BASELINE)}：工具 ${toolCount}、命令 ${cmdCount}、快捷键 ${shortCount}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`❌ 基线不存在：${relative(ROOT, BASELINE)}（运行 node scripts/gen-registrations.mjs --update 生成）`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));

const problems = [];

// 逐功能对比
for (const kind of ['tools', 'commands', 'shortcuts']) {
  const base = baseline[kind] ?? {};
  const cur = current[kind] ?? {};
  for (const feature of new Set([...Object.keys(base), ...Object.keys(cur)])) {
    const b = new Set(base[feature] ?? []);
    const c = new Set(cur[feature] ?? []);
    const added = [...c].filter((x) => !b.has(x));
    const removed = [...b].filter((x) => !c.has(x));
    if (added.length) problems.push(`${kind}/${feature} 新增未登记: ${added.join(', ')}`);
    if (removed.length) problems.push(`${kind}/${feature} 已消失: ${removed.join(', ')}`);
  }
}

console.log(`当前注册面：工具 ${toolCount}、命令 ${cmdCount}、快捷键 ${shortCount}`);
if (problems.length > 0) {
  console.error('❌ 注册面与基线不一致：');
  for (const p of problems) console.error(`   ${p}`);
  console.error('\n确认变更符合预期后运行：node scripts/gen-registrations.mjs --update');
  process.exit(1);
}
console.log('✓ 注册面与基线一致');
