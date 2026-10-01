/**
 * /daily 视图纯逻辑测试
 *
 * 关注点：每日任务筛选（含无标签降级）、cron 时刻解析的保守边界、今日进度口径、
 * 以及概览里「上次失败」提示——这些都会直接显示给用户，错一位数就会误导排查方向。
 */
import { describe, it, expect } from 'vitest';
import {
  DAILY_TAG,
  selectDailyTasks,
  cronClock,
  shortTime,
  formatDuration,
  relativeTime,
  formatDailyLine,
  formatDailyOverview,
  formatDailyDetail,
} from '../daily';
import type { Task } from '../types';

/** 固定"当前时间"：2026-10-01 10:00 本地时间，避免测试随真实时钟漂移 */
const NOW = new Date(2026, 9, 1, 10, 0, 0);

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'golden-fast',
    type: 'cron',
    schedule: '30 7 * * *',
    prompt: '执行 golden --fast',
    enabled: true,
    lastRun: null,
    lastResult: null,
    lastOutput: '',
    nextRun: new Date(2026, 9, 2, 7, 30, 0).toISOString(),
    useSubagent: true,
    notifyOnCompletion: false,
    maxRunTime: 600,
    runCount: 0,
    history: [],
    tags: [DAILY_TAG, 'golden'],
    retries: 1,
    failCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('selectDailyTasks', () => {
  it('按 daily 标签筛选', () => {
    const daily = makeTask({ id: 'a' });
    const other = makeTask({ id: 'b', name: 'ad-hoc', tags: ['ops'] });
    const sel = selectDailyTasks([daily, other]);
    expect(sel.byTag).toBe(true);
    expect(sel.tasks.map((t) => t.id)).toEqual(['a']);
  });

  it('无任何 daily 标签时降级为全部任务并标记 byTag=false', () => {
    const a = makeTask({ id: 'a', tags: [] });
    const b = makeTask({ id: 'b', name: 'ad-hoc', tags: ['ops'] });
    const sel = selectDailyTasks([a, b]);
    expect(sel.byTag).toBe(false);
    expect(sel.tasks).toHaveLength(2);
  });

  it('tags 缺失（旧数据）不抛异常', () => {
    const legacy = makeTask({ id: 'a', tags: undefined as unknown as string[] });
    expect(selectDailyTasks([legacy]).tasks).toHaveLength(1);
  });
});

describe('cronClock', () => {
  it('纯数字分钟/小时的每日 cron → HH:MM', () => {
    expect(cronClock('30 23 * * *')).toBe('23:30');
    expect(cronClock('0 0 * * *')).toBe('00:00');
    expect(cronClock('5 9 * * *')).toBe('09:05');
  });

  it('含步进/区间/星期限定/非 5 字段 → null（回落原表达式，不假装读懂）', () => {
    expect(cronClock('*/5 * * * *')).toBeNull();
    expect(cronClock('0 9 * * 1-5')).toBeNull();
    expect(cronClock('0 9 1 * *')).toBeNull();
    expect(cronClock('0 9 * *')).toBeNull();
    expect(cronClock('60 9 * * *')).toBeNull();
    expect(cronClock('0 24 * * *')).toBeNull();
  });
});

describe('时间格式化', () => {
  it('shortTime：同日只给 HH:MM，跨日带 MM-DD', () => {
    expect(shortTime(new Date(2026, 9, 1, 7, 31).toISOString(), NOW)).toBe('07:31');
    expect(shortTime(new Date(2026, 8, 30, 19, 12).toISOString(), NOW)).toBe('09-30 19:12');
    expect(shortTime(null, NOW)).toBe('-');
    expect(shortTime('not-a-date', NOW)).toBe('-');
  });

  it('formatDuration：秒/分/时', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(90_000)).toBe('1.5m');
    expect(formatDuration(7_500_000)).toBe('2h05m');
    expect(formatDuration(undefined)).toBe('-');
  });

  it('relativeTime：过去/未来', () => {
    expect(relativeTime(new Date(2026, 9, 1, 10, 12).toISOString(), NOW)).toBe('12m 后');
    expect(relativeTime(new Date(2026, 9, 1, 7, 0).toISOString(), NOW)).toBe('3h 前');
    expect(relativeTime(null, NOW)).toBe('-');
  });
});

