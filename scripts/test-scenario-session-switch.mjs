#!/usr/bin/env node
/**
 * test-scenario-session-switch.mjs — 真实生命周期场景：`/new` 不再中止"在跑的那一轮"
 *
 * 为什么需要这一层（而不是靠单测）：用户实测的问题是"TUI 里创建新会话/切换会话，正在跑的那一轮
 * 被打断"。单测只能证明"我们的钩子在忙碌时没有立刻放行"，证明不了**pi 那边确实因此没有 abort**、
 * **那一轮的回复真的落了盘**、**切换最后还是自己完成了**、以及**等待期间 Esc 仍然能中断**。
 * 这几件事都是跨进程/跨事件的时序事实，只有真 pty + 真 supervisor + 真 pi + 真扩展能判定。
 *
 * 机制（证据链，代码级）：`/new` 走 `AgentSessionRuntime.newSession()` → `emitBeforeSwitch('new')`
 * → 扩展事件 `session_before_switch`（**可 cancel**）→ `teardownCurrent()` → `session.abort()`。
 * 守卫挂在中间那个事件上：忙碌时**等到回合结束再放行**，于是 pi 的 abort 打不到任何东西，切换
 * 仍然由 pi 自己完成（`vendor/pi/.../core/agent-session-runtime.ts:133-177`）。
 *
 * 断言（全部来自真实落盘产物与真实 pane，不看单测）：
 *   A. 请求在飞时发 `/new` ⇒ pane **没有** `Operation aborted`、出现延后说明、此刻还没换会话；
 *   B. 回合自然跑完 ⇒ 回复落进**旧会话文件**（工作没丢）、末条不是被中断留下的空 assistant 记录；
 *   C. 回合结束后 pi **自己完成切换**（pane 出现 `New session started`），且新会话真能用（另建文件 + 收到回复）；
 *   D. 全程 **PID 不变**（进程内替换，不是重启）；
 *   E. 逃生口真实可用：再挂一次请求 → 发 `/new`（被延后）→ **Esc** ⇒ 这一轮被中断，且切换仍然完成。
 *
 * 场景自带本地假 provider（scripts/lib-fake-provider.mjs）：用 `delayMs` 制造"回合在飞"的确定窗口，
 * 用 `hangNext` 制造"永远不会回"的窗口来测 Escape。**不依赖网络、真实 provider 或模型抖动。**
 *
 * ★ 实测教训（2026-10-14，写场景时踩到）：pi 的 TUI 是**全屏重绘**的，pty 流里会反复出现整屏
 * 重画 —— 连"换会话之前就已经打印过"的旧文本也会**再次出现**在 `mark` 之后。于是
 * `pty.output.slice(mark)` 里"**没有**某段文本"这类断言**会被重绘污染成假失败**（本次实测：
 * E2b 与 E4 同时中招 —— E4 因为重绘命中旧文本而立刻返回，E3b 便在中断落盘之前就查了盘）。
 * 因此本场景的**决定性断言全部落在"盘上产物"与"provider 侧事实"**上（会话文件内容、文件是否
 * 新建、请求是否被回应、PID 是否不变），pane 文案只用于"用户是否看见了提示"这类单向断言。
 *
 * 用法：
 *   node scripts/test-scenario-session-switch.mjs            # 约 2–4 分钟（一次真实冷启动）
 *   PI_SCENARIO_SKIP=1 node ...                              # 显式跳过（离线/无 pty）
 *   PI_SCENARIO_KEEP=1 node ...                              # 保留现场
 *   PI_SCENARIO_TIMEOUT_MS=600000 node ...                   # 放宽等待（慢机器）
 * 缺 util-linux 的 script/stty、或 vendor/pi dist 未构建时**显式跳过**（exit 0）。
 */
import { startFakeProvider } from './lib-fake-provider.mjs';
import {
  configureFakeProvider,
  findPiProcess,
  prepareAgentDir,
  ptyUnavailableReason,
  readJsonl,
  readText,
  sleep,
  startSupervisorPty,
  stopPi,
  waitFor,
  writeSessionHeader,
} from './lib-pty-harness.mjs';
import { readdirSync } from 'node:fs';
import { basename } from 'node:path';

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

