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
 *   3. 等 round-1 记录 decision=restart，并等 round-2 的 pi 进程真的起来（看 `ps`，
 *      **不是**盲发输入——实测盲发 `/quit` 会排队成一条用户消息、反而触发一个回合，
 *      把"零回合"这条断言污染掉）；
 *   4. 发一次 `/quit`（必要时重试/SIGTERM）收尾。
 * 断言（全部来自真实落盘产物，不看单测）：
 *   - round-1 是 full（persona=false / ns 空），decision=restart，**lostRestart=false**；
 *   - round-2 是 roleplay：mode=roleplay、namespace=roleplay、persona=true（=真的换了档，
 *     这正是旧 bug 里"模式没换"的反面）；
 *   - **会话文件里没有新增任何 user/assistant 消息** = 切模式**不再白跑一个模型回合**
 *     （2026-10-06 起通知走 deliverAs:'nextTurn' 的零成本通道：不触发回合、不写会话文件）；
 *   - `modes-sessions.json` 把该会话记成 roleplay；全程没有 lostRestart。
 *
 * 因为不再需要模型回合，本场景**不依赖 provider/网络**（确定性），只依赖 pty 与已构建的 dist。
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
/** round-2 的 pi 进程（argv 里同时有 --extension 与 --session <SESS>；supervisor 只有后者） */
function findPiProcess() {
  try {
    const out = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout || '';
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const [, pid, args] = m;
      if (args.includes('--extension') && args.includes(SESS) && !args.includes('pi-supervisor.sh')) {
        let env = '';
        try {
          env = readFileSync(`/proc/${pid}/environ`, 'utf8');
        } catch {
          /* 进程刚退出 / 无权限：env 为空，断言会说明 */
        }
        return { pid, args, env };
      }
    }
    return null;
  } catch {
    return null;
  }
}

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

  // 就绪判定必须**两件事都成立**再看输入：① round-2 的 pi 进程在 ps 里；② TUI 已画出首帧。
  // 实测教训：在 TUI 就绪前往 pty 里写 `/quit`，多行会被合并成一条用户消息提交 —— 既触发了
  // 一个回合（污染"切模式零回合"的断言），又因为文本不是精确的 `/quit` 而退不出去。
  const proc = await waitFor(() => findPiProcess(), { timeout: 150_000, label: 'round-2 pi 进程' })
    ? findPiProcess()
    : null;
  check('round-2 的 pi 进程真的起来了（ps 观测）', Boolean(proc), '未在 ps 里看到带 --extension 的 pi 进程');
  const restartMark = output.length; // 此刻之后的新输出都属于 round-2
  const tuiReady = await waitFor(() => output.slice(restartMark).includes('π - my-pi') || output.slice(restartMark).includes('~/my-pi'), {
    timeout: 150_000,
    label: 'round-2 TUI 首帧',
    quiet: false,
  });
  check('round-2 的 TUI 画出首帧（可以安全输入）', tuiReady);

  // 直接观测新进程的档位：argv 里应带 roleplay 人设，env 里应有记忆命名空间
  check('round-2 进程 argv 带 roleplay 人设（--append-system-prompt）', Boolean(proc?.args.includes('roleplay.md')), proc?.args);
  check('round-2 进程 env 里 PI_MEMORY_NAMESPACE=roleplay', Boolean(proc?.env.includes('PI_MEMORY_NAMESPACE=roleplay')), proc?.env?.slice(0, 200));

  const send = (text) => {
    try {
      if (child.stdin.writable) child.stdin.write(text);
    } catch {
      /* pty 已关 */
    }
  };
  const readRoles = () =>
    sessionText()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return {};
        }
      })
      .map((e) => (e?.type === 'message' ? e.message?.role : e?.type));

  // ① 切模式**零回合**：此刻 round-2 还活着，会话文件里不该有 user/assistant/custom_message。
  // （旧行为无条件 sendUserMessage，会在这里留下 user(通知) + assistant 回复。）
  const rolesAfterSwitch = readRoles();
  check('切模式不触发模型回合：没有 assistant 消息', !rolesAfterSwitch.includes('assistant'), JSON.stringify(rolesAfterSwitch));
  check('切模式不触发模型回合：也没有新增 user 消息', !rolesAfterSwitch.includes('user'), JSON.stringify(rolesAfterSwitch));
  check('零成本通道：模式通知不落盘（无 custom_message）', !rolesAfterSwitch.includes('custom_message'), JSON.stringify(rolesAfterSwitch));
  check('会话文件只含允许的条目类型', rolesAfterSwitch.every((r) => ['session', 'model_change', 'thinking_level_change'].includes(r)), JSON.stringify(rolesAfterSwitch));

  // ② 续跑通道（端到端）：写一条 intent=continue 的重启请求（语义等价于看门狗/自动 failover
  //    ——"工作在途被中断"），再 /quit 让 supervisor 重拉；新进程应当**真的起一个回合**接上。
  //    这条通道此前只有单测/接线测试覆盖，这里证明它在真实生命周期里也成立。
  const restartsBefore = rows().filter((r) => r.decision === 'restart').length;
  const pendingReason = '场景：模拟被中断的任务';
  mkdirSync(join(AGENT, 'autopilot'), { recursive: true });
  writeFileSync(
    join(AGENT, 'autopilot', 'state.json'),
    JSON.stringify({
      action: 'restart',
      timestamp: Date.now(),
      targetSession: SESS,
      reason: pendingReason,
      intent: 'continue',
      restartLog: { action: 'restart', reason: pendingReason, intent: 'continue', targetSession: SESS, timestamp: Date.now() },
    }),
  );
  send('/quit\r');
  const restartedAgain = await waitFor(() => rows().filter((r) => r.decision === 'restart').length > restartsBefore, {
    timeout: 120_000,
    label: '第二次 restart',
  });
  check('intent=continue 的重启请求被真的执行（第二次重拉）', restartedAgain, JSON.stringify(rows()));
  const resumeInjected = await waitFor(() => sessionText().includes('my-pi-restart-resume'), { timeout: 180_000, label: '续跑回合注入', quiet: false });
  check('续跑通道：新进程真的起了回合（会话里出现 my-pi-restart-resume）', resumeInjected, sessionText().slice(-400));
  check('续跑指令写明"没有下一步就停下、不要凭空开工"', sessionText().includes('不要凭空开工'));

  // 收尾：round-3 可能正在流式回复；/quit → Ctrl+C → Ctrl+D → SIGTERM
  send('/quit\r');
  if (!(await waitFor(() => rows().some((r) => r.decision === 'exit'), { timeout: 60_000 }))) {
    send('\u0003');
    if (!(await waitFor(() => rows().some((r) => r.decision === 'exit'), { timeout: 30_000 }))) {
      send('\u0004');
      if (!(await waitFor(() => rows().some((r) => r.decision === 'exit'), { timeout: 30_000 }))) {
        child.kill('SIGTERM');
        await waitFor(() => rows().some((r) => r.decision === 'exit'), { timeout: 60_000, label: 'SIGTERM 后退出', quiet: false });
      }
    }
  }

  // ③ 轮次记录：三行，档位与续接都对
  const roundRows = rows();
  const r1 = roundRows.find((r) => r.decision === 'restart' && r.mode === 'full');
  const r2 = roundRows.find((r) => r.decision === 'restart' && r.mode === 'roleplay');
  const r3 = roundRows.find((r) => r.decision === 'exit');
  check('至少三轮（切模式重拉 + 续跑重拉 + 退出）', roundRows.length >= 3, JSON.stringify(roundRows.map((r) => r.decision)));
  check('round-1 跑在 full（人设/命名空间未注入）', Boolean(r1) && r1.persona === false && r1.namespace === '', JSON.stringify(r1));
  check('round-2 跑在 roleplay（真的换档了）', Boolean(r2) && r2.persona === true, JSON.stringify(r2));
  check('round-2 记忆命名空间=roleplay', Boolean(r2) && r2.namespace === 'roleplay', JSON.stringify(r2));
  check('round-2/3 以会话精确续接（--session 同一路径）', Boolean(r2) && r2.session === SESS && Boolean(r3) && r3.session === SESS, `${r2?.session} / ${r3?.session}`);
  check('最终退出的一轮仍在 roleplay（续跑没把档位带回 full）', Boolean(r3) && r3.mode === 'roleplay', JSON.stringify(r3));
  check('全程没有"重启请求被吞"', roundRows.every((r) => r.lostRestart === false), JSON.stringify(roundRows.filter((r) => r.lostRestart)));

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
console.log(`🎉 模式切换场景通过（${results.length} 项）：真实 pty 下 /mode 切档确实重启并换档，且不触发多余回合`);
