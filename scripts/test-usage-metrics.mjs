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
function makeFixture({ frontChange, segChange = null, coldStarts = 0, toolsBytes = null, bashCalls = null, appendLost = 0, appendMissingFlat = 0 }) {
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

  // 干扰项：工具级台账里有 input/cacheRead 字段但全是空值，旧实现会（错误地）尝试从这里取数。
  // 工具名用 read（不是 bash）：避免混进"回合内 bash 调用分布"的口径断言。
  // bashCalls：可选的逐次 bash 调用样本（offsetMs 相对 now，正值＝最后一条边界之后）。
  const usageLines = [JSON.stringify({ ts: now - 1000, tool: 'read', ok: true, outputTokens: 191 })];
  for (const c of bashCalls ?? []) {
    usageLines.push(
      JSON.stringify({ ts: now + c.offsetMs, tool: 'bash', ok: true, outputTokens: 10, ...(c.merged !== undefined ? { merged: c.merged, segments: c.segments ?? 2 } : {}) }),
    );
  }
  writeFileSync(join(mem, 'context', 'usage.jsonl'), usageLines.join('\n') + '\n');

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
      ...(toolsBytes !== null ? { toolsBytes, systemBytes: 7400 } : {}),
      messageCount: 6,
      changed: changed(
        segChange === 'head' ? 'messages@0-7' : segChange === 'mid' ? 'messages@32-39' : frontChange ? 'tools' : null,
      ),
    },
    // 加固块丢失（2026-10-07）：进程内 system 漂移，systemAppend 由 true 翻成 false。
    // 段字节数全未变、system 却变了 —— 只能解释为"末尾那块整块丢了"，而非某段被改写。
    ...Array.from({ length: appendLost }, (_, i) => ({
      ts: now - 500 + i,
      sinceLastMs: 4000,
      total: `lost${i}`,
      system: 'sLOST',
      systemAppend: false,
      systemBytes: 7239,
      systemSections: { preamble: 171, tools: 490, rules: 790, docs: 1271, addendum: 1816, skills: 2570, cwd: 24 },
      systemChangedSections: [],
      tools: 't2',
      head: 'h1',
      segments: seg('s0'),
      level: 'high',
      messageCount: 6,
      changed: ['system', 'system:append-lost'],
    })),
    // 加固块**持续**缺失（2026-10-07 补的检测盲区）：进程内首条指纹 prev=null → `changed` 恒为
    // 空数组，所以"每轮都丢"反而一个 `system:append-lost` 转换标记都不产生。判据必须落到
    // 逐条记录的 `systemAppend === false` 上，否则最坏情况静默通过。
    ...Array.from({ length: appendMissingFlat }, (_, i) => ({
      ts: now - 400 + i,
      sinceLastMs: 5000,
      total: `flat${i}`,
      system: 'sFLAT',
      systemAppend: false,
      systemBytes: 7239,
      systemSections: { preamble: 171, tools: 490, rules: 790, docs: 1271, addendum: 1816, skills: 2570, cwd: 24 },
      systemChangedSections: [],
      tools: 't2',
      head: 'h1',
      segments: seg('s0'),
      level: 'high',
      messageCount: 6,
      changed: [],
    })),
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

// ── 用例 2d：前缀体积可见 + 工具声明上限告警（2026-10-01 实测：工具声明是前缀最大构件）──
{
  const big = makeFixture({ frontChange: false, toolsBytes: 90 * 1024 });
  try {
    const out = runHealth(big, { PI_HEALTH_TOOLS_KB_CEIL: '80' });
    check('工具声明体积被报出', out.includes('工具声明=90.0KB'), out.trim().split('\n')[0]);
    check('工具声明超上限触发 alert', out.includes('工具声明 90.0KB'));
  } finally {
    rmSync(big.root, { recursive: true, force: true });
  }
  const plain = makeFixture({ frontChange: false });
  try {
    const out = runHealth(plain);
    check('无体积字段时不臆造体积', !out.includes('工具声明='));
  } finally {
    rmSync(plain.root, { recursive: true, force: true });
  }
}

