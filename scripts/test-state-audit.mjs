#!/usr/bin/env node
/**
 * test-state-audit.mjs — 状态体检的口径守门（无 LLM、无网络、纯本地）
 *
 * 为什么需要它：状态体检本身是"判断力"，判错两个方向都糟——
 * 漏报（该吵的不吵）等于没做；误报（`mode`/`intervention` 只注册命令不注册工具，被当成
 * 未知功能名）会让 daily-health 天天 alert，最后没人看。这里用**合成状态**逐条锁定：
 *   1. 每一项不变量在"该触发"和"不该触发"两侧都有用例（含 healthy 状态零 finding）；
 *   2. 体检**只读**：跑完不动任何文件（守门脚本写状态是最坏的设计）；
 *   3. 三处真值不漂移：FIXED_MODES ↔ lib-mode.sh / logic.ts、功能名 ↔ ALL_FEATURES；
 *   4. CLI 退出码语义：error→1、--strict 时 warning→1、--json 可解析。
 *
 * 用法：node scripts/test-state-audit.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_STATE_FRESH_MS,
  FIXED_MODES,
  MODE_NOTICE_TTL_MS,
  RESTART_GUARD_MS,
  auditState,
  buildSnapshot,
  summarize,
} from './lib-state-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'scripts', 'state-audit.mjs');
const results = [];
let failed = 0;

function check(name, cond, detail = '') {
  results.push(name);
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const FEATURES = ['web-search', 'context', 'link', 'memory', 'mode', 'plan-mode', 'intervention', 'subagent', 'tmux', 'browser', 'voice', 'autopilot'];
const NOW = Date.parse('2026-10-06T12:00:00.000Z');

/** 造一个临时 agent 目录；files 里 null 表示不写该文件 */
function makeAgent(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'my-pi-state-'));
  mkdirSync(join(dir, 'autopilot'), { recursive: true });
  mkdirSync(join(dir, 'modes'), { recursive: true });
  const write = (rel, content) => {
    if (content === undefined) return;
    if (content === null) return;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content));
  };
  write('modes.json', files.modes);
  write('modes-sessions.json', files.sessions);
  write('mode-restart-guard.json', files.guard);
  write('autopilot/state.json', files.admin);
  write('modes-state.json', files.legacyState);
  write('modes/roleplay.md', files.persona);
  if (files.extra) for (const [rel, content] of Object.entries(files.extra)) write(rel, content);
  return dir;
}

function findingsOf(dir, { env = {}, exists = undefined, knownFeatures = FEATURES } = {}) {
  return auditState(buildSnapshot({ agentDir: dir, knownFeatures, now: NOW, env, exists }));
}

const codes = (fs) => fs.map((f) => f.code);
const has = (fs, code) => codes(fs).includes(code);

/** 健康基线：modes.json + 会话记录 + 存在的会话文件 + 存在的人设文件 */
function healthyFiles(over = {}) {
  const session = '/tmp/my-pi-state-session.jsonl';
  return {
    modes: { default: 'full', modes: { roleplay: { description: 'rp', features: ['web-search', 'memory'], thinking: 'low', appendPrompt: 'modes/roleplay.md', memoryNamespace: 'roleplay' } } },
    sessions: { [session]: { mode: 'roleplay', updatedAt: new Date(NOW - 3600_000).toISOString() } },
    persona: '人设\n',
    extra: { [session.replace('/tmp/', 'sessions/')]: 'x' },
    ...over,
  };
}

const dirs = [];
function agent(files, opts) {
  const d = makeAgent(files);
  dirs.push(d);
  return { dir: d, findings: findingsOf(d, opts) };
}

console.log('状态体检：不变量两侧用例');
{
  const d = makeAgent(healthyFiles());
  dirs.push(d);
  const f = findingsOf(d, { exists: (abs) => !abs.endsWith('.jsonl') || abs.includes('my-pi-state-session') });
  check('健康状态：零 error / 零 warning', summarize(f).error === 0 && summarize(f).warning === 0, JSON.stringify(codes(f)));
}

