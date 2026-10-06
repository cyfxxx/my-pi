#!/usr/bin/env node
/**
 * test-scenario-mode-restart.mjs — 真实生命周期场景：模式切换必须"真的重启并换档"
 *
 * 为什么必须有这一层：`tsc`/`vitest`/golden 都判不出"使用层面"的错误。2026-10-06 的真实故障
 * （用户在角色扮演会话里 `/new` 正常、从新会话切回角色扮演会话却**直接退出**）在当时的全部门禁
 * 下都是绿的——因为它是"跨进程 + 跨功能 + 只有 full 模式才复现"的时序问题：mode 自愈写重启请求、
 * autopilot 消费通知时把 action 清掉、supervisor 读不到动作就退出，模式也没换。
 *
 * 本场景用**真 pty + 真 supervisor + 真 pi + 真 bootstrap 扩展**跑一遍那条用户路径：
 *   1. 在隔离的 agent/memory 目录里以 full 启动，`--session <新会话文件>`；
 *   2. 在 TUI 里输入 `/mode roleplay`（人设 + 记忆命名空间 + 功能集都要换档）；
 *   3. 等 round-1 记录 decision=restart、并等**新模式进程**把 `[模式] 已切换：full → roleplay`
 *      注入会话文件；
 *   4. `/quit` 收尾。
 * 断言（全部来自真实落盘产物，不看单测）：
 *   - round-1 是 full（persona=false / ns 空），decision=restart，**lostRestart=false**；
 *   - round-2 是 roleplay：mode=roleplay、namespace=roleplay、persona=true（=真的换了档，
 *     这正是旧 bug 里"模式没换"的反面）；
 *   - 会话文件里有适配模式的通知（含"不要向用户复述"，且不泄露会话路径/内部措辞）；
 *   - `modes-sessions.json` 把该会话记成 roleplay；全程没有 lostRestart。
 *
 * 用法：
 *   node scripts/test-scenario-mode-restart.mjs                 # 约 3 分钟（两轮真实启动）
 *   PI_SCENARIO_SKIP=1 node ...                                # 显式跳过（离线/无 pty 时）
 *   PI_SCENARIO_TIMEOUT_MS=600000 node ...                     # 放宽等待（慢机器）
 * 缺 util-linux 的 script/stty、或 vendor/pi dist 未构建时**显式跳过**（exit 0），与
 * test-web-terminal.mjs 的处理一致。
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'vendor/pi/packages/coding-agent/dist/cli.js');
const TIMEOUT_MS = Number(process.env.PI_SCENARIO_TIMEOUT_MS || 300_000);
process.stdout.write('模式切换场景启动（真 pty + 真 supervisor + 真 pi）\n');
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

function skip(reason) {
  console.log(`SKIP 模式切换场景：${reason}`);
  process.exit(0);
}

if (process.env.PI_SCENARIO_SKIP === '1') skip('PI_SCENARIO_SKIP=1');
if (!existsSync(CLI)) skip(`未构建 vendor/pi dist（先 bash scripts/build.sh）：${CLI}`);
if (!spawnSync('script', ['--version'], { stdio: 'ignore' }).status && spawnSync('script', ['--version'], { encoding: 'utf8' }).error) {
  skip('缺少 util-linux 的 script（无法分配 pty）');
}
if (spawnSync('sh', ['-c', 'command -v stty'], { encoding: 'utf8' }).status !== 0) skip('缺少 stty');

// ── 隔离环境：agent 目录（配置 + 人设 + 会话）与 memory 目录都在临时目录里 ──
const T = mkdtempSync(join(tmpdir(), 'my-pi-scenario-'));
const AGENT = join(T, 'agent');
const MEM = join(T, 'memory');
const SESS_DIR = join(AGENT, 'sessions', '--root-my-pi--');
const SESS = join(SESS_DIR, 'scenario.jsonl');
const ROUNDS = join(AGENT, 'recovery', 'rounds.jsonl');
mkdirSync(SESS_DIR, { recursive: true });
mkdirSync(join(AGENT, 'modes'), { recursive: true });
mkdirSync(MEM, { recursive: true });
for (const f of ['settings.json', 'models.json', 'models-store.json', 'auth.json', 'keybindings.json', 'trust.json', 'modes.json', 'APPEND_SYSTEM.md', 'AGENTS.md']) {
  const src = join(ROOT, 'portable/agent', f);
  if (existsSync(src)) copyFileSync(src, join(AGENT, f));
}
const persona = join(ROOT, 'portable/agent/modes/roleplay.md');
if (existsSync(persona)) copyFileSync(persona, join(AGENT, 'modes/roleplay.md'));
// 预置一个最小会话头（pi 以 --session 载入它 = 续接）
writeFileSync(SESS, JSON.stringify({ type: 'session', version: 3, id: '01a1ffff-0000-7000-9000-000000000001', timestamp: new Date().toISOString(), cwd: ROOT }) + '\n');

const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: AGENT,
  MY_PI_AGENT_DIR: AGENT,
  PI_MEMORY_DIR: MEM,
  TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm-256color',
};
// 场景里不允许有任何"外部硬覆盖"，否则按会话解析会被跳过
delete env.PI_AGENT_MODE;
delete env.PI_AGENT_MODE_SOURCE;
delete env.PI_SESSION_MODE;
delete env.PI_SCENARIO_SKIP;

const shellCmd = `exec bash ${JSON.stringify(join(ROOT, 'scripts/pi-supervisor.sh'))} --session ${JSON.stringify(SESS)}`;
const child = spawn('script', ['-q', '-e', '-f', '-E', 'never', '-c', shellCmd, '/dev/null'], {
  cwd: ROOT,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d) => (output += d.toString('utf8')));
child.stderr.on('data', (d) => (output += d.toString('utf8')));
let exited = false;
child.on('exit', () => (exited = true));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = () => {
  try {
    return readFileSync(ROUNDS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const sessionText = () => {
  try {
    return readFileSync(SESS, 'utf8');
  } catch {
    return '';
  }
};

/** 等到 cond() 为真；超时返回 false（quiet=false 时打印超时原因，供最后定位） */
async function waitFor(cond, { timeout = TIMEOUT_MS, poll = 500, label = '', quiet = true } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (cond()) return true;
    await sleep(poll);
  }
  if (!quiet) console.log(`  （等待超时：${label}，已等 ${Math.round((Date.now() - t0) / 1000)}s）`);
  return false;
}

