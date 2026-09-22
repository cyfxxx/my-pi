/**
 * autopilot 会话列表格式化测试（纯逻辑）
 */
import { describe, it, expect } from 'vitest';
import { formatSessionList, sortByModified, type SessionLike } from '../store/sessions';

function row(over: Partial<SessionLike> = {}): SessionLike {
  return {
    id: 'id-1',
    path: '/sessions/a.jsonl',
    cwd: '/root/my-pi',
    createdMs: 1000,
    modifiedMs: 2000,
    messageCount: 5,
    firstMessage: 'hello world',
    ...over,
  };
}

describe('sortByModified', () => {
  it('按修改时间倒序且不修改原数组', () => {
    const a = row({ id: 'a', modifiedMs: 100 });
    const b = row({ id: 'b', modifiedMs: 300 });
    const input = [a, b];
    expect(sortByModified(input).map((x) => x.id)).toEqual(['b', 'a']);
    expect(input.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('formatSessionList', () => {
  it('空列表提示', () => {
    expect(formatSessionList([])).toBe('(未找到会话)');
  });

  it('按修改时间倒序展示 id/消息数/摘要', () => {
    const out = formatSessionList([
      row({ id: 'old', modifiedMs: 100, firstMessage: 'old task' }),
      row({ id: 'new', modifiedMs: 900, firstMessage: 'new task' }),
    ]);
    expect(out).toContain('会话列表 (2 个');
    expect(out.indexOf('new')).toBeLessThan(out.indexOf('old'));
    expect(out).toContain('摘要: new task');
  });

  it('超 limit 截断并提示剩余', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `s${i}`, modifiedMs: i }));
    const out = formatSessionList(rows, 2);
    expect(out).toContain('还有 3 个未显示');
  });

  it('展示可读名称', () => {
    const out = formatSessionList([row({ id: 'x', name: '我的会话' })]);
    expect(out).toContain('x (我的会话)');
  });
});
