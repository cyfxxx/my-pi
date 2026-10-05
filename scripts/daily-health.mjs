#!/usr/bin/env node
/**
 * daily-health.mjs — 每日健康度量（确定性、零 LLM，只读数据源，仅追加日志）
 *
 * 迁移自 pi-tools `scripts/maintenance/daily-health.mjs`，按 my-pi 数据布局适配：
 *   - 加权命中率 / 未命中每次 / 输出占比：`portable/memory/context/.usage-diag.jsonl`
 *     （`context/usage-diag/diag.ts` 产出的**每轮**用量，含 input/cacheRead/output），
 *     过去 24h ΣcacheRead / Σ(input+cacheRead)。**注意不要改用 `context/usage.jsonl`**：
 *     那是工具级台账，只有 outputTokens，没有缓存字段 → 命中率恒为 n/a（2026-09-26..29
 *     的日报连续多天 n/a，命中率跌到 80% 也未告警）。
 *   - 前缀前端变更次数：`portable/memory/logs/prefix-fingerprints.jsonl`，system/tools/
 *     head/level 任一变化都使整段前缀缓存失效（每次≈一次全价重算），是成本退化的先行指标。
 *   - 存储：`portable/memory/entries.json` 大小/条目数
 *   - 种子-任务失配：`portable/agent/scheduled-seeds.json` vs `portable/memory/scheduler/tasks.json`
 *   - 守门脚本防篡改：关键守门脚本有未提交改动 → alert
 *
 * 已知原因豁免（2026-10-05）：**上下文压缩**必然改写前缀头部（摘要替换 messages@0-7），
 * 于是紧接着的第一次请求就是一次整段重放——这是压缩的固有代价，不是退化。实测
 * `compact-1791204702683`（12:51:42）后 16 秒即出现 `changed=[head,messages,messages@0-7]`。
 * 因此：压缩窗口内的分叉单独计数（`压缩重放=N`），不进告警；当窗口内**所有**前缀分叉都能
 * 归因到压缩时，命中率/未命中阈值也不再告警（否则每个压缩日都误报）。窗口内一旦出现
 * 无法归因的分叉，照旧告警。
 *
 * 环境变量：`PI_HEALTH_HIT_FLOOR`（默认 0.97）、`PI_HEALTH_UNCACHED_CEIL`（默认 3000）。
 *
 * 用法：
 *   node scripts/daily-health.mjs           # 计算并追加 portable/memory/logs/daily-health.log
 *   node scripts/daily-health.mjs --print   # 只输出不落盘
 */