// ── 用例：回合内 bash 调用分布（P4 第三批：碎调用软规则的可观测化）──
{
  // 桶边界 = 3 条每轮用量记录的 ts（now-3000/-2000/-1000）；调用落在"最后一个严格小于它的边界"之后
  const calls = [
    { offsetMs: -2500 }, // 桶 0：1 次
    { offsetMs: -1500 }, { offsetMs: -1400 }, // 桶 1：2 次
    { offsetMs: -500 }, { offsetMs: -400 }, { offsetMs: -300 }, // 桶 2：3 次
  ];
  const fixture = makeFixture({ frontChange: false, bashCalls: calls });
  try {
    const out = runHealth(fixture);
    check('每步 bash 调用数分位（p50=2/p90=2/max=3，n=3）', out.includes('每步bash=p50=2/p90=2/max=3(n=3)'), out.trim().split('\n')[0]);
    check('无 merged 字段时单命令占比记 n/a（不猜）', out.includes('单命令=n/a(旧记录无字段)'), out.trim().split('\n')[0]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }

  // 带 merged 的样本：10 条里 1 条单命令 → 10.0%
  const flagged = [
    ...Array.from({ length: 9 }, (_, i) => ({ offsetMs: -500 - i, merged: true })),
    { offsetMs: -400, merged: false },
  ];
  const f2 = makeFixture({ frontChange: false, bashCalls: flagged });
  try {
    const out = runHealth(f2);
    check('单命令占比 = 1/10 = 10.0%', out.includes('单命令=10.0%(1/10)'), out.trim().split('\n')[0]);
    check('低于阈值时不告警', !out.includes('碎命令占比'));
  } finally {
    rmSync(f2.root, { recursive: true, force: true });
  }

  // 漂移：样本数达判定门槛（30）且单命令占比 100% > 25% → alert 并点名
  const drifted = Array.from({ length: 30 }, (_, i) => ({ offsetMs: -500 - i, merged: false }));
  const f3 = makeFixture({ frontChange: false, bashCalls: drifted });
  try {
    const out = runHealth(f3);
    check('单命令占比 100% 触发 alert', out.includes('结论=alert'));
    check('告警原因点名碎命令占比', out.includes('碎命令占比 100.0%>25%'));
  } finally {
    rmSync(f3.root, { recursive: true, force: true });
  }
}

// ── 用例 2e：压缩导致的前缀重放应归因，不再误报为缓存退化（2026-10-05 实测）──
// 实测：compact-1791204702683（12:51:42，reason=manual）后 16 秒出现
// changed=[head,messages,messages@0-7]，当日 3 次日报全部 alert。压缩改写前缀头部是压缩的
// 固有代价 —— 应计入"压缩重放"并留痕，而不是当成来源不明的整段重算。
{
  /** 把第 4 条用量做大，命中率压到 82%，未命中/轮抬到 16125 → 两条阈值都越线 */
  const lowHit = (mem) => {
    const now = Date.now();
    const rows = [
      { ts: now - 4000, input: 1000, cacheRead: 99000, cacheWrite: 0, output: 500 },
      { ts: now - 3000, input: 2000, cacheRead: 98000, cacheWrite: 0, output: 600 },
      { ts: now - 2000, input: 1500, cacheRead: 98500, cacheWrite: 0, output: 400 },
      { ts: now - 500, input: 60000, cacheRead: 0, cacheWrite: 0, output: 400 },
    ];
    writeFileSync(join(mem, 'context', '.usage-diag.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };

  const unexplained = makeFixture({ frontChange: false, segChange: 'head' });
  try {
    lowHit(unexplained.mem);
    const out = runHealth(unexplained);
    check('（基线）低命中率触发告警', out.includes('加权命中率'), out.trim().split('\n')[0]);
    check('（基线）首段分叉报整段重放', out.includes('等价整段重放'));
    check('（基线）未命中/轮超限告警', out.includes('疑似整段重算'));
    check('（基线）压缩重放为 0', out.includes('压缩重放=0'), out.trim().split('\n')[0]);
  } finally {
    rmSync(unexplained.root, { recursive: true, force: true });
  }

  const explained = makeFixture({ frontChange: false, segChange: 'head' });
  try {
    lowHit(explained.mem);
    // 压缩检查点：紧接在第二条指纹（now-1000）之前，落在 10 分钟归因窗口内
    const cdir = join(explained.mem, 'checkpoints', 'compact');
    mkdirSync(cdir, { recursive: true });
    writeFileSync(join(cdir, 'compact-1-x.json'), JSON.stringify({ ts: Date.now() - 1100, reason: 'manual', messages: [] }));
    const out = runHealth(explained);
    // 只看「原因」行：阈值仍会出现在「已知」留痕里，但不得构成告警理由
    const reasonLine = (out.match(/└ 原因: .*/) || [''])[0];
    check('压缩重放被单独计数', out.includes('压缩重放=1'), out.trim().split('\n')[0]);
    check('压缩归因写入「已知」留痕', out.includes('已知:') && out.includes('压缩'), out.trim());
    check('压缩吃掉的命中率不再告警', !reasonLine.includes('加权命中率'), reasonLine);
    check('压缩吃掉的未命中不再告警', !reasonLine.includes('疑似整段重算'), reasonLine);
    check('可归因的分叉不报整段重放', !reasonLine.includes('等价整段重放'), reasonLine);
  } finally {
    rmSync(explained.root, { recursive: true, force: true });
  }

  // 归因窗口（10 分钟）之外的旧压缩不得"原谅"当前分叉
  const stale = makeFixture({ frontChange: false, segChange: 'head' });
  try {
    lowHit(stale.mem);
    const cdir = join(stale.mem, 'checkpoints', 'compact');
    mkdirSync(cdir, { recursive: true });
    writeFileSync(join(cdir, 'compact-1-x.json'), JSON.stringify({ ts: Date.now() - 30 * 60 * 1000, reason: 'manual' }));
    const out = runHealth(stale);
    const reasonLine = (out.match(/└ 原因: .*/) || [''])[0];
    check('窗口外的压缩不豁免分叉', reasonLine.includes('等价整段重放'), reasonLine);
    check('窗口外的压缩不计入压缩重放', out.includes('压缩重放=0'), out.trim().split('\n')[0]);
  } finally {
    rmSync(stale.root, { recursive: true, force: true });
  }
}

// ── 用例 2f：system 加固块丢失/缺失（2026-10-07 实测：147,555 + 10,308 token 全价重放 = 会话未命中 60.8%）──
// pi 会静默吞掉 `before_agent_start` 处理器的异常 → my-pi 追加的 system 加固块整块消失 →
// 前缀从第 0 个 token 起分叉。这是**确定事件**，必须 alert，且不能被"压缩重放"那类免责说明吃掉。
{
  const fixture = makeFixture({ appendLost: 1 });
  try {
    const out = runHealth(fixture);
    const first = out.trim().split('\n')[0];
    check('加固块缺失被计数', out.includes('加固块缺失=1'), first);
    check('加固块缺失触发 alert', out.includes('结论=alert'));
    check('告警写明「进程内 system 漂移」而非压缩代价', out.includes('进程内 system 漂移'));
    check('告警指向独立台账', out.includes('system-append-lost.jsonl'));
    check('加固块缺失不被计入前端变更', out.includes('前端变更=0'), first);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

// 检测盲区回归：进程内"每轮都缺"时不会产生 `system:append-lost` 转换标记（首条 prev=null，
// `changed` 恒为空），只看转换标记的实现会**静默通过**最坏情况。判据必须落在逐条 `systemAppend`。
{
  const fixture = makeFixture({ appendMissingFlat: 2 });
  try {
    const out = runHealth(fixture);
    const first = out.trim().split('\n')[0];
    check('持续缺失（无转换标记）仍被计数', out.includes('加固块缺失=2'), first);
    check('持续缺失仍触发 alert', out.includes('结论=alert'));
    check('持续缺失的告警不谎称有转换标记', !out.includes('是"丢失转换"'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = makeFixture({ appendLost: 0 });
  try {
    const out = runHealth(fixture);
    check('无缺失时加固块缺失=0', out.includes('加固块缺失=0'), out.trim().split('\n')[0]);
    check('无缺失时不产生加固块告警', !out.includes('system 加固块缺失'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
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
