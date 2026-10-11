/**
 * 「上次结果」渲染的诚实性测试
 *
 * 回归目标：`lastResult` 只有 `success` 才算成功。`null`（从未运行，见
 * `store/storage.ts` 的归一化）与未知字符串必须显示「— 未记录」，
 * **绝不能显示成「✓ 成功」**——那是"说谎的状态"：没跑过却报成功，
 * 会直接把排障方向带偏（真实案例：`tool-stats-daily` 带 `lastRun` 而结果为空）。
 */
import { describe, it, expect } from 'vitest';
import { formatDailyLine, formatDailyOverview } from '../daily';
import { DAILY_TAG } from '../daily';
import type { Task } from '../types';

/** 固定"当前时间"：2026-10-01 10:00 本地时间，避免测试随真实时钟漂移 */
const NOW = new Date(2026, 9, 1, 10, 0, 0);

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'tool-stats-daily',
    type: 'cron',
    schedule: '30 23 * * *',
    prompt: '执行工具统计每日聚合',
    enabled: true,
    lastRun: null,
    lastResult: null,
    lastOutput: '',
    nextRun: new Date(2026, 9, 2, 23, 30, 0).toISOString(),
    useSubagent: true,
    notifyOnCompletion: false,
    maxRunTime: 600,
    runCount: 0,
    history: [],
    tags: [DAILY_TAG],
    retries: 1,
    failCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** 修复前的实现（"非 failed 即成功"）——用于反向断言，证明新实现确有分辨力 */
function lyingMark(result: Task['lastResult']): string {
  return result === 'failed' ? '✗ 失败' : '✓ 成功';
}

describe('上次结果渲染：三分支不允许说谎', () => {
  it('success ⇒ ✓ 成功', () => {
    const line = formatDailyLine(makeTask({ lastRun: '2026-09-30T19:12:00.000Z', lastResult: 'success' }), NOW);
    expect(line).toContain('✓ 成功');
    expect(line).not.toContain('未记录');
  });

  it('failed ⇒ ✗ 失败', () => {
    const line = formatDailyLine(makeTask({ lastRun: '2026-09-30T19:12:00.000Z', lastResult: 'failed' }), NOW);
    expect(line).toContain('✗ 失败');
    expect(line).not.toContain('✓ 成功');
  });

  it('★ null（从未运行）⇒ — 未记录，绝不显示成功', () => {
    const line = formatDailyLine(makeTask({ lastRun: '2026-09-30T19:12:00.000Z', lastResult: null }), NOW);
    expect(line).toContain('— 未记录');
    expect(line).not.toContain('✓ 成功');
    expect(line).not.toContain('✗ 失败');
  });

  it('未知字符串（历史脏数据）⇒ — 未记录，绝不显示成功', () => {
    const dirty = 'aborted' as unknown as Task['lastResult'];
    const line = formatDailyLine(makeTask({ lastRun: '2026-09-30T19:12:00.000Z', lastResult: dirty }), NOW);
    expect(line).toContain('— 未记录');
    expect(line).not.toContain('✓ 成功');
  });

  it('★ 反向断言：修复前的实现在 null 上必然给出"✓ 成功"，与现实现不一致', () => {
    const t = makeTask({ lastRun: '2026-09-30T19:12:00.000Z', lastResult: null });
    const line = formatDailyLine(t, NOW);
    // 旧实现会把 null 渲染成成功 ⇒ 这正是本测试要防的缺陷
    expect(lyingMark(t.lastResult)).toBe('✓ 成功');
    expect(line).not.toContain(lyingMark(t.lastResult));
    // 同时确认"未跑过"（真的没有 lastRun）与"未记录"是两种不同状态
    expect(formatDailyLine(makeTask({ lastRun: null, lastResult: null }), NOW)).toContain('上次 未跑过');
  });

  it('null 不计入今日失败，也不出现在"上次失败"提示里', () => {
    const out = formatDailyOverview(
      [makeTask({ lastRun: new Date(2026, 9, 1, 9, 0, 0).toISOString(), lastResult: null })],
      { autopilotEnabled: true, paused: false, byTag: true },
      NOW,
    );
    expect(out).toContain('完成 0 · 待跑 1 · 失败 0');
    expect(out).not.toContain('注意：上次失败的每日任务');
  });
});
