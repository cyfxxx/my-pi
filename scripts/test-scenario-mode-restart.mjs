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
 * 场景自带**本地假 provider**（scripts/lib-fake-provider.mjs）：模型请求变成确定性事实——
 * 切模式后 `completions.length === 0`（连请求都没有），续跑那次则能断言"请求体里确实带上了
 * 续跑指令"，并让固定回复落进会话文件。因此**不依赖网络与真实 provider、也不依赖模型抖动**。
 *
 * 用法：
 *   node scripts/test-scenario-mode-restart.mjs                 # 约 3 分钟（两轮真实启动）
 *   PI_SCENARIO_SKIP=1 node ...                                # 显式跳过（离线/无 pty 时）
 *   PI_SCENARIO_TIMEOUT_MS=600000 node ...                     # 放宽等待（慢机器）
 * 缺 util-linux 的 script/stty、或 vendor/pi dist 未构建时**显式跳过**（exit 0），与
 * test-web-terminal.mjs 的处理一致。
 */
import { spawn, spawnSync } from 'node:child_process';
import { startFakeProvider } from './lib-fake-provider.mjs';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
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
for (const f of ['settings.json', 'auth.json', 'keybindings.json', 'trust.json', 'modes.json', 'APPEND_SYSTEM.md', 'AGENTS.md']) {
  const src = join(ROOT, 'portable/agent', f);
  if (existsSync(src)) copyFileSync(src, join(AGENT, f));
}
const persona = join(ROOT, 'portable/agent/modes/roleplay.md');
if (existsSync(persona)) copyFileSync(persona, join(AGENT, 'modes/roleplay.md'));
// 假 provider：模型请求变成可断言的事实（切模式后应为 0 次；续跑那次应带上续跑指令）。
// 配置只覆盖 defaultProvider/defaultModel，其余 settings 原样继承（行为差异最小）。
const REPLY_TEXT = 'SCENARIO-REPLY-OK';
const provider = await startFakeProvider({ replyText: REPLY_TEXT });
const realModels = existsSync(join(ROOT, 'portable/agent/models.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'portable/agent/models.json'), 'utf8'))
  : { providers: {} };
writeFileSync(
  join(AGENT, 'models.json'),
  JSON.stringify({
    providers: {
      ...(realModels.providers ?? {}),
      scenario: {
        baseUrl: `http://127.0.0.1:${provider.port}/v1`,
        api: 'openai-completions',
        apiKey: 'scenario-not-needed',
        models: [
          {
            id: 'scenario-model',
            name: 'Scenario Model',
            contextWindow: 131072,
            maxTokens: 8192,
            reasoning: false,
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
          },
        ],
      },
    },
  }),
);
const settingsPath = join(AGENT, 'settings.json');
const realSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
writeFileSync(settingsPath, JSON.stringify({ ...realSettings, defaultProvider: 'scenario', defaultModel: 'scenario-model' }));

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
/** 找到本次场景的 pi 进程。**不能靠 argv**：pi 跑起来后会把 process.title 写成窗口标题
 *  （实测第一次回合之后 /proc/<pid>/cmdline 就只剩标题），所以按 **exe=node + 环境里带本场景
 *  的 agent 目录** 来认，再用 cmdline 排除 supervisor/健康检查。返回 {pid, args, env}。 */
function findPiProcess(diagnose = false) {
  let pids = [];
  try {
    pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return null;
  }
  const candidates = [];
  for (const pid of pids) {
    let exe = '';
    let args = '';
    let env = '';
    try {
      exe = readlinkSync(`/proc/${pid}/exe`);
    } catch {
      continue;
    }
    if (!/(^|\/)node$/.test(exe)) continue; // 只认 node 进程（排除 script/bash）
    try {
      args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
      env = readFileSync(`/proc/${pid}/environ`, 'utf8');
    } catch {
      continue;
    }
    if (!env.includes(`PI_CODING_AGENT_DIR=${AGENT}`)) continue; // 本场景专属的隔离目录
    candidates.push({ pid, args, env });
    if (args.includes('pi-supervisor.sh') || args.includes('--no-extensions')) continue; // supervisor / 健康检查
    return { pid, args, env };
  }
  if (diagnose) console.log(`  （pid 候选 ${candidates.length} 个：${candidates.map((c) => `${c.pid}:${c.args.slice(0, 80)}`).join(' | ')}）`);
  return null;
}

/** 请求体里最后一条"模型可见的输入"（custom/user）——用它断言"这次请求就是那次续跑"，
 *  避免被历史里上一次的续跑指令误判（phase 2 的指令会留在 history 里）。 */
function lastInputText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user' || m?.role === 'custom') {
      const c = m.content;
      return typeof c === 'string' ? c : JSON.stringify(c ?? '');
    }
  }
  return '';
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
  check('切模式没有产生任何模型请求（假 provider 计数=0，零回合的强证据）', provider.completions.length === 0, `completions=${provider.completions.length}`);

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
  const gotResumeRequest = await waitFor(() => provider.completions.length >= 1, { timeout: 60_000, label: '续跑回合的模型请求', quiet: false });
  check('续跑那次真的调用了模型（假 provider 收到请求）', gotResumeRequest, `completions=${provider.completions.length}`);
  const resumeInput = lastInputText(provider.completions.at(-1)?.body);
  check('续跑请求的最后一条输入就是续跑指令（模型真的收到了"接着做/别凭空开工"）', resumeInput.includes('不要凭空开工') && resumeInput.includes('系统已重启'), resumeInput.slice(0, 160));
  const gotReply = await waitFor(() => sessionText().includes(REPLY_TEXT), { timeout: 60_000, label: '假 provider 的回复落盘' });
  check('假 provider 的固定回复落进会话（回合真的跑完了）', gotReply, sessionText().slice(-300));
  check('整场只跑了这一个模型回合（切模式那次为 0）', provider.completions.length === 1, `completions=${provider.completions.length}`);

  // ③ `intent=auto`（**缺省**：没人声明意图）→ 由会话盘面尾部判。这里让一个回合**卡在模型调用里**
  //    再半途重启，模拟"任务被中断"，应当自动续跑。这条是崩溃恢复/admin_restart 的默认路径，
  //    也是本功能的原始意图，此前只有单测覆盖。
  const completionsBeforePhase3 = provider.completions.length;
  provider.hangNext(1); // 下一次模型请求挂住 = 回合进行中
  provider.setReply('SCENARIO-REPLY-PHASE3');
  send('请把刚才的结论再列一次\r'); // 真实输入 → 真的起一个回合（会卡在模型调用上）
  const stuckTurn = await waitFor(() => provider.completions.length > completionsBeforePhase3, { timeout: 60_000, label: '被中断的那次请求', quiet: false });
  check('构造出"回合进行中"（模型请求已发出并挂住）', stuckTurn, `completions=${provider.completions.length}`);
  const tailInFlight = await waitFor(() => {
    const r = readRoles();
    return r.lastIndexOf('user') > r.lastIndexOf('assistant');
  }, { timeout: 30_000, label: '盘面尾部=工作在途', quiet: false });
  check('盘面尾部是"工作在途"（最后一条 user 晚于最后一条 assistant）', tailInFlight, JSON.stringify(readRoles()));

  // 写一条**不带 intent** 的重启请求（= 生产者的缺省写法）→ 半途 SIGTERM → supervisor 重拉
  const restartsBeforePhase3 = rows().filter((r) => r.decision === 'restart').length;
  writeFileSync(
    join(AGENT, 'autopilot', 'state.json'),
    JSON.stringify({
      action: 'restart',
      timestamp: Date.now(),
      targetSession: SESS,
      reason: '场景：回合进行中被重启',
      restartLog: { action: 'restart', reason: '场景：回合进行中被重启', targetSession: SESS, timestamp: Date.now() },
    }),
  );
  const p3 = findPiProcess();
  if (!p3) findPiProcess(true); // 打候选诊断，避免下次还要猜
  check('找到正在跑的 pi 进程（准备半途杀掉）', Boolean(p3), `未找到 pi 进程；args=${p3?.args ?? '(none)'}`);
  if (p3) process.kill(Number(p3.pid), 'SIGTERM');
  const restartedByAuto = await waitFor(() => rows().filter((r) => r.decision === 'restart').length > restartsBeforePhase3, {
    timeout: 150_000,
    label: '缺省 intent 路径的重拉',
  });
  check('缺省 intent 的重启被真的执行（第三次重拉）', restartedByAuto, JSON.stringify(rows()));
  const autoResumed = await waitFor(() => provider.completions.length > completionsBeforePhase3 + 1, { timeout: 150_000, label: 'auto 续跑回合' });
  check('auto 路径：被中断的任务自动续跑（发出新的模型请求）', autoResumed, `completions=${provider.completions.length}`);
  const autoInput = lastInputText(provider.completions.at(-1)?.body);
  check('auto 续跑请求的最后一条输入就是续跑指令', autoInput.includes('不要凭空开工'), autoInput.slice(0, 200));
  const autoReply = await waitFor(() => sessionText().includes('SCENARIO-REPLY-PHASE3'), { timeout: 60_000, label: 'phase3 回复落盘' });
  check('auto 续跑回合真的跑完（固定回复落盘）', autoReply, sessionText().slice(-300));

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
  await provider.close().catch(() => {});
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
