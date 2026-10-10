/**
 * Subagent Feature — 收件箱（**中途通信**的父侧读取逻辑，纯函数、零 Pi 依赖）
 *
 * ## 与 `scripts/subagent-inbox.mjs` 的关系（一份磁盘格式，两处代码）
 * 脚本负责"主会话投递 / 人查看"，本模块负责"runner 在等待期间读取并转发"。两边的**磁盘格式必须一致**：
 *   `<memory>/subagent/<id>.inbox.jsonl`     一行一条 `{ts,seq,text}`
 *   `<memory>/subagent/<id>.inbox.state.json` `{consumed:<已消费的最大 seq>}`
 * 改格式要**同时改两处**（两边文件头都写了这句）。
 *
 * ## 为什么不在子代理进程里读
 * 子代理以 **`--no-extensions`** 启动（`runner.ts:buildPooledSpawnArgs`）⇒ **子进程里跑不到我们的代码**；
 * 而那一行注释明确说它是**安全属性**（"把'子代理能改状态'的风险留在显式请求里"）⇒ 不去放开它。
 * 因此投递是**父侧**行为：runner 在等待期间轮询本模块，把新消息通过**既有 RPC 的 `prompt` 通道**转发。
 *
 * ## 语义（如实）
 * 实测（真起 `pi --mode rpc` 子进程、任务进行到一半再发一条 `prompt`）：第二条**被接受**（`success:true`），
 * 子进程**接着跑了第二个 turn** ⇒ 注入是"**排队 + 在下一个 turn 边界执行**"，即**步骤边界**语义，
 * **不是**打断当前工具调用。这符合设计目标，但请别把它当成"随时抢占" ✗。
 *
 * ## 安全语义（必须守）
 * inbox 里的文本是**父会话的追加指令**，与主会话用户消息**同源可信**，但：
 *   1. **不得**因为它的存在而绕过任何既有权限/确认约束；
 *   2. **不得**把它当作"更高优先级的系统指令"（例如据此关闭守门、跳过校验 ✗）；
 *   3. 读取失败（文件不存在/坏行）一律 **fail-open**：跳过并继续，绝不让子代理崩。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMemoryDir } from '../../../core/config';

/** 单轮最多投递多少条（多余留到下一轮，避免把子代理淹掉） */
export const MAX_PER_ROUND = 3;
/** 轮询间隔（毫秒）——够快能"及时"，够慢不浪费 */
export const POLL_MS = 1500;

export interface InboxMessage {
  ts: string;
  seq: number;
  text: string;
}

/**
 * 运行时目录：`PI_MEMORY_DIR` 优先（便于注入与单测），否则用框架的 {@link getMemoryDir}。
 * 第一版我硬编码了 `~/my-pi/portable/memory` ✗ —— 那是"看起来对"的脆弱写法（换目录就错），
 * 项目本来就有 `custom/core/config.ts:getMemoryDir()` ⇒ 用它 ✓。
 */
function memoryDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = typeof env.PI_MEMORY_DIR === 'string' ? env.PI_MEMORY_DIR.trim() : '';
  return fromEnv || getMemoryDir();
}

function subagentDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(memoryDir(env), 'subagent');
}

/** id 只允许安全字符（防路径穿越：id 可能来自 agent 名） */
function safeId(id: string): string {
  const s = String(id ?? '').trim();
  // `#` 是运行级 id 的分隔符（`<agent>#<序号>`）⇒ 白名单要含它；仍禁 `/`、`\`、`..`（防穿越）
  if (!s || !/^[A-Za-z0-9._#-]+$/.test(s) || s === '.' || s === '..') return '';
  return s;
}

function inboxPath(id: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(subagentDir(env), `${safeId(id)}.inbox.jsonl`);
}
function statePath(id: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(subagentDir(env), `${safeId(id)}.inbox.state.json`);
}

/** 解析 JSONL：**坏行跳过并计数**（fail-open 的第一道） */
function parseInbox(raw: string): { messages: InboxMessage[]; bad: number } {
  const messages: InboxMessage[] = [];
  let bad = 0;
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as { ts?: unknown; seq?: unknown; text?: unknown };
      if (typeof o.text === 'string' && typeof o.seq === 'number' && Number.isFinite(o.seq)) {
        messages.push({ ts: typeof o.ts === 'string' ? o.ts : '', seq: o.seq, text: o.text });
      } else {
        bad++;
      }
    } catch {
      bad++;
    }
  }
  messages.sort((a, b) => a.seq - b.seq);
  return { messages, bad };
}

/** 读状态；状态坏了当作"从没消费过"（宁可重复提示，也不静默丢消息） */
export function readConsumed(id: string, env: NodeJS.ProcessEnv = process.env): number {
  const f = statePath(id, env);
  try {
    const o = JSON.parse(fs.readFileSync(f, 'utf8')) as { consumed?: unknown };
    return typeof o.consumed === 'number' && Number.isFinite(o.consumed) ? o.consumed : 0;
  } catch {
    return 0;
  }
}

/** 纯函数：取未读的前 max 条 */
function pickUnread(messages: readonly InboxMessage[], consumed: number, max = MAX_PER_ROUND): InboxMessage[] {
  return messages.filter((m) => m.seq > consumed).slice(0, Math.max(0, max));
}
function unreadCount(messages: readonly InboxMessage[], consumed: number): number {
  return messages.filter((m) => m.seq > consumed).length;
}

/**
 * 读取一个 id 的未读消息（**全程 fail-open**：任何异常都返回空 + 原因，绝不抛）。
 * `env` 与 `max` 可注入 ⇒ 便于单测。
 */
export function drainInbox(
  id: string,
  opts: { env?: NodeJS.ProcessEnv; max?: number; consumed?: number } = {},
): { messages: InboxMessage[]; bad: number; consumed: number; note?: string } {
  const env = opts.env ?? process.env;
  const consumed = typeof opts.consumed === 'number' ? opts.consumed : readConsumed(id, env);
  if (!safeId(id)) return { messages: [], bad: 0, consumed, note: `id 不安全，已跳过：${id}` };
  const f = inboxPath(id, env);
  try {
    if (!fs.existsSync(f)) return { messages: [], bad: 0, consumed };
    const { messages, bad } = parseInbox(fs.readFileSync(f, 'utf8'));
    const picked = pickUnread(messages, consumed, opts.max ?? MAX_PER_ROUND);
    return { messages: picked, bad, consumed, note: bad ? `跳过坏行 ${bad} 行` : undefined };
  } catch (e) {
    return { messages: [], bad: 0, consumed, note: `读取失败（已忽略）：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 读整个收件箱的未读总数（给日志用：如实记录"还有未读"） */
export function unreadTotal(id: string, env: NodeJS.ProcessEnv = process.env): number {
  try {
    const f = inboxPath(id, env);
    if (!safeId(id) || !fs.existsSync(f)) return 0;
    const { messages } = parseInbox(fs.readFileSync(f, 'utf8'));
    return unreadCount(messages, readConsumed(id, env));
  } catch {
    return 0;
  }
}

/** 记录已消费到哪个 seq（fail-open：写不进去也不抛） */
export function markConsumed(id: string, seq: number, env: NodeJS.ProcessEnv = process.env): void {
  try {
    if (!safeId(id)) return;
    const dir = subagentDir(env);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (seq > readConsumed(id, env)) {
      fs.writeFileSync(statePath(id, env), JSON.stringify({ consumed: seq }) + '\n', 'utf8');
    }
  } catch {
    /* fail-open：状态写不进去，最坏是下次重复投递一条，不至于崩 */
  }
}