/** pane 文本的归一化视图：去掉 ANSI 与所有空白。TUI 会在任意列换行，
 *  所以断言必须用"去掉空白后仍连续"的短 token（例如 `已延后`、`Operationaborted`）。 */
function flat(text) {
  return String(text)
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\s+/g, '');
}

const tuiReady = (pty) => flat(pty.output).includes('π-my-pi') || flat(pty.output).includes('~/my-pi');

function sessionFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
}

function lastMessageEntry(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.type === 'message') return entries[i];
  }
  return null;
}

function assistantText(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c?.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
}

const skipReason = ptyUnavailableReason();
if (process.env.PI_SCENARIO_SKIP === '1' || skipReason) {
  console.log(`SKIP 会话切换场景：${skipReason ?? 'PI_SCENARIO_SKIP=1'}`);
  process.exit(0);
}

console.log('会话切换场景启动（真 pty + 真 supervisor + 真 pi）');

// delayMs 制造"回合在飞"的确定窗口：请求已到 provider、回复要等一会儿才写回。
// 6s 是为了让 "+1.2s 观察点"（A2 无中止 / A3 有延后提示）也**必然**落在回合进行中——
// 否则回复可能先落地、切换自然完成，观察点就失去意义。代价是每个回复慢 6s（整场约多花 15s）。
const provider = await startFakeProvider({ replyText: 'SLOW-REPLY-OK', delayMs: 6000 });
const env = prepareAgentDir({ prefix: 'my-pi-switch-scenario-' });
let pty;

