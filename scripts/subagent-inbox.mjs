#!/usr/bin/env node
/**
 * 子代理"中途通信"的**文件收件箱**（零依赖、跨平台，2026-10-10）
 *
 * ## 定位（重要，别误解）
 * 这是一个**持久队列**：主会话 `post` 追加消息，子代理一侧在**步骤边界**读取并作为**追加指令**执行。
 * 真正的"投递"由父进程完成（`custom/features/subagent/core/runner.ts` 在等待期间轮询本收件箱，
 * 把新消息通过**既有 RPC 的 `prompt` 通道**转发给子进程）。这样做的两个理由：
 *   1. 子代理默认以 **`--no-extensions`** 启动（`buildPooledSpawnArgs`）⇒ **子进程里跑不到我们的代码**，
 *      所以"在子代理内部读文件"这条路**默认不可用**；
 *   2. 不去放开那个默认：那一行注释明确写着它是**安全属性**（"把'子代理能改状态'的风险留在显式请求里"）。
 * ⇒ 本脚本只管**存取**，不负责投递；投递语义见 runner 的注释。
 *
 * ## 存储（复用既有运行时目录惯例）
 *   <memory>/subagent/<id>.inbox.jsonl     ← 一行一条：{ts,seq,text}
 *   <memory>/subagent/<id>.inbox.state.json ← {consumed: <已消费的最大 seq>}
 * `<memory>` 取 `PI_MEMORY_DIR`，否则 `<repo>/portable/memory`（与既有脚本一致）。
 * **id 用 agent 名**（例如 `general`）——因为 `subagent` 工具**不允许新增参数**（声明面预算只剩约 1.1KB），
 * 所以不做"每次运行一个 id"。**代价（如实）**：同一 agent 的**并行**运行会共用同一个收件箱。
 *
 * ## 命令
 *   post <id> <text...>        追加一条消息（返回新 seq）
 *   list                       列出有收件箱的 id 与**未读条数**
 *   read <id> [--max N] [--consume]   读取未读消息（默认上限 3 条 = "单轮最多 3 条"）；--consume 记录已读
 *   --self-check               双向自证（见下）
 *
 * ## 自证（`--self-check`，双向、可证伪）
 * 在临时目录里：① post 两条 ⇒ read 逐条拿到；② 不 consume 再读 ⇒ 仍是那两条（未消费不改状态）；
 * ③ consume 后再读 ⇒ 必须为空；④ 坏行（半行 JSON）⇒ **跳过且不崩**并报告坏行数；
 * ⑤ **反向断言**：构造"永远返回空"与"永远返回全部"两个假实现，断言它们在上述用例上**必然违反**。
 * 只断言"没坏的时候对"是不够的 —— 那样两条假实现都能通过。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(HERE, '..');
export const MAX_PER_ROUND = 3;

/** 运行时目录：与既有脚本一致，`PI_MEMORY_DIR` 优先 */
export function memoryDir(env = process.env) {
  return env.PI_MEMORY_DIR && env.PI_MEMORY_DIR.trim() ? env.PI_MEMORY_DIR.trim() : join(REPO, 'portable', 'memory');
}
export function subagentDir(env = process.env) {
  return join(memoryDir(env), 'subagent');
}
export function inboxPath(id, env = process.env) {
  return join(subagentDir(env), `${safeId(id)}.inbox.jsonl`);
}
export function statePath(id, env = process.env) {
  return join(subagentDir(env), `${safeId(id)}.inbox.state.json`);
}
/** id 只允许安全字符（防路径穿越 —— 收件箱 id 来自命令行，必须校验） */
export function safeId(id) {
  const s = String(id ?? '').trim();
  if (!s) throw new Error('缺少 id');
  if (!/^[A-Za-z0-9._#-]+$/.test(s) || s === '.' || s === '..') {
    throw new Error(`id 不合法（只允许字母数字点下划线连字符）：${s}`);
  }
  return s;
}

/** 解析 JSONL：**坏行跳过并计数**（fail-open：收件箱坏了也不能让谁崩） */
export function parseLines(raw) {
  const out = [];
  let bad = 0;
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o.text === 'string' && Number.isFinite(o.seq)) out.push(o);
      else bad++;
    } catch {
      bad++;
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return { messages: out, bad };
}

export function readState(id, env = process.env) {
  const f = statePath(id, env);
  if (!existsSync(f)) return { consumed: 0 };
  try {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return { consumed: Number.isFinite(o?.consumed) ? o.consumed : 0 };
  } catch {
    return { consumed: 0 }; // 状态坏了 ⇒ 当作没消费过（宁可重复提示，也不静默丢消息）
  }
}

/** 纯函数：从未读集合里取前 max 条 */
export function pickUnread(messages, consumed, max = MAX_PER_ROUND) {
  return messages.filter((m) => m.seq > consumed).slice(0, Math.max(0, max));
}
export function unreadCount(messages, consumed) {
  return messages.filter((m) => m.seq > consumed).length;
}

export function post(id, text, env = process.env) {
  const dir = subagentDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const f = inboxPath(id, env);
  const { messages } = existsSync(f) ? parseLines(readFileSync(f, 'utf8')) : { messages: [] };
  const seq = messages.length ? messages[messages.length - 1].seq + 1 : 1;
  appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), seq, text: String(text) }) + '\n', 'utf8');
  return seq;
}

export function consume(id, seq, env = process.env) {
  const dir = subagentDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cur = readState(id, env);
  if (seq > cur.consumed) writeFileSync(statePath(id, env), JSON.stringify({ consumed: seq }) + '\n', 'utf8');
}