import { readFileSync, statSync, existsSync, appendFileSync, mkdirSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = process.env.PI_CODING_AGENT_DIR || join(ROOT, 'portable', 'agent');
const MEM = process.env.PI_MEMORY_DIR || join(ROOT, 'portable', 'memory');
const USAGE = process.env.PI_USAGE_FILE || join(MEM, 'context', 'usage.jsonl');
// 每轮真实用量（含 input/cacheRead/output/reasoning）。`usage.jsonl` 只有工具级 outputTokens，
// 拿它算命中率永远是 n/a —— 2026-09-26..09-29 的日报因此连续多天写 "命中=n/a(无数据)"，
// 命中率跌到 80% 也没触发告警。这里改读用量诊断文件（context/usage-diag/diag.ts 产出）。
const USAGE_DIAG = process.env.PI_USAGE_DIAG_FILE || join(MEM, 'context', '.usage-diag.jsonl');
// 运行时前缀指纹（context/budget/prefix-fingerprint.ts 产出）：分段记录 system/tools/head/
// level/total 的变化，前端任一变化即整段缓存失效。
const FINGERPRINTS = process.env.PI_PREFIX_FINGERPRINT_FILE || join(MEM, 'logs', 'prefix-fingerprints.jsonl');
// 上下文压缩记录（context 功能的 compact 检查点）。只取 ts/reason，用于把"压缩导致的
// 前缀重放"与"来源不明的缓存退化"分开；目录不存在（测试夹具/新设备）时整条逻辑为空。
const COMPACT_DIR = process.env.PI_HEALTH_COMPACT_DIR || join(MEM, 'checkpoints', 'compact');
/** 缓存安全线：低于此命中率视为退化（日常应在 97% 以上；加权口径） */
const HIT_FLOOR = Number(process.env.PI_HEALTH_HIT_FLOOR) || 0.97;
/** 每次调用的未命中输入上限：超过说明存在整段重算 */
const UNCACHED_PER_CALL_CEIL = Number(process.env.PI_HEALTH_UNCACHED_CEIL) || 3000;
const ENTRIES = join(MEM, 'entries.json');
const SEEDS = join(AGENT, 'scheduled-seeds.json');
const TASKS = join(MEM, 'scheduler', 'tasks.json');
const LOG = join(MEM, 'logs', 'daily-health.log');
const WINDOW_MS = 24 * 60 * 60 * 1000;
const PRINT_ONLY = process.argv.includes('--print');

const reasons = [];
/** 已知原因说明（不构成 alert，但要留痕，否则"没告警"会被误读成"没问题"） */
const notes = [];

function loadJSONL(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      const ts = typeof r.ts === 'number' ? r.ts : Date.parse(r.ts);
      if (Number.isFinite(ts)) out.push({ ...r, ts });
    } catch {
      /* 跳过损坏行 */
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function loadUsage() {
  return loadJSONL(USAGE);
}

const now = Date.now();
const inWindow = (r) => r.ts >= now - WINDOW_MS;

// 主口径：每轮用量（含缓存字段）。usage.jsonl 仅作工具级调用计数兜底。
const diag = loadJSONL(USAGE_DIAG).filter(inWindow);
const records = diag.filter((r) => typeof r.input === 'number' && typeof r.cacheRead === 'number');
const usage = loadUsage().filter(inWindow);

const totInput = records.reduce((a, r) => a + (r.input || 0), 0);
const totCacheRead = records.reduce((a, r) => a + (r.cacheRead || 0), 0);
const totOutput = records.reduce((a, r) => a + (r.output || 0), 0);
const denom = totInput + totCacheRead;
const hit = denom > 0 ? totCacheRead / denom : null;
const uncachedPerCall = records.length > 0 ? totInput / records.length : null;

// 前端变更：system/tools/head/level 任一变化都会让整段前缀失效（每个都是一次全价重算）
const fps = loadJSONL(FINGERPRINTS).filter(inWindow);
const segStartOf = (c) => {
  const m = /^messages@(\d+)-/.exec(String(c || ''));
  return m ? Number(m[1]) : null;
};
const FRONT_SEGMENTS = new Set(['system', 'tools', 'level']);
// `head` 只覆盖前 6 条消息，**分不清"改写"与"在头窗内追加"**：实测新会话第 2 次请求
// msgs 3→5 就会被记成 changed=['head','messages']，而 segments 并未分叉——历史数据里那些
// `head,messages @ msgs≈6-7` 大多是这类误报。故：新记录（有 segments）用分叉定位取代 head；
// 没有 segments 的旧记录保持原判据，以便继续读历史。
const isFrontBreak = (f) => {
  const ch = f.changed || [];
  if (ch.some((c) => FRONT_SEGMENTS.has(c))) return true;
  // 新记录用分叉定位取代 head；旧记录（无 segments）**不再**用 head 判定——
  // 它与"在头窗内追加"无法区分，继续计入只会把误报留下去。
  return Array.isArray(f.segments) && ch.some((c) => segStartOf(c) === 0);
};
const frontChanges = fps.filter(isFrontBreak);
const totalOnly = fps.filter((f) => (f.changed || []).includes('total'));

// 分段分叉（2026-10-01 新增）：`messages@<start>-…` 给出前缀失效的**起点消息下标**。
// 起点在头部（start=0）等价于整段重放——最贵的一类，旧口径只认 system/tools/head/level，
// 会把这类漏掉；起点越靠后代价越小，单独计数，不再与"整段失效"混为一谈。
const segBreaks = fps.filter((f) => (f.changed || []).some((c) => segStartOf(c) !== null));
const headBreaks = segBreaks.filter((f) => (f.changed || []).some((c) => segStartOf(c) === 0));
const midBreaks = segBreaks.filter((f) => !headBreaks.includes(f));

// ── 上下文压缩归因（2026-10-05）──
// 压缩把 messages@0-7 换成摘要 → 前缀头部必然改写 → 紧接着的请求整段全价重放。这是压缩的
// 固有代价（压缩本身是为了省 token），不是退化。这里只读检查点的 ts/reason（ts 在文件头，
// 用 512 字节预读 + 正则，避免解析上 MB 的 messages 数组；失败则回退整文件 JSON.parse）。
const COMPACT_WINDOW_MS = 10 * 60 * 1000;
function loadCompactions() {
  if (!existsSync(COMPACT_DIR)) return [];
  const out = [];
  for (const f of readdirSync(COMPACT_DIR)) {
    if (!f.endsWith('.json')) continue;
    const p = join(COMPACT_DIR, f);
    let ts = null;
    let reason = '';
    try {
      const fd = openSync(p, 'r');
      try {
        const buf = Buffer.alloc(512);
        const n = readSync(fd, buf, 0, 512, 0);
        const head = buf.subarray(0, n).toString('utf-8');
        const mt = /"ts"\s*:\s*(\d+)/.exec(head);
        if (mt) {
          ts = Number(mt[1]);
          reason = (/"reason"\s*:\s*"([^"]*)"/.exec(head) || [, ''])[1];
        }
      } finally {
        closeSync(fd);
      }
      if (ts === null) {
        const j = JSON.parse(readFileSync(p, 'utf-8'));
        ts = typeof j.ts === 'number' ? j.ts : Date.parse(j.ts);
        reason = typeof j.reason === 'string' ? j.reason : '';
      }
    } catch {
      continue; // 读不动/损坏的检查点不参与归因（不猜）
    }
    if (Number.isFinite(ts)) out.push({ ts, reason });
  }
  return out;
}
const compactions = loadCompactions();
/** 该前缀分叉是否紧跟在一次压缩之后（压缩改写头部 → 下一次请求实测 16s 内出现分叉） */
const fromCompaction = (f) => compactions.some((c) => f.ts - c.ts >= 0 && f.ts - c.ts <= COMPACT_WINDOW_MS);
const headBreaksCompacted = headBreaks.filter(fromCompaction);
const headBreaksUnexplained = headBreaks.filter((f) => !fromCompaction(f));
const headBreakSet = new Set(headBreaks);
// 前端变更里已由"首段分叉"口径单独计过的记录不再重复计入（同一次失效此前会报两条理由）
const frontOnly = frontChanges.filter((f) => !headBreakSet.has(f));
const frontUnexplained = frontOnly.filter((f) => !fromCompaction(f));
/** 窗口内所有前缀分叉都能归因到压缩 → 命中率/未命中阈值不再告警（压缩的固有代价） */
const allBreaksExplained = headBreaks.length + frontOnly.length > 0 && headBreaksUnexplained.length === 0 && frontUnexplained.length === 0;

// 前缀体积（2026-10-01 实测口径）：工具声明是前缀里最大的构件，real payload 实测 62KB ≈ 15.6K token，
// 而 system 只有 ~7KB。这里报最近一次的实测体积，并设上限告警，防止工具面无声膨胀。
const TOOLS_KB_CEIL = Number(process.env.PI_HEALTH_TOOLS_KB_CEIL || 80);
const sized = fps.filter((f) => typeof f.toolsBytes === 'number');
const lastSize = sized.length > 0 ? sized[sized.length - 1] : null;
const toolsKB = lastSize ? lastSize.toolsBytes / 1024 : null;
const systemKB = lastSize && typeof lastSize.systemBytes === 'number' ? lastSize.systemBytes / 1024 : null;

// 冷启动：进程首个请求（`fingerprintRequest` 在 prev=null 时不写 sinceLastMs）。
// 每次冷启动都要把整个静态前缀按全价重发——my-pi 自己改代码/文档越频繁，这项越高。
const coldStarts = fps.filter((f) => !('sinceLastMs' in f));
// 把冷启动与它的未命中量配对：指纹记录在请求发出前写下，紧接着（5s 内）的第一条每轮用量
// 就是这个冷启动请求。配对不上记 0（不猜）。
const coldStartCost = (() => {
  let sum = 0;
  let paired = 0;
  const costs = [];
  for (const f of coldStarts) {
    // 指纹写在请求发出前、用量写在响应结束后，故取"该指纹之后的第一条用量"即可对上，
    // 只加一个宽上限防串到下一次会话（请求失败时本就没有用量记录 → 记为未配对）。
    const hit = records.find((r) => r.ts >= f.ts && r.ts - f.ts < 300_000);
    if (hit) {
      sum += hit.input || 0;
      paired++;
      costs.push(hit.input || 0);
    }
  }
  const avg = paired > 0 ? Math.round(sum / paired) : null;
  return { sum, paired, avg };
})();

// 回合内 bash 调用分布（P4 第三批，2026-10-01）：把 APPEND_SYSTEM.md 的软规则
// 「使用 bash 时优先合并多个独立检查为一次调用，避免逐条执行碎命令」变成**可观测指标**。
// 口径：回合边界取每轮用量记录（`.usage-diag.jsonl` 写在每步响应之后），
// 该步执行的工具调用落在 `usage.jsonl` 里、ts 晚于上一条边界。两个数字：
//   · 每步 bash 调用数 p50/p90/max —— 一次一步里反复起 bash 是"碎调用"的直接形态；
//   · 单命令占比 —— 命令里引号外没有连接符（`;`/`&&`/`||`/`|`/换行）的比例，越高越碎。
// 基线（2026-10-01 实测 6 个会话 / 1103 条命令）：单命令占比 1.4%、每步 p50=1 p90=2 max=3
// ——即规则本身被稳定遵守，故这里只告警"漂移"，不加限制。
// 注意：最后一条边界之后的调用都归入最后一步（在飞的那一步），会略抬高最后一个桶。
const SINGLE_CMD_CEIL = Number(process.env.PI_HEALTH_SINGLE_CMD_CEIL || 0.25);
const SINGLE_CMD_MIN_EVENTS = Number(process.env.PI_HEALTH_SINGLE_CMD_MIN || 30);
const bashStepCounts = (() => {
  if (records.length === 0) return [];
  const bounds = records.map((r) => r.ts).slice().sort((a, b) => a - b);
  const counts = new Array(bounds.length).fill(0);
  for (const u of usage) {
    if (u.tool !== 'bash') continue;
    // ts 可能是 ISO 字符串（生产写入）或 epoch 毫秒（测试夹具/手工补录），两者都收
    const t = typeof u.ts === 'number' ? u.ts : Date.parse(u.ts);
    if (!Number.isFinite(t)) continue;
    // 二分找"最后一个严格小于 t 的边界"：那就是该调用所属的那一步
    let lo = 0;
    let hi = bounds.length;
    let idx = -1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bounds[mid] < t) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (idx >= 0) counts[idx]++;
  }
  return counts.filter((c) => c > 0);
})();
/** 最近秩分位（偶数样本取下中位：p50 of [1,2] = 1），样本少时不外推 */
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}
const bashPerStep =
  bashStepCounts.length > 0
    ? {
        p50: percentile(bashStepCounts, 0.5),
        p90: percentile(bashStepCounts, 0.9),
        max: Math.max(...bashStepCounts),
        n: bashStepCounts.length,
      }
    : null;