try {
  console.log(`场景：真实 pty + supervisor + pi（隔离目录 ${T}）`);
  // 就绪判定不靠"输出稳定"（TUI 会周期性重绘/刷新，实测会一直不安静），而是**重试到有效果**：
  // 只要 pty 有输出就发 /mode，每 10s 再试，直到 rounds.jsonl 出现 restart。真实的 pi 会把它
  // 当普通输入排队；切换成功后重复的 /mode roleplay 是无副作用的空操作（同模式不重启）。
  const booted = await waitFor(() => output.length > 0, { label: 'pty 有输出' });
  check('TUI 在 pty 里启动并产生输出', booted, `${output.length} 字节`);
  let attempts = 0;
  let restarted = false;
  const modeDeadline = Date.now() + TIMEOUT_MS;
  while (!restarted && Date.now() < modeDeadline) {
    child.stdin.write('/mode roleplay\r');
    attempts++;
    restarted = await waitFor(() => rows().some((r) => r.decision === 'restart'), { timeout: 10_000, label: 'restart' });
  }
  check('发送 /mode roleplay 后进程被真的重拉（decision=restart）', restarted, `尝试 ${attempts} 次；${JSON.stringify(rows())}`);

  const noticeInjected = await waitFor(() => sessionText().includes('已切换：full → roleplay'), { label: '新模式进程注入切换通知', quiet: false });
  check('新模式进程把切换通知注入了会话文件', noticeInjected, sessionText().slice(-400));

  // 收尾：先请它自己退（/quit），不行就 SIGTERM（pi 的优雅关闭路径，仍会留下 exit 轮次记录）
  child.stdin.write('/quit\r');
  if (!(await waitFor(() => rows().some((r) => r.decision === 'exit'), { timeout: 60_000 }))) {
    child.kill('SIGTERM');
    await waitFor(() => rows().some((r) => r.decision === 'exit'), { timeout: 60_000, label: 'SIGTERM 后退出', quiet: false });
  }

  const roundRows = rows();
  const r1 = roundRows.find((r) => r.decision === 'restart');
  const r2 = roundRows.find((r) => r.decision === 'exit');
  check('至少两轮（进程真的被重拉，而不是直接退出）', roundRows.length >= 2, JSON.stringify(roundRows.map((r) => r.decision)));
  check('round-1 跑在 full（人设/命名空间未注入）', Boolean(r1) && r1.mode === 'full' && r1.persona === false && r1.namespace === '', JSON.stringify(r1));
  check('round-2 跑在 roleplay（真的换档了）', Boolean(r2) && r2.mode === 'roleplay', JSON.stringify(r2));
  check('round-2 注入了人设', Boolean(r2) && r2.persona === true, JSON.stringify(r2));
  check('round-2 记忆命名空间=roleplay', Boolean(r2) && r2.namespace === 'roleplay', JSON.stringify(r2));
  check('全程没有"重启请求被吞"', roundRows.every((r) => r.lostRestart === false), JSON.stringify(roundRows.filter((r) => r.lostRestart)));
  check('round-2 以会话精确续接（--session 同一路径）', Boolean(r2) && r2.session === SESS, `${r2?.session}`);

  const text = sessionText();
  check('通知写明"已切换：full → roleplay"', text.includes('已切换：full → roleplay'));
  check('通知要求不要复述（人设模式不破戏）', text.includes('不要向用户复述本条提示'));
  check('通知不泄露会话路径', !text.includes(SESS));
  check('通知不带内部措辞（进程原为 / 自愈）', !text.includes('进程原为') && !text.includes('自愈'));
  check('通知说明新模式的记忆命名空间', text.includes('记忆命名空间 roleplay'));

  let sessions = {};
  try {
    sessions = JSON.parse(readFileSync(join(AGENT, 'modes-sessions.json'), 'utf8'));
  } catch {
    /* 断言会报错 */
  }
  check('会话记录落到 modes-sessions.json（roleplay）', sessions[SESS]?.mode === 'roleplay', JSON.stringify(sessions));
  check('原会话文件仍是同一路径（未被新建替身顶掉）', existsSync(SESS));
} finally {
  try {
    child.kill('SIGKILL');
  } catch {
    /* 已退出 */
  }
  if (!process.env.PI_SCENARIO_KEEP) rmSync(T, { recursive: true, force: true });
  else console.log(`保留现场：${T}`);
}

console.log('');
if (failed > 0) {
  console.log(`❌ 模式切换场景失败：${failed}/${results.length} 项`);
  console.log('  排查入口：portable/agent/recovery/rounds.jsonl（本场景为临时目录，用 PI_SCENARIO_KEEP=1 重跑保留现场）');
  process.exit(1);
}
console.log(`🎉 模式切换场景通过（${results.length} 项）：真实 pty 下 /mode 切档确实重启并换档，通知适配模式`);
