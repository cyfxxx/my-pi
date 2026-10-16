/**
 * 会话枚举：DSH 侧实现（`ctx.sessions.list()` + 可选 `ctx.sessionTitle`）
 *
 * ## 为什么要单独一块（而不是继续用 pi 的 `SessionManager`）
 *
 * `custom/adapters/session-adapter.ts` 原先只走 pi 的 `SessionManager.list/listAll`；
 * 在 DSH 上那两行走的是 pi shim（**返回空表**）⇒ 所有"列出/选择会话"的功能在 DSH 上
 * 会**静默显示为空**（不是报错，是本项目最忌讳的失效形态）。
 *
 * ## 契约（2026-10-17 从真实包读到并用真实 `SessionStore` 验过）
 *
 *   - `ctx.sessions.list(): Session[]`（`dsh-session/lib/types/index.d.ts:119`）
 *   - 每个 `Session`：`id`、`header{cwd?, createdAt}`、`ownEvents()`（日志事件数组，
 *     事件形如 `{type, seq, time, data}`）—— 实测 `Session.append('user/message', msg, {surfaceOp:'append'})`
 *     会落进 `ownEvents()`
 *   - ✗ **没有磁盘文件路径**：DSH 会话是存储模型 ⇒ 本模块给 `path` 字段填
 *     `dsh-session:<id>` 这个**稳定键**（与 `custom/features/mode/session-key.ts` 同构），
 *     明确它不是路径；调用方要真路径时必须先判断（`isSessionPath`）。
 *   - `name`：优先 `ctx.sessionTitle.get(session)`（服务可能未加载）；否则用**首条用户消息**
 *     的截断兜底（DSH 自带的 `foldSessionTitle()` 更精细，但引入它会破坏"适配层零 DSH import"）。
 */

import { getDshService } from './service';
import type { DshContext, DshSessions, DshSessionTitle } from './types';

/** 与 pi 侧 `SessionRow` 同形的行（避免跨模块 import：`session-adapter.ts` 会在运行时 import pi） */
export interface DshSessionRow {
  id: string;
  /** **稳定键**（`dsh-session:<id>`）——DSH 会话没有磁盘路径，别当路径用 */
  path: string;
  cwd: string;
  name?: string;
  createdMs: number;
  modifiedMs: number;
  messageCount: number;
  firstMessage: string;
}

export type DshSessionListResult =
  | { readonly success: true; readonly data: DshSessionRow[] }
  | { readonly success: false; readonly error: string };

/** 会话对象的宽松读法（只取用到的字段，缺就是缺） */
interface SessionLike {
  readonly id?: unknown;
  readonly header?: { readonly id?: unknown; readonly cwd?: unknown; readonly createdAt?: unknown };
  ownEvents?(): readonly unknown[];
  deriveMessages?(): readonly unknown[];
}

const MESSAGE_EVENT_TYPES = new Set(['user/message', 'assistant/message']);

function textOfMessage(value: unknown): string {
  const record = typeof value === 'object' && value !== null ? (value as { content?: unknown }) : undefined;
  const content = record?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const block of content) {
    const b = typeof block === 'object' && block !== null ? (block as { type?: unknown; text?: unknown }) : undefined;
    if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
  }
  return texts.join('\n');
}

/** 首条用户消息的截断（DSH 有更精细的 `foldSessionTitle`，但那会引入 DSH import ⇒ 这里自足实现） */
function derivedName(firstMessage: string, maxLen = 60): string | undefined {
  const text = firstMessage.trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}

/** 列出一个会话的行；`sessionTitle` 服务存在时优先用它给的标题 */
export function toDshSessionRow(session: unknown, sessionTitle?: { get?: (s: unknown) => unknown }): DshSessionRow {
  const s = (typeof session === 'object' && session !== null ? session : {}) as SessionLike;
  const id = String(s.id ?? s.header?.id ?? '');
  const events = typeof s.ownEvents === 'function' ? s.ownEvents() : [];
  let lastTime = 0;
  let messageCount = 0;
  let firstMessage = '';
  for (const raw of events) {
    const e = typeof raw === 'object' && raw !== null ? (raw as { type?: unknown; time?: unknown; data?: unknown }) : undefined;
    if (typeof e?.time === 'number' && e.time > lastTime) lastTime = e.time;
    if (typeof e?.type === 'string' && MESSAGE_EVENT_TYPES.has(e.type)) {
      messageCount += 1;
      if (!firstMessage && e.type === 'user/message') firstMessage = textOfMessage(e.data);
    }
  }
  let name: string | undefined;
  try {
    const snapshot = sessionTitle?.get?.(session) as { title?: unknown } | undefined;
    if (snapshot && typeof snapshot.title === 'string' && snapshot.title.length > 0) name = snapshot.title;
  } catch {
    /* 标题服务抛错：退回下面的首消息兜底 */
  }
  if (!name) name = derivedName(firstMessage);
  const createdMs = typeof s.header?.createdAt === 'number' ? s.header.createdAt : 0;
  return {
    id,
    path: `dsh-session:${id}`,
    cwd: typeof s.header?.cwd === 'string' ? s.header.cwd : '',
    ...(name ? { name } : {}),
    createdMs,
    modifiedMs: lastTime > 0 ? lastTime : createdMs,
    messageCount,
    firstMessage,
  };
}

/**
 * 列出会话（可选按 `cwd` 过滤），按 `modifiedMs` 倒序。
 * 会话服务缺失 ⇒ **显式失败**（`success:false` + 原因），不返回空表假装"没有会话"。
 */
export function listDshSessions(ctx: DshContext, cwd?: string): DshSessionListResult {
  const sessions = getDshService<DshSessions>(ctx, 'sessions');
  if (!sessions || typeof sessions.list !== 'function') {
    return { success: false, error: 'DSH 未加载会话服务（ctx.sessions.list 不可用）⇒ 无法枚举会话' };
  }
  let raw: readonly unknown[];
  try {
    raw = sessions.list();
  } catch (error) {
    return { success: false, error: `ctx.sessions.list() 抛错：${error instanceof Error ? error.message : String(error)}` };
  }
  const titleService = getDshService<DshSessionTitle>(ctx, 'sessionTitle') as { get?: (s: unknown) => unknown } | undefined;
  let rows = raw.map((session) => toDshSessionRow(session, titleService));
  if (typeof cwd === 'string' && cwd.length > 0) rows = rows.filter((row) => row.cwd === cwd);
  rows.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return { success: true, data: rows };
}
