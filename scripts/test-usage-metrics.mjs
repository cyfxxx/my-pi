#!/usr/bin/env node
/**
 * test-usage-metrics.mjs — 成本度量的口径守门（无 LLM、无网络）
 *
 * 为什么需要它：2026-09-26..09-29 的 `daily-health.log` 连续多天写「命中=n/a(无数据)」，
 * 而同期加权命中率实际跌到 80.66%（09-26）——因为脚本读的是 `context/usage.jsonl`
 * （工具级台账，只有 outputTokens，没有 input/cacheRead），不是每轮用量的
 * `context/.usage-diag.jsonl`。度量本身失效时，任何阈值告警都不会触发。
 *
 * 本守门用**合成数据**驱动真实脚本，锁定三件事：
 *   1. 命中率/未命中每次确实从每轮用量算出（不再是 n/a）；
 *   2. 前缀前端变更（system/tools/head/level）会触发 alert —— 这是整段缓存失效的先行指标；
 *   3. 旧数据源（usage.jsonl）即使存在也不能被当成命中率来源。
 *
 * 用法：node scripts/test-usage-metrics.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failed = 0;

function check(name, cond, detail = '') {
  results.push(name);
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 造一个临时 memory 目录：每轮用量 + 工具级台账 + 前缀指纹。同时造空的 agent 目录，保证用例自洽 */
function makeFixture({ frontChange, segChange = null, coldStarts = 0 }) {
  const root = mkdtempSync(join(tmpdir(), 'my-pi-usage-'));
  const mem = join(root, 'memory');
  const agent = join(root, 'agent');
  mkdirSync(join(mem, 'context'), { recursive: true });
  mkdirSync(join(mem, 'logs'), { recursive: true });
  mkdirSync(join(mem, 'scheduler'), { recursive: true });
  mkdirSync(agent, { recursive: true });
  // 空种子 + 空任务表 → 种子失配恒为 0，避免真实仓库的种子定义污染用例
  writeFileSync(join(agent, 'scheduled-seeds.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(join(mem, 'scheduler', 'tasks.json'), JSON.stringify({ tasks: [] }));

  const now = Date.now();
  const diag = [
    { ts: now - 3000, input: 1000, cacheRead: 99000, cacheWrite: 0, output: 500, reasoning: 200, total: 100500, contextTokens: 100000 },
    { ts: now - 2000, input: 2000, cacheRead: 98000, cacheWrite: 0, output: 600, reasoning: 250, total: 100600, contextTokens: 100000 },
    { ts: now - 1000, input: 1500, cacheRead: 98500, cacheWrite: 0, output: 400, reasoning: 150, total: 100400, contextTokens: 100000 },
  ];
  writeFileSync(join(mem, 'context', '.usage-diag.jsonl'), diag.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // 干扰项：工具级台账里有 input/cacheRead 字段但全是空值，旧实现会（错误地）尝试从这里取数
  writeFileSync(
    join(mem, 'context', 'usage.jsonl'),
    JSON.stringify({ ts: now - 1000, tool: 'bash', ok: true, outputTokens: 191 }) + '\n',
  );

  const seg = (tag) => [tag, 'b', 'c'];
  const changed = (extra) => [...(extra ? [extra] : []), 'messages'];
  const fps = [
    {
      ts: now - 3000,
      sinceLastMs: 9000,
      total: 'aaa',
      system: 's1',
      tools: 't1',
      head: 'h1',
      segments: seg('s0'),
      level: 'high',
      messageCount: 4,
      changed: ['messages'],
    },
    {
      ts: now - 1000,
      sinceLastMs: 2000,
      total: 'bbb',
      system: 's1',
      tools: 't2',
      head: 'h1',
      // 段 0 与上一条相同；`messages@0-7` 由「段 0 分叉」造出（segChange='head' 时改为不同）
      segments: segChange === 'head' ? seg('sX') : seg('s0'),
      level: 'high',
      messageCount: 6,
      changed: changed(
        segChange === 'head' ? 'messages@0-7' : segChange === 'mid' ? 'messages@32-39' : frontChange ? 'tools' : null,
      ),
    },
    // 冷启动：无 sinceLastMs 的记录 = 进程首个请求（fingerprintRequest 在 prev=null 时省略该字段）
    ...Array.from({ length: coldStarts }, (_, i) => ({
      ts: now - 2500 + i, // 必须早于最后一条用量记录，否则配不上对
      total: `cold${i}`,
      system: 's1',
      tools: 't2',
      head: 'h1',
      segments: seg('s0'),
      level: 'high',
      messageCount: 6,
      changed: [],
    })),
  ];
  writeFileSync(join(mem, 'logs', 'prefix-fingerprints.jsonl'), fps.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { root, mem, agent };
}

function runHealth({ mem, agent }, extraEnv = {}) {
  const r = spawnSync('node', [join(ROOT, 'scripts', 'daily-health.mjs'), '--print'], {
    encoding: 'utf8',
    env: { ...process.env, PI_MEMORY_DIR: mem, PI_CODING_AGENT_DIR: agent, ...extraEnv },
    timeout: 30000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

// ── 用例 1：前端变更 → alert，且口径来自每轮用量 ──
{
  const fixture = makeFixture({ frontChange: true });
  try {
    const out = runHealth(fixture);
    // 命中率 295500/300000 = 98.5%
    check('命中率由每轮用量算出（98.5%，非 n/a）', out.includes('命中=98.5%'), out.trim().split('\n')[0]);
    check('未命中/轮 = 4500/3 = 1500', out.includes('未命中/轮=1500'), out.trim().split('\n')[0]);
    check('不再出现 n/a(无数据)', !out.includes('n/a(无数据)'));
    check('前端变更被计数（1 次）', out.includes('前端变更=1'), out.trim().split('\n')[0]);
    check('前端变更触发 alert', out.includes('结论=alert'));
    check('告警原因指出前缀前端变更', out.includes('前缀前端变更'));
    check('轮数取每轮用量记录数（3）', out.includes('轮数=3'), out.trim().split('\n')[0]);
    check('自洽 fixture 下种子失配为 0', out.includes('种子失配=0'), out.trim().split('\n')[0]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

// ── 用例 2：无前端变更 → 不因前缀因素告警（命中率 98.5% 高于 97% 安全线）──
// 不断言整体结论：守门脚本自身的工作区改动也会导致 alert，与本用例无关。
{
  const fixture = makeFixture({ frontChange: false });
  try {
    const out = runHealth(fixture);
    check('无前端变更时前端变更=0', out.includes('前端变更=0'), out.trim().split('\n')[0]);
    check('无前端变更时不产生前缀告警', !out.includes('前缀前端变更'));
    check('无前端变更时不产生未命中告警', !out.includes('未命中/轮') || !out.includes('疑似整段重算'));
    check('命中 98.5% 不低于安全线，不产生命中率告警', !out.includes('加权命中率'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

// ── 用例 2a：head 误报抑制（2026-10-01 实测）──
// 实测：新会话第 2 次请求 msgs 3→5 会被记成 changed=['head','messages']，而 segments 并未分叉。
// 历史里 `head,messages @ msgs≈6-7` 大多是"头窗内追加"，不是前缀断裂。
{
  const legacy = makeFixture({ frontChange: false });
  try {
    // 把第二条记录改成 legacy 形态（去掉 segments）且只含 head
    const f = join(legacy.mem, 'logs', 'prefix-fingerprints.jsonl');
    const recs = readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    delete recs[1].segments;
    recs[1].changed = ['head', 'messages'];
    writeFileSync(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const out = runHealth(legacy);
    check('旧记录只含 head 不计入前端变更（与追加无法区分）', out.includes('前端变更=0'), out.trim().split('\n')[0]);
    check('旧记录 head 不触发前缀告警', !out.includes('前缀前端变更'));
  } finally {
    rmSync(legacy.root, { recursive: true, force: true });
  }
}

// ── 用例 2b：分段分叉定位（2026-10-01 新增口径）──
// 旧口径只认 system/tools/head/level，`messages@0-7`（整段重放）会被漏掉；
// 起点靠后的分叉代价递减，不应与整段失效混为一谈。
{
  const head = makeFixture({ frontChange: false, segChange: 'head' });
  try {
    const out = runHealth(head);
    check('首段分叉被计数', out.includes('首段分叉=1'), out.trim().split('\n')[0]);
    check('首段分叉触发 alert', out.includes('结论=alert'));
    check('首段分叉归因写明「等价整段重放」', out.includes('等价整段重放'));
    check('分叉定位给出起点', out.includes('messages@0-7'), out.trim().split('\n')[0]);
  } finally {
    rmSync(head.root, { recursive: true, force: true });
  }

  const mid = makeFixture({ frontChange: false, segChange: 'mid' });
  try {
    const out = runHealth(mid);
    check('中后段分叉单独计数', out.includes('中后段分叉=1'), out.trim().split('\n')[0]);
    check('中后段分叉不报整段重放', !out.includes('等价整段重放'));
    check('中后段分叉不产生前缀前端告警', !out.includes('前缀前端变更'));
  } finally {
    rmSync(mid.root, { recursive: true, force: true });
  }
}

// ── 用例 2c：冷启动计数（自改/重启的固有代价）──
{
  const many = makeFixture({ frontChange: false, coldStarts: 3 });
  try {
    const out = runHealth(many, { PI_HEALTH_COLDSTART_CEIL: '1' });
    check('冷启动被计数', out.includes('冷启动=3'), out.trim().split('\n')[0]);
    check('冷启动超阈值触发 alert', out.includes('进程冷启动'));
  } finally {
    rmSync(many.root, { recursive: true, force: true });
  }
  const few = makeFixture({ frontChange: false, coldStarts: 1 });
  try {
    const out = runHealth(few, { PI_HEALTH_COLDSTART_CEIL: '8' });
    check('冷启动未超阈值不告警', !out.includes('进程冷启动'));
    // 冷启动与"该指纹之后的第一条用量"配对 → 报出它的未命中量（自改/重启的实际代价）
    check('冷启动未命中被配对计数', /冷启动=1\(\d+\/平均\d+\)/.test(out), out.trim().split('\n')[0]);
  } finally {
    rmSync(few.root, { recursive: true, force: true });
  }
}

// ── 用例 3：只有工具级台账（旧数据源）→ 命中率记 n/a，绝不冒充命中率 ──
{
  const root = mkdtempSync(join(tmpdir(), 'my-pi-usage-empty-'));
  const mem = join(root, 'memory');
  const agent = join(root, 'agent');
  mkdirSync(join(mem, 'context'), { recursive: true });
  mkdirSync(join(mem, 'scheduler'), { recursive: true });
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, 'scheduled-seeds.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(join(mem, 'scheduler', 'tasks.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(
    join(mem, 'context', 'usage.jsonl'),
    JSON.stringify({ ts: Date.now() - 1000, tool: 'bash', ok: true, outputTokens: 191 }) + '\n',
  );
  try {
    const out = runHealth({ mem, agent });
    check('缺少每轮用量时命中率记 n/a 而非瞎算', out.includes('命中=n/a(无数据)'), out.trim().split('\n')[0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('');
if (failed > 0) {
  console.log(`❌ 用量度量守门失败 ${failed}/${results.length}`);
  process.exit(1);
}
console.log(`用量度量守门通过（${results.length} 项）`);