check('modes.json 缺失 → modes-missing（error）', has(agent({ modes: undefined, sessions: undefined }).findings, 'modes-missing'));
check('modes.json 损坏 → modes-corrupt（error）', has(agent({ modes: '{ not json' }).findings, 'modes-corrupt'));
check('default 指向未知模式 → modes-default-unknown（error）', has(agent(healthyFiles({ modes: { default: 'nope', modes: {} } })).findings, 'modes-default-unknown'));
check('遗留 current 字段 → 仅 info', (() => { const f = agent(healthyFiles({ modes: { default: 'full', current: 'roleplay', modes: {} } })).findings; return has(f, 'modes-legacy-current') && f.find((x) => x.code === 'modes-legacy-current').level === 'info'; })());
check('功能名拼错 → mode-feature-unknown（error）', has(agent(healthyFiles({ modes: { default: 'full', modes: { typo: { features: ['websearch'] } } } })).findings, 'mode-feature-unknown'));
check("功能名 '*' 不告警", !has(agent(healthyFiles({ modes: { default: 'full', modes: { all: { features: ['*'] } } } })).findings, 'mode-feature-unknown'));
check('只注册命令的功能名（mode/intervention）不该被误判', !has(agent(healthyFiles({ modes: { default: 'full', modes: { lean: { features: ['mode', 'intervention'] } } } })).findings, 'mode-feature-unknown'));
check('人设文件缺失 → mode-persona-missing（error）', has(agent(healthyFiles({ persona: null })).findings, 'mode-persona-missing'));
check('人设文件存在 → 不告警', !has(agent(healthyFiles()).findings, 'mode-persona-missing'));
check('modes-sessions.json 损坏 → sessions-corrupt（warning）', (() => { const f = agent(healthyFiles({ sessions: '{bad' })).findings; return has(f, 'sessions-corrupt') && f.find((x) => x.code === 'sessions-corrupt').level === 'warning'; })());
check('会话记录的模式已不存在 → session-mode-unknown（warning）', has(agent(healthyFiles({ sessions: { '/tmp/x.jsonl': { mode: 'gone', updatedAt: new Date(NOW).toISOString() } } })).findings, 'session-mode-unknown'));
check('会话文件不存在（新记录）→ session-file-missing（warning）', has(agent(healthyFiles({ sessions: { '/tmp/gone.jsonl': { mode: 'roleplay', updatedAt: new Date(NOW - 60_000).toISOString() } } })).findings, 'session-file-missing'));
check('会话文件不存在且超保留期 → 只提示孤儿', (() => { const f = agent(healthyFiles({ sessions: { '/tmp/old.jsonl': { mode: 'roleplay', updatedAt: new Date(NOW - 30 * 24 * 3600_000).toISOString() } } })).findings; return has(f, 'session-record-orphan') && !has(f, 'session-file-missing'); })());
check('防环标记损坏 → guard-unreadable（warning）', has(agent(healthyFiles({ guard: '{bad' })).findings, 'guard-unreadable'));
check('防环标记时间戳在未来 → guard-clock-skew（warning）', has(agent(healthyFiles({ guard: { key: 'k', ts: NOW + 600_000 } })).findings, 'guard-clock-skew'));
check('刚触发过自愈 → 仅 info', (() => { const f = agent(healthyFiles({ guard: { key: 'k', ts: NOW - 10_000 } })).findings; return has(f, 'guard-recent') && f.find((x) => x.code === 'guard-recent').level === 'info'; })());
check('窗口外的防环标记不产生 finding', (() => { const f = agent(healthyFiles({ guard: { key: 'k', ts: NOW - RESTART_GUARD_MS - 1000 } })).findings; return !has(f, 'guard-recent'); })());
check('过期未执行的重启请求 → restart-request-stale（warning）', has(agent(healthyFiles({ admin: { action: 'restart', timestamp: NOW - ADMIN_STATE_FRESH_MS - 1000, restartLog: null } })).findings, 'restart-request-stale'));
check('窗口内的重启请求不告警', !has(agent(healthyFiles({ admin: { action: 'restart', timestamp: NOW - 1000, restartLog: null } })).findings, 'restart-request-stale'));
check('无时间戳的重启请求 → restart-request-undated（warning）', has(agent(healthyFiles({ admin: { action: 'restart', timestamp: 0, restartLog: null } })).findings, 'restart-request-undated'));
check('重启通知超期未消费 → notice-undelivered（warning）', has(agent(healthyFiles({ admin: { action: 'none', timestamp: 0, restartLog: { action: 'restart', notice: 'mode', timestamp: NOW - MODE_NOTICE_TTL_MS - 1000 } } })).findings, 'notice-undelivered'));
check('新鲜的重启通知不告警（重启后未消费是正常中间态）', !has(agent(healthyFiles({ admin: { action: 'none', timestamp: 0, restartLog: { action: 'restart', notice: 'mode', timestamp: NOW - 5000 } } })).findings, 'notice-undelivered'));
check('state.json 损坏 → admin-state-unreadable（warning）', has(agent(healthyFiles({ admin: '{bad' })).findings, 'admin-state-unreadable'));
check('env 硬覆盖 → env-hard-override（warning）', (() => { const { dir } = agent(healthyFiles()); return has(findingsOf(dir, { env: { PI_AGENT_MODE: 'roleplay' } }), 'env-hard-override'); })());
check('env 回写值（SOURCE=file）不算硬覆盖', (() => { const { dir } = agent(healthyFiles()); return !has(findingsOf(dir, { env: { PI_AGENT_MODE: 'roleplay', PI_AGENT_MODE_SOURCE: 'file' } }), 'env-hard-override'); })());
check('遗留 modes-state.json → 仅 info', (() => { const f = agent(healthyFiles({ legacyState: { current: 'full' } })).findings; return has(f, 'legacy-state-file') && f.find((x) => x.code === 'legacy-state-file').level === 'info'; })());
check('findings 按严重度排序（error 在前）', (() => { const f = agent({ modes: '{bad', legacyState: { current: 'x' } }).findings; return f.length >= 2 && f[0].level === 'error'; })());

