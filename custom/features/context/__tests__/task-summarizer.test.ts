import { describe, it, expect } from 'vitest';
import { parseTaskRecords, groupSessions, isSubstantial, buildDigest } from '../../../../scripts/task-summarizer.mjs';
import type { TaskRec } from '../../../../scripts/task-summarizer.mjs';

const rec = (ts: number, tools: number, userRequest = 'req'): TaskRec => ({
  type: 'task',
  ts,
  userRequest,
  contextTokens: 100,
  cacheHit: 0,
  output: 0,
  tools,
  compacted: false,
  userSeq: 0,
});

describe('task-summarizer 纯逻辑', () => {
  it('parseTaskRecords 过滤非 task 与坏行并排序', () => {
    const raw = [JSON.stringify(rec(2, 1)), 'bad', JSON.stringify({ type: 'other', ts: 1 }), JSON.stringify(rec(1, 2))].join('\n');
    const r = parseTaskRecords(raw);
    expect(r.map((x) => x.ts)).toEqual([1, 2]);
  });

  it('groupSessions 按 8 分钟间隔切分', () => {
    const groups = groupSessions([rec(0, 1), rec(1000, 1), rec(1000 + 9 * 60 * 1000, 1)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].records).toHaveLength(2);
  });

  it('isSubstantial 只保留有工具调用的任务', () => {
    expect(isSubstantial(rec(0, 0))).toBe(false);
    expect(isSubstantial(rec(0, 1))).toBe(true);
  });

  it('buildDigest 汇总会话与任务', () => {
    const d = buildDigest([rec(0, 1, '任务A'), rec(1, 0, '空话'), rec(2, 2, '任务B')]);
    expect(d).toContain('2 条实质任务');
    expect(d).toContain('任务A');
    expect(d).toContain('任务B');
    expect(d).not.toContain('空话');
  });
});