export function listInboxes(env = process.env) {
  const dir = subagentDir(env);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.inbox.jsonl'))
    .map((n) => n.replace(/\.inbox\.jsonl$/, ''))
    .map((id) => {
      const { messages, bad } = parseLines(readFileSync(join(dir, `${id}.inbox.jsonl`), 'utf8'));
      return { id, total: messages.length, unread: unreadCount(messages, readState(id, env).consumed), bad };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function selfCheck() {
  const env = { PI_MEMORY_DIR: join(tmpdir(), `subagent-inbox-selfcheck-${process.pid}`) };
  const checks = [];
  const id = 'general';

  post(id, '第一条：去查 A', env);
  const s2 = post(id, '第二条：顺手看下 B', env);
  const f = inboxPath(id, env);

  // ① 逐条拿到
  const r1 = pickUnread(parseLines(readFileSync(f, 'utf8')).messages, readState(id, env).consumed);
  checks.push(['post 两条后 read 逐条拿到', r1.length === 2 && r1[0].text.includes('A') && r1[1].text.includes('B')]);

  // ② 不 consume 再读 ⇒ 仍是那两条（未消费不改状态）
  const r2 = pickUnread(parseLines(readFileSync(f, 'utf8')).messages, readState(id, env).consumed);
  checks.push(['不 consume 再读仍是两条', r2.length === 2]);

  // ③ consume 后再读 ⇒ 必须为空
  consume(id, s2, env);
  const r3 = pickUnread(parseLines(readFileSync(f, 'utf8')).messages, readState(id, env).consumed);
  checks.push(['consume 后再读为空', r3.length === 0]);

  // ④ 坏行 ⇒ 跳过且不崩，并报坏行数
  // 故意的坏行：**必须自成一行**（结尾带 \n），否则它会把下一行吞进同一行 ⇒ 好行也解析不出来
  // （第一版就漏了这个 \n，自证当场判红 ✓ —— 是夹具错，不是实现错）
  appendFileSync(f, '{"ts":"x","seq":99,"text":"半行\n', 'utf8');
  appendFileSync(f, '{"ts":"x","seq":100,"text":"第三条：C"}\n', 'utf8');
  const p4 = parseLines(readFileSync(f, 'utf8'));
  const r4 = pickUnread(p4.messages, readState(id, env).consumed);
  checks.push(['坏行被跳过且不崩（坏行数=1，好行=3）', p4.bad === 1 && p4.messages.length === 3 && r4.length === 1 && r4[0].seq === 100]);

  // ⑤ 反向断言：两条假实现必须违反上述用例
  const fakeAlwaysEmpty = () => [];
  const fakeAlwaysAll = (msgs) => msgs;
  const reverse =
    JSON.stringify(fakeAlwaysEmpty()) !== JSON.stringify(r1) && // "永远空" 过不了 ①
    JSON.stringify(fakeAlwaysAll(parseLines(readFileSync(f, 'utf8')).messages)) !== JSON.stringify(r3); // "永远全部" 过不了 ③
  checks.push(['反向断言：假实现必然违反（永远空 / 永远全部）', reverse]);

  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? '✓' : '✗'} ${name}`);
    if (!pass) ok = false;
  }
  console.log(ok ? '✅ 收件箱自证通过（含反向断言）' : '❌ 收件箱自证失败');
  process.exit(ok ? 0 : 1);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-check')) return selfCheck();
  const [cmd, ...rest] = argv;

  if (cmd === 'post') {
    const id = rest[0];
    const text = rest.slice(1).join(' ').trim();
    if (!text) {
      console.error('用法：post <id> <text...>');
      process.exit(2);
    }
    console.log(`已投递 seq=${post(id, text)} → ${inboxPath(id)}`);
    return;
  }
  if (cmd === 'list') {
    const rows = listInboxes();
    if (!rows.length) {
      console.log('（还没有任何收件箱）');
      return;
    }
    for (const r of rows) {
      console.log(`${r.id}：未读 ${r.unread} / 共 ${r.total}${r.bad ? `（坏行 ${r.bad}，已跳过）` : ''}`);
    }
    return;
  }
  if (cmd === 'read') {
    const id = safeId(rest[0]);
    const maxIdx = rest.indexOf('--max');
    const max = maxIdx >= 0 ? Number(rest[maxIdx + 1]) : MAX_PER_ROUND;
    const f = inboxPath(id);
    if (!existsSync(f)) {
      console.log('（没有这个收件箱）');
      return;
    }
    const { messages, bad } = parseLines(readFileSync(f, 'utf8'));
    const consumed = readState(id).consumed;
    const picked = pickUnread(messages, consumed, Number.isFinite(max) ? max : MAX_PER_ROUND);
    if (bad) console.log(`（跳过坏行 ${bad} 行）`);
    if (!picked.length) {
      console.log('（无未读）');
      return;
    }
    for (const m of picked) console.log(`[${m.seq}] ${m.text}`);
    if (rest.includes('--consume')) {
      consume(id, picked[picked.length - 1].seq);
      const left = unreadCount(messages, picked[picked.length - 1].seq);
      console.log(left ? `（已消费到 seq=${picked[picked.length - 1].seq}；还剩 ${left} 条未读，留到下一轮）` : `（已消费到 seq=${picked[picked.length - 1].seq}）`);
    }
    return;
  }
  console.error('用法：post <id> <text...> ｜ list ｜ read <id> [--max N] [--consume] ｜ --self-check');
  process.exit(2);
}

// ⚠ 必须守卫：模块**在 import 时不得执行 main()** —— 否则纯函数无法被导入复用（本会话已有同源教训）
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
