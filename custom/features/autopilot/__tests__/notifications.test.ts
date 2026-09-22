import { describe, it, expect } from 'vitest';
import { parseResults, formatSummary } from '../store/notifications';

describe('autopilot 离线执行报告', () => {
  it('parseResults 容忍损坏行并排序', () => {
    const raw = [
      '{"ts":"2026-09-22T01:00:00.000Z","taskName":"a","result":"failed","output":"boom"}',
      'not json',
      '{"ts":"2026-09-22T02:00:00.000Z","taskName":"b","result":"success","output":"ok"}',
      '',
    ].join('\n');
    const r = parseResults(raw);
    expect(r).toHaveLength(2);
    expect(r[0].taskName).toBe('a');
    expect(r[1].taskName).toBe('b');
  });

  it('formatSummary 空输入返回空串，否则含图标与标题', () => {
    expect(formatSummary([])).toBe('');
    const s = formatSummary([{ ts: 1, taskName: 'x', result: 'success', output: 'done' }]);
    expect(s).toContain('离线期间任务执行报告');
    expect(s).toContain('✓ x — success');
    expect(s).toContain('done');
  });
});
