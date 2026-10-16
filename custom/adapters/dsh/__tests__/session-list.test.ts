/**
 * DSH 会话枚举（`listDshSessions`）的单测。
 *
 * 守两件事：
 *   ① **不假装**：会话服务缺失时返回 `success:false` + 原因，**不返回空表**（"没有会话"与
 *      "列不出来"是两件事，混起来就是静默失效）；
 *   ② 行内容按契约从 `Session` 上取：`id`/`header.cwd`/`header.createdAt`/`ownEvents()`
 *      （事件形如 `{type, seq, time, data}`），`path` 是 `dsh-session:<id>` **稳定键**而不是磁盘路径。
 */

import { describe, expect, it } from 'vitest';

import { listDshSessions, toDshSessionRow } from '../session-list';
import type { DshContext } from '../types';

/** 造一个 Session 形状的假对象（字段名与真实契约一致） */
function fakeSession(id: string, cwd: string, events: Array<{ type: string; time?: number; data?: unknown }>) {
  return {
    id,
    header: { id, cwd, createdAt: 1000 },
    ownEvents: () => events.map((e, i) => ({ type: e.type, seq: i, time: e.time ?? 1000 + i, data: e.data })),
  };
}

const userMsg = (text: string) => ({ id: `m-${text}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });

describe('toDshSessionRow', () => {
  it('从事件里取消息数/首条用户消息/修改时间；path 是稳定键', () => {
    const row = toDshSessionRow(
      fakeSession('s1', '/work/x', [
        { type: 'user/message', time: 10, data: userMsg('第一条：整理 packs') },
        { type: 'assistant/message', time: 20, data: { content: [{ type: 'text', text: '好的' }] } },
        { type: 'user/message', time: 30, data: userMsg('第二条') },
        { type: 'turn/start', time: 40, data: { turn: 1 } },
      ]),
    );
    expect(row.id).toBe('s1');
    expect(row.path).toBe('dsh-session:s1');
    expect(row.cwd).toBe('/work/x');
    expect(row.createdMs).toBe(1000);
    expect(row.modifiedMs).toBe(40);
    expect(row.messageCount).toBe(3); // 两条 user + 一条 assistant；turn/start 不算
    expect(row.firstMessage).toBe('第一条：整理 packs');
    expect(row.name).toBe('第一条：整理 packs'); // 无标题服务 ⇒ 首消息兜底
  });

  it('标题服务可用时优先用它的标题', () => {
    const row = toDshSessionRow(
      fakeSession('s2', '/w', [{ type: 'user/message', time: 5, data: userMsg('很长的第一条消息……') }]),
      { get: () => ({ title: 'DSH 迁移' }) },
    );
    expect(row.name).toBe('DSH 迁移');
  });

  it('标题服务抛错 ⇒ 退回首消息兜底（不让枚举整体失败）', () => {
    const row = toDshSessionRow(
      fakeSession('s3', '/w', [{ type: 'user/message', time: 5, data: userMsg('兜底标题') }]),
      {
        get: () => {
          throw new Error('boom');
        },
      },
    );
    expect(row.name).toBe('兜底标题');
  });

  it('没有消息 / 没有 header 字段时不崩，字段给安全值', () => {
    const row = toDshSessionRow({});
    expect(row.id).toBe('');
    expect(row.path).toBe('dsh-session:');
    expect(row.cwd).toBe('');
    expect(row.messageCount).toBe(0);
    expect(row.firstMessage).toBe('');
    expect(row.name).toBeUndefined();
  });
});

describe('listDshSessions', () => {
  const ctxWith = (sessions: unknown): DshContext => ({ sessions } as unknown as DshContext);

  it('会话服务缺失 ⇒ success:false + 原因（**不返回空表**）', () => {
    const r = listDshSessions({} as DshContext);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain('ctx.sessions.list');
  });

  it('list() 抛错 ⇒ success:false + 原因', () => {
    const r = listDshSessions(
      ctxWith({
        list: () => {
          throw new Error('存储不可用');
        },
      }),
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain('存储不可用');
  });

  it('按 modifiedMs 倒序；cwd 过滤生效', () => {
    const ctx = ctxWith({
      list: () => [
        fakeSession('old', '/a', [{ type: 'user/message', time: 10, data: userMsg('旧') }]),
        fakeSession('new', '/b', [{ type: 'user/message', time: 99, data: userMsg('新') }]),
      ],
    });
    const all = listDshSessions(ctx);
    expect(all.success).toBe(true);
    if (all.success) expect(all.data.map((r) => r.id)).toEqual(['new', 'old']);
    const filtered = listDshSessions(ctx, '/a');
    if (filtered.success) expect(filtered.data.map((r) => r.id)).toEqual(['old']);
  });
});