console.log('状态体检：只读性 + 真值不漂移');
{
  const d = makeAgent(healthyFiles());
  dirs.push(d);
  const before = readdirSync(d, { recursive: true }).sort().join('|') + readFileSync(join(d, 'modes.json'), 'utf-8').length;
  findingsOf(d, { env: { PI_AGENT_MODE: 'roleplay' } });
  const after = readdirSync(d, { recursive: true }).sort().join('|') + readFileSync(join(d, 'modes.json'), 'utf-8').length;
  check('体检不写任何文件（含 env 告警路径）', before === after);
}

const modeLogic = readFileSync(join(ROOT, 'custom/features/mode/logic.ts'), 'utf-8');
const libMode = readFileSync(join(ROOT, 'scripts/lib-mode.sh'), 'utf-8');
const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/registration-baseline.json'), 'utf-8'));
const baselineFeatures = [...new Set([...Object.keys(baseline.tools ?? {}), ...Object.keys(baseline.commands ?? {}), ...Object.keys(baseline.shortcuts ?? {})])].sort();
const allFeaturesBlock = modeLogic.match(/export const ALL_FEATURES = \[([\s\S]*?)\] as const;/);
const allFeatures = allFeaturesBlock ? [...allFeaturesBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort() : [];
const fixedBlock = modeLogic.match(/export const FIXED_MODES: Record<string, ModeConfig> = \{([\s\S]*?)\n\};/);
const logicFixed = fixedBlock ? [...fixedBlock[1].matchAll(/^ {2}([a-zA-Z][\w-]*): \{/gm)].map((m) => m[1]).sort() : [];
const shFixed = (libMode.match(/const FIXED=\[([^\]]*)\]/)?.[1] ?? '').match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, '')).sort() ?? [];

check('FIXED_MODES ↔ custom/features/mode/logic.ts', JSON.stringify([...FIXED_MODES].sort()) === JSON.stringify(logicFixed), `audit=${FIXED_MODES} logic=${logicFixed}`);
check('FIXED_MODES ↔ scripts/lib-mode.sh', JSON.stringify([...FIXED_MODES].sort()) === JSON.stringify(shFixed), `audit=${FIXED_MODES} sh=${shFixed}`);
check('功能名真值 ↔ mode/logic.ts 的 ALL_FEATURES', JSON.stringify(baselineFeatures) === JSON.stringify(allFeatures) && allFeatures.length > 0, `baseline=${baselineFeatures.length} logic=${allFeatures.length}`);
check('功能名真值里包含只注册命令的 mode/intervention', baselineFeatures.includes('mode') && baselineFeatures.includes('intervention'), baselineFeatures.join(','));

console.log('状态体检：CLI 退出码与输出');
{
  const clean = makeAgent(healthyFiles());
  const dirty = makeAgent({ modes: '{bad' });
  dirs.push(clean, dirty);
  const run = (dir, args = []) => spawnSync('node', [CLI, ...args], { encoding: 'utf-8', env: { ...process.env, PI_CODING_AGENT_DIR: dir } });
  // guard 的时间戳在用例里是"未来"，真实 now 下不一定触发；用 stale 请求造一个稳定的 warning
  const warnDir = makeAgent(healthyFiles({ admin: { action: 'restart', timestamp: Date.now() - ADMIN_STATE_FRESH_MS - 60_000, restartLog: null } }));
  dirs.push(warnDir);
  const ok = run(clean);
  const bad = run(dirty);
  const strict = run(warnDir, ['--strict']);
  const json = run(dirty, ['--json']);
  const quiet = run(dirty, ['--quiet']);
  check('干净状态 → exit 0', ok.status === 0, `${ok.status} ${ok.stdout}`);
  check('error 状态 → exit 1 且标明异常项', bad.status === 1 && /异常项=modes-corrupt/.test(bad.stdout), bad.stdout);
  check('--strict：warning 也算失败', strict.status === 1 && /restart-request-stale/.test(strict.stdout), strict.stdout);
  check('--quiet：只输出一行汇总', quiet.stdout.trim().split('\n').length === 1, quiet.stdout);
  let parsed = null;
  try {
    parsed = JSON.parse(json.stdout);
  } catch {
    /* 下面断言会报错 */
  }
  check('--json：可解析且带 findings', Boolean(parsed) && Array.isArray(parsed.findings) && parsed.findings.some((f) => f.code === 'modes-corrupt'), json.stdout.slice(0, 120));
  check('CLI 读 PI_CODING_AGENT_DIR 而不是仓库默认目录', bad.stdout.includes('my-pi-state-'), bad.stdout.slice(0, 120));
}

for (const d of dirs) rmSync(d, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.log(`❌ 状态体检守门失败：${failed}/${results.length} 项`);
  process.exit(1);
}
console.log(`🎉 状态体检守门通过（${results.length} 项）`);
