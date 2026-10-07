#!/usr/bin/env node
/**
 * test-scenario-two-instances.mjs — 真实生命周期场景：**两个实例共享一个 agent 目录**的隔离
 *
 * 为什么必须有这一层：`test-supervisor.sh` 用 stub CLI 覆盖了多实例的 ownerPid 契约（认领/不认领
 * 两侧），`test-state-audit.mjs` 用假进程覆盖了"实例数可见"——但都是**假 pi**。真机上的形态有两个
 * 只有真链才能证明的关键差异：
 *   1. pi 启动后把 `process.title` 写成 `pi`，`/proc/<pid>/cmdline` 只剩 "pi"（不能用 argv 认实例）；
 *   2. 两个实例共享同一份 `state.json` / `modes-sessions.json` / `recovery/rounds.jsonl`，
 *      于是"A 写的重启请求会不会被 B 消费/执行"是**跨进程时序**问题，纯单测与 stub 都判不出来。
 *
 * 本场景在一个隔离 agent 目录里起两个 supervisor（A/B，各自一个真 pty，环境里带测试专用的
 * `PI_SCENARIO_INSTANCE=A|B` 标记沿 supervisor → pi 继承）+ 两个不同会话文件 + 同一个本地假 provider：
 *   ① A 以 full 启动并在 TUI 里 `/mode roleplay` → A 被真重拉、新进程 argv/env 是 roleplay；
 *   ② B 与 A 同时在跑、起于 full，**没有被 A 的重启带走**（pid 不变、rounds 无 B 的 restart、
 *      B 的会话里没有 A 的模式切换/续跑痕迹）；
 *   ③ 关键时序：B 的 session_start **晚于** A 的重启日志写入（B 先启动、约 10s 后 A 才写日志），
 *      于是 B 真的读到了那条日志——断言它**没有**消费（A 的新进程最后消费/清空它），
 *      这是 `custom/core/restart-intent.ts` 的 `logWrittenAfterStart` / `logTargetsOtherSession`
 *      两条归属判据在真链上的正面验证（2026-10-07 修）；
 *   ④ 两实例同时在跑时 `state-audit` 报告 `multiple-instances`（实例数 ≥2）；
 *   ⑤ 收尾：两个实例 SIGTERM 干净退出（rounds 各留一条 exit 记录），全程 lostRestart=false；
 *      共享目录下的 per-round crash log 也必须按实例分开（名字带 supervisor pid，否则同名覆盖）。
 *
 * 与单实例场景共用 `scripts/lib-pty-harness.mjs`（pty/进程发现/等待/JSONL/SIGTERM 收尾）。
 *
 * 用法：
 *   node scripts/test-scenario-two-instances.mjs               # 约 4 分钟（三轮真实启动）
 *   PI_SCENARIO_SKIP=1 node ...                                # 显式跳过（离线/无 pty 时）
 *   PI_SCENARIO_KEEP=1 node ...                                # 保留临时目录供排查
 *   PI_SCENARIO_TIMEOUT_MS=600000 node ...                     # 放宽等待（慢机器）
 * 缺 util-linux 的 script/stty、或 vendor/pi dist 未构建时**显式跳过**（exit 0）。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeProvider } from './lib-fake-provider.mjs';
import {
  REPO_ROOT,
  SCENARIO_TIMEOUT_MS,
  configureFakeProvider,
  findAllPiProcesses,
  findPiProcess,
  findSupervisorProcess,
  prepareAgentDir,
  ptyUnavailableReason,
  readJson,
  readJsonl,
  readText,
  sessionEntries,
  sessionRoles,
  sessionTexts,
  sleep,
  startSupervisorPty,
  stopPi,
  waitFor,
  writeSessionHeader,
} from './lib-pty-harness.mjs';

process.stdout.write('两实例隔离场景启动（真 pty ×2 + 真 supervisor ×2 + 真 pi ×2 + 共享 fake provider）\n');
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
  console.log(`SKIP 两实例隔离场景：${reason}`);
  process.exit(0);
}

if (process.env.PI_SCENARIO_SKIP === '1') skip('PI_SCENARIO_SKIP=1');
const unavailable = ptyUnavailableReason();
if (unavailable) skip(unavailable);

// ── 隔离环境：一个 agent 目录被两个实例共享（这正是多实例的真实形态）──
const scene = prepareAgentDir({ prefix: 'my-pi-two-inst-' });
const AGENT = scene.agentDir;
const MEM = scene.memoryDir;
const SESS_A = scene.sessionFile('instance-a.jsonl');
const SESS_B = scene.sessionFile('instance-b.jsonl');
const ROUNDS = scene.roundsFile;
const STATE = scene.stateFile;
writeSessionHeader(SESS_A, { id: '01a1ffff-0000-7000-9000-00000000000a' });
writeSessionHeader(SESS_B, { id: '01a1ffff-0000-7000-9000-00000000000b' });

const provider = await startFakeProvider({ replyText: 'TWO-INST-INIT', delayMs: 1500 });
configureFakeProvider({ agentDir: AGENT, provider });

// ── 实例身份：**不能靠 argv**（pi 会把 process.title 写成 pi），靠环境标记区分 A/B ──
const findA = () => findPiProcess({ agentDir: AGENT, envIncludes: ['PI_SCENARIO_INSTANCE=A'] });
const findB = () => findPiProcess({ agentDir: AGENT, envIncludes: ['PI_SCENARIO_INSTANCE=B'] });
const supA = () => findSupervisorProcess({ agentDir: AGENT, envIncludes: ['PI_SCENARIO_INSTANCE=A'] });
const supB = () => findSupervisorProcess({ agentDir: AGENT, envIncludes: ['PI_SCENARIO_INSTANCE=B'] });

const rows = () => readJsonl(ROUNDS);
const stateOf = () => readJson(STATE);
const textOf = (f) => readText(f);
const rolesOf = (f) => sessionRoles(readText(f));
const textsOf = (f) => sessionTexts(readText(f));
/** 会话启动会写入的元数据条目（除它们之外都算"内容"，用于断言零回合/零注入） */
const META = ['session', 'model_change', 'thinking_level_change'];
const onlyMeta = (roles) => roles.length > 0 && roles.every((r) => META.includes(r));
const metaCount = (file, type) => sessionEntries(readText(file)).filter((e) => e?.type === type).length;
/** TUI 首帧标记（与单实例场景一致） */
const tuiFrame = (pty, from = 0) => pty.output.slice(from).includes('π - my-pi') || pty.output.slice(from).includes('~/my-pi');