describe('formatDailyLine', () => {
  it('成功任务：一行含时间/上次结果/下次/成败计数', () => {
    const t = makeTask({
      lastRun: new Date(2026, 8, 30, 19, 12).toISOString(),
      lastResult: 'success',
      runCount: 9,
      failCount: 0,
      history: [{ time: new Date(2026, 8, 30, 19, 12).toISOString(), result: 'success', output: 'ok', durationMs: 90_000 }],
    });
    const line = formatDailyLine(t, NOW);
    expect(line).toContain('●');
    expect(line).toContain('07:30');
    expect(line).toContain('golden-fast');
    expect(line).toContain('09-30 19:12 ✓ 成功 1.5m');
    expect(line).toContain('成 9/失 0');
  });

  it('禁用任务：下次显示「已禁用」而非残留的 nextRun', () => {
    const t = makeTask({
      enabled: false,
      lastRun: new Date(2026, 9, 1, 7, 31).toISOString(),
      lastResult: 'failed',
      failCount: 2,
    });
    const line = formatDailyLine(t, NOW);
    expect(line).toContain('○');
    expect(line).toContain('下次 已禁用');
    expect(line).toContain('✗ 失败');
  });

  it('从未执行：显示「未跑过」', () => {
    expect(formatDailyLine(makeTask(), NOW)).toContain('上次 未跑过');
  });
});

describe('formatDailyOverview', () => {
  it('今日进度：完成/待跑/失败按本地日期统计', () => {
    const done = makeTask({
      id: 'a',
      name: 'golden-fast',
      lastRun: new Date(2026, 9, 1, 7, 31).toISOString(),
      lastResult: 'success',
      runCount: 9,
    });
    const failed = makeTask({
      id: 'b',
      name: 'daily-health',
      schedule: '50 7 * * *',
      lastRun: new Date(2026, 9, 1, 7, 51).toISOString(),
      lastResult: 'failed',
      failCount: 1,
    });
    const pending = makeTask({ id: 'c', name: 'daily-review', schedule: '5 9 * * *' });
    const out = formatDailyOverview(
      [done, failed, pending],
      { autopilotEnabled: true, paused: false, byTag: true },
      NOW,
    );
    expect(out).toContain('每日任务 3 个 · 启用 3 · 禁用 0');
    expect(out).toContain('今日 10-01：完成 1 · 待跑 1 · 失败 1');
    expect(out).toContain('调度器 运行中 · 自动驾驶 启用');
    expect(out).toContain('注意：上次失败的每日任务 daily-health');
  });

  it('昨天的成功不计入今日完成', () => {
    const yesterday = makeTask({
      lastRun: new Date(2026, 8, 30, 7, 31).toISOString(),
      lastResult: 'success',
    });
    const out = formatDailyOverview([yesterday], { autopilotEnabled: false, paused: true, byTag: true }, NOW);
    expect(out).toContain('完成 0 · 待跑 1 · 失败 0');
    expect(out).toContain('调度器 已暂停 · 自动驾驶 禁用');
  });

  it('降级模式在标题里说明，避免用户以为任务丢了', () => {
    const out = formatDailyOverview([makeTask({ tags: [] })], { autopilotEnabled: true, paused: false, byTag: false }, NOW);
    expect(out).toContain('调度任务（无 daily 标签，已显示全部）');
  });

  it('已禁用任务不计入今日进度，也不产生失败提示（否则"完成+待跑+失败"与启用数对不上）', () => {
    const disabled = makeTask({
      id: 'd',
      name: 'old-task',
      enabled: false,
      lastRun: new Date(2026, 9, 1, 6, 0).toISOString(),
      lastResult: 'failed',
      failCount: 1,
    });
    const out = formatDailyOverview([disabled], { autopilotEnabled: true, paused: false, byTag: true }, NOW);
    expect(out).toContain('启用 0 · 禁用 1');
    expect(out).toContain('完成 0 · 待跑 0 · 失败 0');
    expect(out).not.toContain('注意：上次失败');
  });

  it('无任务时不崩', () => {
    const out = formatDailyOverview([], { autopilotEnabled: true, paused: false, byTag: true }, NOW);
    expect(out).toContain('每日任务 0 个');
    expect(out).toContain('(无)');
  });
});

describe('formatDailyDetail', () => {
  it('含调度/下次/统计/标签与最近执行、提示词摘要', () => {
    const t = makeTask({
      lastRun: new Date(2026, 9, 1, 7, 31).toISOString(),
      lastResult: 'success',
      runCount: 9,
      history: [
        { time: new Date(2026, 9, 1, 7, 31).toISOString(), result: 'success', output: 'first\nline ok', durationMs: 90_000 },
      ],
    });
    const out = formatDailyDetail(t, NOW);
    expect(out).toContain('已启用  golden-fast  [cron:30 7 * * * = 07:30]');
    expect(out).toContain('下次');
    expect(out).toContain('成功 9 · 连续失败 0 · 重试 1 · 超时 600s · 标签 daily,golden');
    expect(out).toContain('最近执行：');
    expect(out).toContain('07:31 ✓ 1.5m  first line ok');
    expect(out).toContain('提示词：执行 golden --fast');
  });

  it('复杂 cron 原样显示且提示词超长截断', () => {
    const t = makeTask({ schedule: '0 9 * * 1-5', prompt: 'x'.repeat(300) });
    const out = formatDailyDetail(t, NOW);
    expect(out).toContain('[cron:0 9 * * 1-5]');
    expect(out).not.toContain('= 09:00');
    expect(out).toContain('…');
  });
});