try {
  configureFakeProvider({ agentDir: env.agentDir, provider });
  const sessionFile = env.sessionFile('2026-10-14T00-00-00-000Z_switch-scenario.jsonl');
  writeSessionHeader(sessionFile, { id: 'switch-scenario-1' });

  pty = startSupervisorPty({ agentDir: env.agentDir, memoryDir: env.memoryDir, session: sessionFile });
  const booted = await waitFor(() => tuiReady(pty), { timeout: 180_000, label: 'TUI 启动' });
  check('TUI 在 pty 里启动', booted, `pane ${pty.output.length} 字节`);

  const piBefore = findPiProcess({ agentDir: env.agentDir, diagnose: !booted });
  check('找到本场景的 pi 进程', Boolean(piBefore?.pid), piBefore ? `pid=${piBefore.pid}` : '未找到');

  // 冷启动后的第一次输入不靠"输出稳定"判定就绪（TUI 会周期性重绘，实测一直不安静）：
  // **重试到有效果**——只要 provider 那边真的出现了请求就继续（与 mode-restart 场景同一手法）。
  const promptUntilRequest = async (text, beforeCount, { timeout = 180_000, perTry = 8_000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (provider.completions.length > beforeCount) return true;
      pty.send(`${text}\r`);
      const arrived = await waitFor(() => provider.completions.length > beforeCount, { timeout: perTry, poll: 400 });
      if (arrived) return true;
    }
    return false;
  };

  // ── A/B/C：正常路径 —— 回合在飞时 `/new`，必须等它跑完再切换 ──
  let mark = pty.mark();
  const firstRequest = await promptUntilRequest('ping-A', 0);
  check('A1 模型请求在飞（已到达 provider、尚未回应）', firstRequest && provider.completions.at(-1)?.respondedAt === undefined);

  mark = pty.mark();
  pty.send('/new\r');
  await sleep(1200); // 远小于 provider 的 2.5s 延迟：此刻这一轮必然还在跑
  const during = flat(pty.output.slice(mark));
  check('A2 没有被中止（pane 里没有 Operation aborted）', !during.includes('Operationaborted'), during.slice(-160));
  check('A3 用户看到"已延后"的说明', during.includes('已延后'));
  // 这里**不看**"pane 里还没有 `New session started`"（全屏重绘会让它假失败，见文件头教训）；
  // "切换确实等到了回合结束"由盘上事实判定：这一轮的回复必须落进**旧**会话文件（B1/B2/B3）。

  const replied = await waitFor(() => readText(sessionFile).includes('SLOW-REPLY-OK'), {
    timeout: 120_000,
    label: '旧会话落盘回复',
  });
  check('B1 在跑的那一轮跑完并落盘（工作没丢）', replied);

  const switched = await waitFor(() => flat(pty.output.slice(mark)).includes('Newsessionstarted'), {
    timeout: 120_000,
    label: '回合结束后自动完成切换',
  });
  // 注意：这条是**单向**的（重绘可能让它提前命中）⇒ 只当"用户看到了"的迹象；
  // "切换真的发生了"由下面的 C2（另建会话文件并且收到回复）判定。
  check('C1 回合结束后出现"New session started"字样（用户可见迹象）', switched);

  const oldEntries = readJsonl(sessionFile);
  const lastMsg = lastMessageEntry(oldEntries);
  check('B2 旧会话末尾是正常回复（不是被中断留下的空 assistant）', Boolean(lastMsg) && assistantText(lastMsg).includes('SLOW-REPLY-OK'));
  const emptyAssistant = oldEntries.some(
    (e) => e?.type === 'message' && e.message?.role === 'assistant' && Array.isArray(e.message.content) && e.message.content.length === 0,
  );
  check('B3 没有"空 content 的 assistant"中断签名', !emptyAssistant);

  // 新会话真的可用：发一条 → 另建会话文件并收到回复
  const filesBefore = sessionFiles(env.sessionsDir);
  pty.send('ping-new\r');
  const newFileAnswered = await waitFor(
    () => {
      const fresh = sessionFiles(env.sessionsDir).filter((f) => !filesBefore.includes(f));
      return fresh.some((f) => readText(env.sessionFile(f)).includes('SLOW-REPLY-OK'));
    },
    { timeout: 120_000, label: '新会话收到回复' },
  );
  const freshFiles = sessionFiles(env.sessionsDir).filter((f) => !filesBefore.includes(f));
  check(
    'C2 回合结束后 pi 自己完成了切换（盘上事实：另建会话文件并收到回复）',
    newFileAnswered,
    `新文件：${freshFiles.join(',') || '(无)'}`,
  );

  // ── D：进程内替换（不是重启） ──
  const piAfter = findPiProcess({ agentDir: env.agentDir });
  check('D1 全程 PID 不变（进程内替换，不是重启）', Boolean(piBefore?.pid) && piBefore.pid === piAfter?.pid, `${piBefore?.pid} → ${piAfter?.pid}`);

  // ── E：逃生口 —— 挂住的请求 + `/new` + Esc ──
  const completionsBeforeHang = provider.completions.length;
  // 单发有丢失风险（TUI 刚换完会话），所以"重试到有效果"：每轮重新武装 hangNext 再发一次。
  // 之所以安全：第一个请求被挂住期间，pi 不会为后续输入再发一个 provider 请求（会排队/steer），
  // 所以计数一旦 +1 就停，不会出现"第二个请求拿到正常回复"把回合提前结算掉。
  let hung = false;
  for (let attempt = 0; attempt < 3 && !hung; attempt++) {
    provider.hangNext(1);
    pty.send('ping-B\r');
    hung = await waitFor(() => provider.completions.length > completionsBeforeHang, { timeout: 10_000, poll: 400 });
  }
  mark = pty.mark();
  check('E1 第二个请求已挂住（模拟永远不回的回合）', hung);

  pty.send('/new\r');
  await sleep(1200);
  const duringB = flat(pty.output.slice(mark));
  check('E2 挂住时 `/new` 同样被延后（没有 abort）', !duringB.includes('Operationaborted') && duringB.includes('已延后'), duringB.slice(-160));
  // E3/E4 的**前提**："切换仍卡在等回合结束"。判据用 provider 侧事实（请求挂着未回应）而不是
  // 切片里"没有 New session started"——后者会被全屏重绘污染（见文件头教训）。
  const stillHung = provider.completions.at(-1)?.respondedAt === undefined;
  check('E2b 切换此前确实卡在"等这一轮结束"上（挂住的请求仍未回应）', stillHung);

  pty.send('\u001b'); // Esc = app.interrupt
  // Esc 的判定**不看 pane 文案**（实测 Esc 中断这条路径不会画出 `Operation aborted`），而看两件硬事实：
  //   ① 那个挂住的请求**从头到尾没被回应** ⇒ 回合不是"跑完"，只能是"被中断"；
  //   ② 会话里留下被中断的痕迹（pi 对 aborted 回合的落盘形态：stopReason=aborted 或空 content 的 assistant）。
  // 再加上 E2b（中断前没切）与 E4（中断后切了），才能把"是 Esc 放行的"这一定因闭合。
  const hangNeverAnswered = provider.completions.at(-1)?.respondedAt === undefined;
  check('E3a 挂住的请求始终未被回应（回合是被中断的，不是跑完的）', hangNeverAnswered);

  const switchedB = await waitFor(() => flat(pty.output.slice(mark)).includes('Newsessionstarted'), {
    timeout: 120_000,
    label: '中断后切换完成',
  });
  check('E4 Esc 之后仍按请求完成切换（中断 → 守卫放行 → pi 自己换会话）', switchedB);

  const isAbortRecord = (e) =>
    e?.type === 'message' &&
    e.message?.role === 'assistant' &&
    (e.message.stopReason === 'aborted' || (Array.isArray(e.message.content) && e.message.content.length === 0));
  const initialName = basename(sessionFile);
  const nonInitial = () => sessionFiles(env.sessionsDir).filter((f) => f !== initialName);
  // **等**它落盘（不是读一次）：pi 是在 teardown 时才把"被中断的回合"持久化到旧会话文件里，
  // 读太早会得到"没有痕迹"的假结论——这正是第一版 E3b 失败的原因（E4 因重绘提前命中）。
  const abortedRecord = await waitFor(() => nonInitial().some((f) => readJsonl(env.sessionFile(f)).some(isAbortRecord)), {
    timeout: 60_000,
    poll: 500,
    label: '被中断的回合落盘',
  });
  const abortShapes = nonInitial()
    .flatMap((f) => readJsonl(env.sessionFile(f)))
    .filter((e) => e?.type === 'message' && e.message?.role === 'assistant')
    .map((e) => `${e.message.stopReason ?? 'stop'}:${JSON.stringify(e.message.content)?.slice(0, 24)}`);
  check(
    'E3b 会话里留下被中断的痕迹（pi 的落盘形态：stopReason=aborted / 空 content）',
    abortedRecord,
    `非初始会话文件：${nonInitial().join(',') || '(无)'}；assistant 形态：${abortShapes.join(' | ') || '(无)'}`,
  );

  // E4：**盘上事实**证明"Esc 之后切换真的完成了"（不靠 pane 文案，重绘会让它提前命中）。
  // 在新会话里发一条 ⇒ 必须再冒出一个**第三个**会话文件并收到回复。
  const beforeThird = sessionFiles(env.sessionsDir);
  const thirdArrived = () => {
    const fresh = sessionFiles(env.sessionsDir).filter((f) => !beforeThird.includes(f));
    return fresh.some((f) => readText(env.sessionFile(f)).includes('SLOW-REPLY-OK'));
  };
  // 刚换完会话，第一次输入有丢失可能 ⇒ 重试到有效果（每轮 20s 窗口足够覆盖 6s 的假 provider 延迟）。
  let thirdAnswered = false;
  for (let attempt = 0; attempt < 3 && !thirdAnswered; attempt++) {
    pty.send('ping-C\r');
    thirdAnswered = await waitFor(thirdArrived, { timeout: 20_000, poll: 500 });
  }
  const thirdFiles = sessionFiles(env.sessionsDir).filter((f) => !beforeThird.includes(f));
  check(
    'E4 Esc 之后仍按请求完成切换（盘上事实：又冒出一个会话文件并收到回复）',
    thirdAnswered,
    `新文件：${thirdFiles.join(',') || '(无)'}`,
  );

  console.log('');
  console.log(`断言 ${results.length - failed}/${results.length} 通过`);
} finally {
  // 清理：先让 pi 走优雅退出（SIGTERM，见 harness 说明），再关 provider 与临时目录。
  try {
    await stopPi({ find: () => findPiProcess({ agentDir: env.agentDir }), done: () => !findPiProcess({ agentDir: env.agentDir }) });
  } catch {
    /* 已退出 */
  }
  try {
    pty?.kill('SIGKILL');
  } catch {
    /* 已退出 */
  }
  await provider.close();
  env.cleanup();
}

process.exit(failed === 0 ? 0 : 1);