/** B 与 A 写重启日志之间的间隔（B 先起、日志后写）。
 *  目的：让 **B 的 session_start 落在日志写入之后**（B 真的读到了它），同时让 B 的 session_start
 *  略早于 A 新进程的 session_start（这样 B 才有机会消费、判据才被真正考到）。
 *  取值依据：两个 pi 进程同源同负载，启动耗时接近（实测本机 35–45s，双实例并发时更长），
 *  所以"B 早 10s 起"⇒ B 的 session_start 约早 A 新进程 10s，且两者都晚于日志写入。 */
const B_HEAD_START_MS = 10_000;

let ptyA = null;
let ptyB = null;
try {
  console.log(`场景：两个实例共享 agent 目录 ${AGENT}`);
  console.log(`      会话 A=${SESS_A}`);
  console.log(`      会话 B=${SESS_B}`);

  // ═══ 第一幕：A 以 full 启动 ═══
  ptyA = startSupervisorPty({ agentDir: AGENT, memoryDir: MEM, session: SESS_A, extraEnv: { PI_SCENARIO_INSTANCE: 'A' } });
  const aOut = await waitFor(() => ptyA.output.length > 0, { timeout: 150_000, label: 'A pty 有输出' });
  check('A 的 TUI 在 pty 里启动并产生输出', aOut, `${ptyA.output.length} 字节`);
  const aPiOld = (await waitFor(() => findA(), { timeout: 180_000, label: 'A 的 pi 进程', quiet: false })) ? findA() : null;
  check('A 的 pi 进程可见且带实例标记 PI_SCENARIO_INSTANCE=A', Boolean(aPiOld), '未找到带标记 A 的 node 进程（/proc 扫描失败？）');
  const aReady = await waitFor(() => tuiFrame(ptyA), { timeout: 150_000, label: 'A TUI 首帧', quiet: false });
  check('A 的 TUI 画出首帧（可以安全输入）', aReady);
  // 等 A 的**旧**进程把会话元数据写完：后面用它做基线，数"A 的新进程何时到 session_start"。
  await waitFor(() => metaCount(SESS_A, 'model_change') + metaCount(SESS_A, 'thinking_level_change') > 0, {
    timeout: 60_000,
    label: 'A 旧进程的会话元数据',
  });
  check(
    'A 起于 full：argv 不带 roleplay 人设、env 无 roleplay 命名空间',
    Boolean(aPiOld) && !aPiOld.args.includes('roleplay.md') && !aPiOld.args.includes('--append-system-prompt') && !aPiOld.env.includes('PI_MEMORY_NAMESPACE=roleplay') && aPiOld.env.includes('PI_SESSION_MODE=full'),
    `args=${aPiOld?.args}`,
  );
  check(
    'A 的会话文件里没有任何消息（full 空闲启动 = 零回合）',
    !rolesOf(SESS_A).includes('user') && !rolesOf(SESS_A).includes('assistant'),
    JSON.stringify(rolesOf(SESS_A)),
  );

  // ═══ 第二幕：B 也起来（与 A 共享 agent 目录），然后 A 才切模式 ═══
  const bSpawnedAt = Date.now();
  ptyB = startSupervisorPty({ agentDir: AGENT, memoryDir: MEM, session: SESS_B, extraEnv: { PI_SCENARIO_INSTANCE: 'B' } });
  const bPi = (await waitFor(() => findB(), { timeout: 180_000, label: 'B 的 pi 进程', quiet: false })) ? findB() : null;
  check('B 的 pi 进程可见且带实例标记 PI_SCENARIO_INSTANCE=B', Boolean(bPi), '未找到带标记 B 的 node 进程');
  check(
    '两实例的 pi 是不同进程（pid 不同）',
    Boolean(aPiOld) && Boolean(bPi) && aPiOld.pid !== bPi.pid,
    `A=${aPiOld?.pid} B=${bPi?.pid}`,
  );
  check(
    'B 起于 full：argv 不带 roleplay 人设、env 无 roleplay 命名空间',
    Boolean(bPi) && !bPi.args.includes('roleplay.md') && !bPi.env.includes('PI_MEMORY_NAMESPACE=roleplay') && bPi.env.includes('PI_SESSION_MODE=full'),
    `args=${bPi?.args}`,
  );

  // 观测"B 的 session_start 发生在什么时候"：session 启动会写入 model_change/thinking_level_change。
  // 这两条是**只读**的近似时钟，用来证明"B 真的读到了 A 的日志（而不是日志早被消费掉了）"。
  let bSessionStartAt = 0;
  const bMarkerDeadline = Date.now() + 180_000;
  const bMarkerWatch = (async () => {
    while (!bSessionStartAt && Date.now() < bMarkerDeadline) {
      if (metaCount(SESS_B, 'model_change') > 0 || metaCount(SESS_B, 'thinking_level_change') > 0) {
        bSessionStartAt = Date.now();
        break;
      }
      await sleep(150);
    }
  })();

  // 等 B 的进程站住（pi 已 exec、/proc 可读），再留出 head start，让 B 的 session_start 落在 A 写日志之后。
  await sleep(B_HEAD_START_MS);

  // ═══ 第三幕：只在 A 里切模式 ═══
  let attempts = 0;
  let restarted = false;
  const modeDeadline = Date.now() + SCENARIO_TIMEOUT_MS;
  while (!restarted && Date.now() < modeDeadline) {
    ptyA.send('/mode roleplay\r');
    attempts++;
    restarted = await waitFor(() => rows().some((r) => r.decision === 'restart' && r.session === SESS_A), { timeout: 10_000, label: 'A restart' });
  }
  check('只在 A 里发 /mode roleplay 就触发了真重拉（decision=restart）', restarted, `尝试 ${attempts} 次；${JSON.stringify(rows())}`);

  // 立刻读一次 state.json：此时 A 的新进程还在启动（35–45s），日志应当还挂着 → 拿到真 pi 写的归属字段。
  // 读要带重试：读与 supervisor 的 `clear_admin_action`（整文件读-改-写）撞上时会读到半截 JSON。
  let pendingLog = null;
  for (let i = 0; i < 40 && !pendingLog; i++) {
    const s = stateOf();
    if (s?.restartLog) {
      pendingLog = s.restartLog;
      break;
    }
    if (s && !s.restartLog) break; // 已被消费（正常不会这么快）→ 不再等
    await sleep(25);
  }
  const reqOwner = pendingLog?.ownerPid;
  const reqTs = typeof pendingLog?.timestamp === 'number' ? pendingLog.timestamp : 0;

  // 观测"日志被消费"的时刻：只有在 session_start 读到它才会消费（B 若消费=判据失效；A 新进程消费=正常）。
  // 它同时是 A 新进程 session_start 的**可观测代理**（session_start 钩子里的 takePendingModeNotice 会清掉它）。
  // 注意：必须区分"读不到文件（半截 JSON）"与"restartLog 为空"，否则会把写入瞬间误判成消费。
  let consumedAt = 0;
  const consumedWatch = (async () => {
    const deadline = Date.now() + 180_000;
    while (!consumedAt && Date.now() < deadline) {
      const s = stateOf();
      if (s && !s.restartLog) {
        consumedAt = Date.now();
        break;
      }
      await sleep(150);
    }
  })();

  const aPiNew = (await waitFor(() => {
    const p = findA();
    return Boolean(p) && Boolean(aPiOld) && p.pid !== aPiOld.pid;
  }, { timeout: 180_000, label: 'A 的新 pi 进程', quiet: false }))
    ? findA()
    : null;
  check('A 的 pi 被真的重拉（A 的新 pid ≠ 旧 pid）', Boolean(aPiNew) && Boolean(aPiOld) && aPiNew.pid !== aPiOld.pid, `old=${aPiOld?.pid} new=${aPiNew?.pid}`);

  const aRestarts = rows().filter((r) => r.decision === 'restart');
  check(
    'rounds.jsonl 里出现 restart 的**只有 A 的会话**',
    aRestarts.length >= 1 && aRestarts.every((r) => r.session === SESS_A),
    JSON.stringify(aRestarts.map((r) => ({ session: r.session, decision: r.decision }))),
  );
  check(
    'A 的新进程按 roleplay 档位启动（argv 人设 + env 命名空间）',
    Boolean(aPiNew?.args.includes('roleplay.md')) && Boolean(aPiNew?.env.includes('PI_MEMORY_NAMESPACE=roleplay')),
    `args=${aPiNew?.args}`,
  );

  // ═══ 第四幕：B 没有吃掉 A 的重启日志（新判据的真链验证）═══
  // supervisor pid 先抓下来：pi 退出后 supervisor 也会退出，"现在再查"会拿到 null。
  const supAPid = Number(supA()?.pid ?? 0);
  const supBPid = Number(supB()?.pid ?? 0);
  check(
    '真 pi 写的重启请求带 ownerPid，且等于 A 的宿主 supervisor pid（真链 ownerPid 契约）',
    typeof reqOwner === 'number' && reqOwner > 0 && reqOwner === supAPid,
    `日志=${JSON.stringify(pendingLog)} supA=${supAPid}（找不到 supervisor？）`,
  );
  check(
    'ownerPid 指向 A 而不是 B（B 的 supervisor 不会认领它）',
    typeof reqOwner === 'number' && reqOwner !== supBPid && supBPid > 0,
    `ownerPid=${reqOwner} supA=${supAPid} supB=${supBPid}`,
  );

  await bMarkerWatch; // 等 B 的 session_start 观测（若一直没写元数据，bSessionStartAt 保持 0）
  await consumedWatch; // 等日志被消费（正常情况下= A 新进程的 session_start）
  if (!bSessionStartAt) {
    console.log(`  ⚠ B 的会话元数据在 ${Math.round((Date.now() - bSpawnedAt) / 1000)}s 内没出现，无法观测 session_start；B 会话条目=${JSON.stringify(rolesOf(SESS_B))}`);
    console.log(`  B pty 输出尾部：${ptyB.output.slice(-300).replace(/\n/g, ' ')}`);
  }
  const bPiStartFloor = bPi ? bSpawnedAt : 0;
  check(
    '时序：B 的 session_start 晚于 A 的重启日志写入（B 真的读到了那条日志）',
    reqTs > 0 && bSessionStartAt > reqTs && reqTs > bPiStartFloor,
    `写入 ts=${reqTs}；B 启动=${bPiStartFloor}；B session_start≈${bSessionStartAt || '(未观测到元数据)'}`,
  );
  console.log(`  证据：A 写日志 ts=${reqTs}，B session_start≈${bSessionStartAt}（差 ${bSessionStartAt - reqTs}ms；B 先启动、日志后写入）`);
  // 更强的证据：B 的 session_start 早于"日志被消费"的时刻 ⇒ B 真的读到了那条日志（而不是它早被 A 拿走了）。
  if (bSessionStartAt > 0 && consumedAt > 0 && bSessionStartAt < consumedAt) {
    console.log(`  证据：B session_start≈${bSessionStartAt} **早于**日志被消费≈${consumedAt}（差 ${consumedAt - bSessionStartAt}ms）——B 有充分机会消费它，但它没有（归属判据在真链上生效）`);
  } else if (bSessionStartAt > 0 && consumedAt > 0) {
    console.log(`  ⚠ 本次未能构造出"B 先于消费者读到日志"的时序（B session_start≈${bSessionStartAt}，消费≈${consumedAt}）：硬断言（B 的会话零注入 + A 消费成功）仍然有效，但判据的正面验证弱化`);
  }

  const bRolesBeforeTurn = rolesOf(SESS_B);
  check(
    'B 的会话文件里没有任何 A 的注入（无 custom_message / user 消息）',
    onlyMeta(bRolesBeforeTurn),
    JSON.stringify(bRolesBeforeTurn),
  );
  check(
    'B 的会话文本里没有 A 的模式切换/续跑痕迹',
    !/my-pi-mode-switch|my-pi-restart|系统已重启/.test(textOf(SESS_B)),
    textOf(SESS_B).slice(-300),
  );

  check(
    'A 的新进程最终拿到了那条日志（state.json 的 restartLog 被消费/清空）',
    consumedAt > 0,
    JSON.stringify(stateOf()),
  );

  // ═══ 第五幕：两实例同时在跑 → state-audit 必须报告 multiple-instances ═══
  const alive = findAllPiProcesses({ agentDir: AGENT });
  const aliveA = alive.filter((p) => p.env.includes('PI_SCENARIO_INSTANCE=A'));
  const aliveB = alive.filter((p) => p.env.includes('PI_SCENARIO_INSTANCE=B'));
  check(
    '/proc 里同时存在两个实例的 pi 进程（A 一个、B 一个）',
    aliveA.length === 1 && aliveB.length === 1,
    `A=${aliveA.map((p) => p.pid)} B=${aliveB.map((p) => p.pid)} 全部=${alive.map((p) => p.pid)}`,
  );

  const audit = spawnSync('node', ['scripts/state-audit.mjs', '--json'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PI_CODING_AGENT_DIR: AGENT },
    encoding: 'utf8',
  });
  let auditJson = null;
  try {
    auditJson = JSON.parse(audit.stdout);
  } catch {
    /* 断言会报错 */
  }
  const instFinding = (auditJson?.findings ?? []).find((f) => f.code === 'multiple-instances');
  const detected = Number(/检测到 (\d+) 个/.exec(instFinding?.message ?? '')?.[1] ?? 0);
  check(
    '两实例同时在跑：state-audit 报告 multiple-instances 且实例数 ≥2',
    Boolean(instFinding) && detected >= 2,
    `detected=${detected}；stdout 尾部=${(audit.stdout ?? '').slice(-400)}`,
  );
  console.log(`  证据（state-audit 输出）：${instFinding?.message ?? '(无 multiple-instances 发现)'}`);

  // ═══ 第六幕：B 仍然可用（A 的重启没有把 B 搅乱）═══
  const bReady = await waitFor(() => tuiFrame(ptyB), { timeout: 150_000, label: 'B TUI 首帧', quiet: false });
  check('B 的 TUI 画出首帧（可以安全输入）', bReady);

  provider.setReply('TWO-INST-B-REPLY');
  const completionsBefore = provider.completions.length;
  let bAttempts = 0;
  let bTurn = false;
  const bDeadline = Date.now() + SCENARIO_TIMEOUT_MS;
  while (!bTurn && Date.now() < bDeadline) {
    ptyB.send('请只回复固定串\r');
    bAttempts++;
    bTurn = await waitFor(() => provider.completions.length > completionsBefore, { timeout: 10_000, label: 'B 的模型请求' });
  }
  check('B 仍然可用：假 provider 收到 B 的模型请求', bTurn, `尝试 ${bAttempts} 次；completions=${provider.completions.length}`);
  const bReplied = await waitFor(() => textOf(SESS_B).includes('TWO-INST-B-REPLY'), { timeout: 120_000, label: 'B 的回复落盘', quiet: false });
  check('B 的回复落进 B 的会话文件', bReplied, textOf(SESS_B).slice(-400));

  // ═══ 第七幕：互不污染 + 收尾 ═══
  const aTextFinal = textOf(SESS_A);
  const bTextFinal = textOf(SESS_B);
  check(
    'A/B 会话互不污染：B 的回复只在 B 的会话里',
    bTextFinal.includes('TWO-INST-B-REPLY') && !aTextFinal.includes('TWO-INST-B-REPLY'),
    `A 尾部=${aTextFinal.slice(-200)}`,
  );
  check(
    'A 的会话全程零回合（B 的提示没有落到 A，也没有被 A 消费成消息）',
    onlyMeta(rolesOf(SESS_A)) && !aTextFinal.includes('请只回复固定串'),
    JSON.stringify(rolesOf(SESS_A)),
  );
  const aUserTexts = textsOf(SESS_A);
  const bUserTexts = textsOf(SESS_B);
  check(
    'A/B 会话文本互不串台（各自的提示/回复只出现在自己的会话里）',
    !aUserTexts.some((t) => t.includes('TWO-INST-B-REPLY')) &&
      !aUserTexts.some((t) => t.includes('请只回复固定串')) &&
      bUserTexts.some((t) => t.includes('TWO-INST-B-REPLY')),
    `A=${JSON.stringify(aUserTexts).slice(0, 200)} B=${JSON.stringify(bUserTexts).slice(0, 200)}`,
  );

  const bNow = findB();
  check('B 的 pi pid 全程不变（没有被 A 的重启带走/重拉）', Boolean(bNow) && Boolean(bPi) && bNow.pid === bPi.pid, `起始=${bPi?.pid} 现在=${bNow?.pid}`);
  const bRestarts = rows().filter((r) => r.decision === 'restart' && r.session === SESS_B);
  check('rounds.jsonl 里 B 的会话全程没有 restart 轮次', bRestarts.length === 0, JSON.stringify(bRestarts));

  // 收尾：两个实例都 SIGTERM（走 pi 自己的优雅关闭）。
  const [aExited, bExited] = await Promise.all([
    stopPi({ find: findA, done: () => rows().some((r) => r.decision === 'exit' && r.session === SESS_A), timeout: 150_000, label: 'A 退出' }),
    stopPi({ find: findB, done: () => rows().some((r) => r.decision === 'exit' && r.session === SESS_B), timeout: 150_000, label: 'B 退出' }),
  ]);
  const finalRows = rows();
  check('A 干净退出（rounds 出现 A 会话的 exit 记录）', aExited, JSON.stringify(finalRows.map((r) => ({ s: r.session, d: r.decision, c: r.exitCode }))));
  check('B 干净退出（rounds 出现 B 会话的 exit 记录）', bExited, JSON.stringify(finalRows.map((r) => ({ s: r.session, d: r.decision, c: r.exitCode }))));
  check('rounds.jsonl 按 session 区分两个实例（A/B 的轮次都在同一份文件里）', finalRows.some((r) => r.session === SESS_A) && finalRows.some((r) => r.session === SESS_B), JSON.stringify(finalRows.map((r) => r.session)));
  check('全程没有"重启请求被吞"（lostRestart 全为 false）', finalRows.every((r) => r.lostRestart === false), JSON.stringify(finalRows.filter((r) => r.lostRestart)));

  // 共享目录下的 per-round crash log 也必须按实例分开：两个 supervisor 的 ROUND_INDEX 都从 1 开始，
  // 旧命名（round-1.log）在共享目录里会互相覆盖，复盘时恰好丢掉要查的那一轮（本次实测发现）。
  const roundLogs = (() => {
    try {
      return readdirSync(join(AGENT, 'recovery', 'rounds')).filter((f) => /^round-\d+-\d+\.log$/.test(f));
    } catch {
      return [];
    }
  })();
  const pidA = String(supAPid);
  const pidB = String(supBPid);
  const logsA = roundLogs.filter((f) => f.endsWith(`-${pidA}.log`));
  const logsB = roundLogs.filter((f) => f.endsWith(`-${pidB}.log`));
  check(
    'per-round crash log 按实例分开（名字带 supervisor pid，共享目录下不互相覆盖）',
    logsA.length > 0 && logsB.length > 0 && logsA.every((f) => !logsB.includes(f)),
    `supA=${pidA} 的日志=${JSON.stringify(logsA)}；supB=${pidB} 的日志=${JSON.stringify(logsB)}；全部=${JSON.stringify(roundLogs)}`,
  );
} finally {
  ptyA?.kill('SIGKILL');
  ptyB?.kill('SIGKILL');
  await provider.close().catch(() => {});
  scene.cleanup();
}

console.log('');
if (failed > 0) {
  console.log(`❌ 两实例隔离场景失败：${failed}/${results.length} 项`);
  console.log('  排查入口：共享 agent 目录的 recovery/rounds.jsonl 与 autopilot/state.json（用 PI_SCENARIO_KEEP=1 重跑保留现场）');
  process.exit(1);
}
console.log(`🎉 两实例隔离场景通过（${results.length} 项）：共享 agent 目录下 A 的重启不越界到 B，且重启日志归属判定在真链上成立`);