// 只有带 `merged` 字段的记录（2026-10-01 之后写入）可判合并与否；旧记录不猜。
const bashFlagged = usage.filter((u) => u.tool === 'bash' && typeof u.merged === 'boolean');
const singleCmd =
  bashFlagged.length > 0
    ? { single: bashFlagged.filter((u) => u.merged === false).length, total: bashFlagged.length }
    : null;
const singleRatio = singleCmd ? singleCmd.single / singleCmd.total : null;

let entryCount = 0;
let sizeMB = 0;
try {
  sizeMB = statSync(ENTRIES).size / 1024 / 1024;
  const d = JSON.parse(readFileSync(ENTRIES, 'utf8'));
  entryCount = Array.isArray(d) ? d.length : (d.entries?.length ?? 0);
} catch {
  /* 缺失时保持 0 */
}

let seedDrift = 0;
try {
  const seeds = JSON.parse(readFileSync(SEEDS, 'utf8')).tasks || [];
  const local = {};
  try {
    for (const x of JSON.parse(readFileSync(TASKS, 'utf8')).tasks || []) local[x.name] = x;
  } catch {
    /* 无本地任务文件视为全部未注册 */
  }
  for (const s of seeds) {
    if (!local[s.name]) {
      seedDrift++;
      reasons.push(`种子任务 ${s.name} 未注册`);
    } else if (local[s.name].schedule && s.schedule && local[s.name].schedule !== s.schedule) {
      seedDrift++;
      reasons.push(`种子任务 ${s.name} schedule 漂移(${local[s.name].schedule}≠${s.schedule})`);
    } else if (typeof local[s.name].prompt === 'string' && s.prompt && local[s.name].prompt !== s.prompt) {
      seedDrift++;
      reasons.push(`种子任务 ${s.name} prompt 漂移`);
    }
  }
} catch {
  /* seeds 缺失不阻塞 */
}

