/**
 * autopilot 纯逻辑回归测试
 * 迁移自 pi-tools pi-autopilot/tests 的核心语义（调度解析/任务存储/策略/预算/failover）。
 * 使用临时 PI_MEMORY_DIR，不触碰真实数据。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cronNextRun,
  parseIntervalToMs,
  parseRelativeTime,
  formatInterval,
  createTask,
  addTask,
  listTasks,
  deleteTask,
  updateTask,
  updateTaskAfterRun,
  computeNextRun,
  previewCron,
} from '../storage';
import { decide, selectFailover, checkBudget, errClassOf, statsByModel } from '../ops';
import type { Task, FallbackModel } from '../types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-autopilot-'));
  process.env.PI_MEMORY_DIR = dir;
});
afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('调度表达式', () => {
  it('interval / relative 解析', () => {
    expect(parseIntervalToMs('5m')).toBe(5 * 60 * 1000);
    expect(parseIntervalToMs('1h')).toBe(3600 * 1000);
    expect(parseRelativeTime('+30m')).toBe(30 * 60 * 1000);
    expect(parseIntervalToMs('abc')).toBeNull();
    expect(formatInterval(3600 * 1000)).toBe('1h');
  });

  it('cronNextRun：*/5 落在 5 分钟整点', () => {
    const from = new Date('2026-01-01T10:02:00');
    const next = cronNextRun('*/5 * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getMinutes() % 5).toBe(0);
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
    expect(next!.getTime() - from.getTime()).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('cronNextRun：工作日 9 点', () => {
    const next = cronNextRun('0 9 * * 1-5', new Date('2026-01-01T00:00:00'));
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(9);
    const dow = next!.getDay();
    expect(dow).toBeGreaterThanOrEqual(1);
    expect(dow).toBeLessThanOrEqual(5);
  });

  it('无效 cron → null；previewCron 抛错', () => {
    expect(cronNextRun('bad expr here')).toBeNull();
    expect(() => previewCron('not a cron')).toThrow();
    expect(previewCron('*/10 * * * *', 3)).toHaveLength(3);
  });

  it('once 任务用 ISO 时间', () => {
    const t = createTask({ name: 'x', type: 'once', schedule: '2030-01-01T00:00:00.000Z', prompt: 'p' });
    expect(t.nextRun).toBe('2030-01-01T00:00:00.000Z');
  });

  it('无效调度 → createTask 抛错', () => {
    expect(() => createTask({ name: 'x', type: 'interval', schedule: 'abc', prompt: 'p' })).toThrow();
  });
});

describe('任务存储', () => {
  it('add/list/update/delete', async () => {
    const t = await addTask({ name: 'a', type: 'interval', schedule: '5m', prompt: 'do' });
    expect(listTasks()).toHaveLength(1);
    await expect(addTask({ name: 'a', type: 'interval', schedule: '5m', prompt: 'do' })).rejects.toThrow();

    const upd = await updateTask('a', { enabled: false });
    expect(upd?.enabled).toBe(false);

    const ok = await deleteTask(t.id);
    expect(ok).toBe(true);
    expect(listTasks()).toHaveLength(0);
  });

  it('updateTaskAfterRun：成功后 failCount 归零、runCount++', async () => {
    const t = await addTask({ name: 'b', type: 'interval', schedule: '5m', prompt: 'do' });
    await updateTaskAfterRun(t.id, 'failed', 'boom');
    let cur = listTasks()[0];
    expect(cur.failCount).toBe(1);
    await updateTaskAfterRun(t.id, 'success', 'ok');
    cur = listTasks()[0];
    expect(cur.failCount).toBe(0);
    // 失败（无重试额度）与成功各计一次 runCount
    expect(cur.runCount).toBe(2);
    expect(cur.lastResult).toBe('success');
  });

  it('once 任务成功后移除', async () => {
    const t = await addTask({ name: 'c', type: 'once', schedule: '+1h', prompt: 'do' });
    await updateTaskAfterRun(t.id, 'success', 'ok');
    expect(listTasks()).toHaveLength(0);
  });
});

