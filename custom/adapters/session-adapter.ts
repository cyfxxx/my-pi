/**
 * Session Adapter
 *
 * 职责：封装 Pi 的会话枚举 API（`SessionManager.list` / `listAll`），
 * 对外暴露稳定的 `SessionRow` 结构，供 features 做会话列表/切换。
 * 约束：这是唯一允许 import Pi 会话相关 API 的地方。
 */

import { SessionManager } from '@earendil-works/pi-coding-agent';

export interface SessionRow {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  createdMs: number;
  modifiedMs: number;
  messageCount: number;
  firstMessage: string;
}

interface PiSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created?: Date | string | number;
  modified?: Date | string | number;
  messageCount?: number;
  firstMessage?: string;
}

function toMs(v: Date | string | number | undefined): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function toRow(s: PiSessionInfo): SessionRow {
  return {
    id: String(s.id ?? ''),
    path: String(s.path ?? ''),
    cwd: String(s.cwd ?? ''),
    name: s.name,
    createdMs: toMs(s.created),
    modifiedMs: toMs(s.modified),
    messageCount: Number(s.messageCount ?? 0),
    firstMessage: String(s.firstMessage ?? ''),
  };
}

/** 列出会话：给 cwd 时仅该工作目录，否则全部（按修改时间倒序由调用方处理） */
export async function listSessions(cwd?: string): Promise<SessionRow[]> {
  try {
    const list = cwd ? await SessionManager.list(cwd) : await SessionManager.listAll();
    return (list as PiSessionInfo[]).map(toRow);
  } catch {
    return [];
  }
}

/** 按 sessionId 前缀 / 文件路径 / 文件名解析目标会话 */
export async function resolveSession(target: string): Promise<SessionRow | null> {
  const t = target.trim();
  if (!t) return null;
  const all = await listSessions();
  const byId = all.find((s) => s.id && s.id.startsWith(t));
  if (byId) return byId;
  const byPath = all.find((s) => s.path === t || s.path.endsWith('/' + t));
  return byPath ?? null;
}