const GUARD_SCRIPTS = ['scripts/golden-tasks.sh', 'scripts/daily-health.mjs', 'scripts/check-isolation.sh', 'scripts/check-features.sh'];
try {
  const out = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...GUARD_SCRIPTS], { encoding: 'utf8', timeout: 5000 });
  const dirty = out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  if (dirty.length) reasons.push(`守门脚本有未提交改动: ${dirty.join(', ')}`);
} catch {
  /* git 不可用不阻塞 */
}

if (records.length >= 3 && hit !== null && hit < HIT_FLOOR) {
  if (allBreaksExplained) {
    notes.push(`加权命中率 ${(hit * 100).toFixed(1)}%<${(HIT_FLOOR * 100).toFixed(0)}%：窗口内 ${headBreaksCompacted.length + frontOnly.filter(fromCompaction).length} 次前缀重放均由上下文压缩触发，属预期代价，不告警`);
  } else {
    reasons.push(`加权命中率 ${(hit * 100).toFixed(1)}%<${(HIT_FLOOR * 100).toFixed(0)}%`);
  }
}
if (records.length >= 3 && uncachedPerCall !== null && uncachedPerCall > UNCACHED_PER_CALL_CEIL) {
  if (allBreaksExplained) {
    notes.push(`未命中/轮 ${Math.round(uncachedPerCall)}>${UNCACHED_PER_CALL_CEIL}：同样由压缩后的整段重放贡献，属预期代价`);
  } else {
    reasons.push(`未命中/轮 ${Math.round(uncachedPerCall)}>${UNCACHED_PER_CALL_CEIL}（疑似整段重算）`);
  }
}
if (frontUnexplained.length > 0) {
  const segs = [...new Set(frontUnexplained.flatMap((f) => (f.changed || []).filter((c) => FRONT_SEGMENTS.has(c) || /^messages@0-/.test(c))))].join('+');
  reasons.push(`前缀前端变更 ${frontUnexplained.length} 次（${segs}）→ 每次整段缓存失效`);
}
// 起点在头部的中段分叉 = 整段重放（与前端变更同级），旧的 FRONT_SEGMENTS 口径看不到它。
// 压缩触发的那些另计（见"压缩重放"字段），不进告警。
if (headBreaksUnexplained.length > 0) {
  reasons.push(`前缀从首段分叉 ${headBreaksUnexplained.length} 次（messages@0-7）→ 等价整段重放`);
}
if (headBreaksCompacted.length > 0) {
  notes.push(`压缩重放 ${headBreaksCompacted.length} 次（reason=${[...new Set(compactions.map((c) => c.reason).filter(Boolean))].join('/') || '?'}）：压缩改写前缀头部的固有代价`);
}
const COLDSTART_CEIL = Number(process.env.PI_HEALTH_COLDSTART_CEIL || 8);
if (coldStarts.length > COLDSTART_CEIL) {
  reasons.push(`进程冷启动 ${coldStarts.length} 次>${COLDSTART_CEIL}（自改/重启代价）`);
}
if (toolsKB !== null && toolsKB > TOOLS_KB_CEIL) {
  reasons.push(`工具声明 ${toolsKB.toFixed(1)}KB>${TOOLS_KB_CEIL}KB（前缀最大构件膨胀）`);
}
if (singleCmd && singleCmd.total >= SINGLE_CMD_MIN_EVENTS && singleRatio > SINGLE_CMD_CEIL) {
  reasons.push(
    `碎命令占比 ${(singleRatio * 100).toFixed(1)}%>${(SINGLE_CMD_CEIL * 100).toFixed(0)}%（未合并的 bash 调用增多，实测基线 1.4%）`,
  );
}
const verdict = reasons.length ? 'alert' : 'ok';