describe('策略决策 decide', () => {
  const info = { stderr: '', exitCode: 1, promptLen: 10, outputLen: 10, durationMs: 1000 };
  function task(over: Partial<Task> = {}): Task {
    return { ...createTask({ name: 't', type: 'interval', schedule: '5m', prompt: 'p' }), ...over };
  }
  const fb: FallbackModel[] = [{ provider: 'p2', model: 'm2' }];

  it('鉴权错误/逻辑错误 → fail', () => {
    expect(decide(task(), 'logic_error', {}, [], { ...info, stderr: '401 unauthorized' }).type).toBe('fail');
    expect(decide(task(), 'logic_error', {}, [], info).type).toBe('fail');
  });

  it('provider_down 未达阈值且有重试额度 → retry', () => {
    const r = decide(task({ failCount: 1, retries: 3 }), 'provider_down', { failoverAfter: 2 }, fb, info);
    expect(r.type).toBe('retry');
  });

  it('provider_down 达阈值 + 有 fallback → failover', () => {
    const r = decide(task({ failCount: 2 }), 'provider_down', { failoverAfter: 2 }, fb, info);
    expect(r.type).toBe('failover');
  });

  it('failover 熔断 → suspend', () => {
    const r = decide(task({ failCount: 2, failoverCount: 1 }), 'provider_down', { failoverAfter: 2, maxFailovers: 1 }, fb, info);
    expect(r.type).toBe('suspend_task');
  });

  it('未知错误连续失败达 suspendAfter → suspend', () => {
    const r = decide(task({ failCount: 5 }), 'unknown', { suspendAfter: 5 }, [], info);
    expect(r.type).toBe('suspend_task');
  });
});

describe('failover / budget / 遥测', () => {
  it('selectFailover 跳过当前模型并优先同 provider', () => {
    const chain: FallbackModel[] = [
      { provider: 'cur', model: 'm' },
      { provider: 'cur', model: 'm2' },
      { provider: 'other', model: 'z' },
    ];
    const t = selectFailover(chain, 'cur', 'm');
    expect(t?.model).toBe('m2');
  });

  it('checkBudget 次数/模型白名单', () => {
    expect(checkBudget({ maxRunsPerDay: 0 }, 'any').allowed).toBe(false);
    expect(checkBudget({ maxRunsPerDay: 10, allowedModels: ['m1'] }, 'prov/m1').allowed).toBe(true);
    expect(checkBudget({ maxRunsPerDay: 10, allowedModels: ['m1'] }, 'prov/m2').allowed).toBe(false);
  });

  it('errClassOf 分类', () => {
    expect(errClassOf('', 124)).toBe('timeout');
    expect(errClassOf('connection refused', 1)).toBe('provider_down');
    expect(errClassOf('invalid argument', 1)).toBe('logic_error');
  });

  it('statsByModel 聚合成功率', () => {
    const stats = statsByModel([
      { ts: new Date().toISOString(), taskId: '1', taskName: 't', model: 'm', provider: 'p', result: 'success', durationMs: 1, outputLen: 1, estCost: 0, errClass: null },
      { ts: new Date().toISOString(), taskId: '1', taskName: 't', model: 'm', provider: 'p', result: 'failed', durationMs: 1, outputLen: 1, estCost: 0, errClass: 'unknown' },
    ]);
    expect(stats[0].runs).toBe(2);
    expect(stats[0].successRate).toBe(0.5);
  });
});

describe('computeNextRun 不变量', () => {
  it('interval 有 nextRun', () => {
    const t = createTask({ name: 'x', type: 'interval', schedule: '10m', prompt: 'p' });
    expect(computeNextRun(t)).not.toBeNull();
  });
});

describe('runner 纯函数', () => {
  it('buildRunArgs 含 json 模式标志并渲染 prompt 变量', async () => {
    const { buildRunArgs } = await import('../runner');
    const t = createTask({ name: 'x', type: 'interval', schedule: '5m', prompt: 'cwd={{cwd}}' });
    const args = buildRunArgs(t);
    expect(args).toContain('--mode');
    expect(args).toContain('json');
    expect(args).toContain('--no-extensions');
    expect(args[args.length - 1]).toContain('cwd=');
    expect(args[args.length - 1]).not.toContain('{{cwd}}');
  });

  it('extractRunOutput 取最后一条 assistant 文本', async () => {
    const { extractRunOutput } = await import('../runner');
    const lines = [
      JSON.stringify({ type: 'message_end', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'one' }] } }),
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'final' }] } }),
      'not json',
    ];
    expect(extractRunOutput(lines)).toBe('final');
  });
});