const ts = new Date();
const p = (n) => String(n).padStart(2, '0');
const stamp = `${ts.getFullYear()}-${p(ts.getMonth() + 1)}-${p(ts.getDate())} ${p(ts.getHours())}:${p(ts.getMinutes())}`;
const hitStr = hit === null ? 'n/a(无数据)' : `${(hit * 100).toFixed(1)}%`;
const unStr = uncachedPerCall === null ? 'n/a' : String(Math.round(uncachedPerCall));
const outPct = totInput + totCacheRead + totOutput > 0 ? ((totOutput / (totInput + totCacheRead + totOutput)) * 100).toFixed(1) : 'n/a';
const coldStr = coldStartCost.paired > 0 ? `${coldStarts.length}(${coldStartCost.sum}/平均${coldStartCost.avg})` : `${coldStarts.length}`;
const sizeStr = toolsKB !== null ? ` 工具声明=${toolsKB.toFixed(1)}KB${systemKB !== null ? `/system=${systemKB.toFixed(1)}KB` : ''}` : '';
const bashStepStr = bashPerStep ? `p50=${bashPerStep.p50}/p90=${bashPerStep.p90}/max=${bashPerStep.max}(n=${bashPerStep.n})` : 'n/a';
const singleCmdStr = singleCmd
  ? `${(singleRatio * 100).toFixed(1)}%(${singleCmd.single}/${singleCmd.total})`
  : 'n/a(旧记录无字段)';
const line = `${stamp} 命中=${hitStr} 未命中/轮=${unStr} 输出占比=${outPct}% 前端变更=${frontChanges.length} 首段分叉=${headBreaks.length} 压缩重放=${headBreaksCompacted.length} 中后段分叉=${midBreaks.length} 冷启动=${coldStr}${sizeStr} 每步bash=${bashStepStr} 单命令=${singleCmdStr} 轮数=${records.length} 工具调用=${usage.length} 存储=${sizeMB.toFixed(2)}MB 条目=${entryCount} 种子失配=${seedDrift} 结论=${verdict}`;

console.log(line);
for (const n of notes) console.log(`  └ 已知: ${n}`);
if (totalOnly.length > 0) console.log(`  └ 提示: ${totalOnly.length} 次请求中段内容被改写（changed=total，命中率之外的前缀风险）`);
if (coldStarts.length > 0 && coldStartCost.paired === 0) {
  console.log('  └ 冷启动未命中: 未能与本窗口的每轮用量配对（缺少 .usage-diag.jsonl 记录）');
}
if (segBreaks.length > 0) {
  const starts = segBreaks.flatMap((f) => (f.changed || []).map(segStartOf).filter((n) => n !== null));
  const near = starts.filter((n) => n <= 7).length;
  const far = starts.filter((n) => n > 7);
  const farStr = far.length ? `，其余起点 ${Math.min(...far)}–${Math.max(...far)}（代价递减）` : '';
  console.log(`  └ 分叉定位: ${starts.length} 次（首段 ${near} 次＝整段重放；中后段 ${far.length} 次${farStr}）`);
}
if (verdict === 'alert') console.log('  └ 原因: ' + reasons.join('；'));
if (!PRINT_ONLY) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, line + '\n');
  // 已知原因也要落盘：只写 alert 会把"这次为什么不算 alert"从历史里抹掉
  for (const n of notes) appendFileSync(LOG, `  └ 已知: ${n}\n`);
  if (verdict === 'alert') appendFileSync(LOG, `  └ 原因: ${reasons.join('；')}\n`);
}
