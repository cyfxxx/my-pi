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
} from '../store/storage';
import { decide, selectFailover, checkBudget, errClassOf, statsByModel } from '../store/ops';
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
    const { buildRunArgs } = await import('../run/runner');
    const t = createTask({ name: 'x', type: 'interval', schedule: '5m', prompt: 'cwd={{cwd}}' });
    const args = buildRunArgs(t);
    expect(args).toContain('--mode');
    expect(args).toContain('json');
    expect(args).toContain('--no-extensions');
    expect(args[args.length - 1]).toContain('cwd=');
    expect(args[args.length - 1]).not.toContain('{{cwd}}');
  });

  it('extractRunOutput 取最后一条 assistant 文本', async () => {
    const { extractRunOutput } = await import('../run/runner');
    const lines = [
      JSON.stringify({ type: 'message_end', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'one' }] } }),
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'final' }] } }),
      'not json',
    ];
    expect(extractRunOutput(lines)).toBe('final');
  });
});

describe('watchdog 纯逻辑', () => {
  it('空闲判定与 busy 豁免', async () => {
    const wd = await import('../run/watchdog');
    wd.resetWatchdogState();
    expect(wd.isHanging(1)).toBe(false); // 刚活动
    wd.setTurnBusy(true);
    const now = Date.now() + 90 * 1000;
    expect(wd.isHanging(1, now)).toBe(false); // busy 宽限（2×maxIdle）
    wd.setTurnBusy(false);
    expect(wd.isHanging(0)).toBe(false); // maxIdle<=0
  });
});

describe('verifier 纯逻辑', () => {
  it('parseJudgeScores 解析候选分数并容错', async () => {
    const { parseJudgeScores } = await import('../run/verifier');
    const s = parseJudgeScores('候选1: 分数=0.8, 理由=好\n候选2: 分数=0.3, 理由=差', 2);
    expect(s[0].score).toBeCloseTo(0.8);
    expect(s[1].score).toBeCloseTo(0.3);
    const missing = parseJudgeScores('无格式', 2);
    expect(missing.every((x) => x.score === 0.5)).toBe(true);
  });

  it('selectBest / shouldVerify', async () => {
    const { selectBest, shouldVerify } = await import('../run/verifier');
    expect(selectBest([{ index: 0, score: 0.2, reasoning: '' }, { index: 1, score: 0.9, reasoning: '' }]).index).toBe(1);
    expect(shouldVerify(1, { enabled: true, nCandidates: 3, verifyAfter: 1, threshold: 0.6, maxCostPerVerify: 0.01, logLevel: 'summary' })).toBe(true);
    expect(shouldVerify(0, { enabled: true, nCandidates: 3, verifyAfter: 1, threshold: 0.6, maxCostPerVerify: 0.01, logLevel: 'summary' })).toBe(false);
  });

  it('ProgressTracker 评分与终止', async () => {
    const { ProgressTracker } = await import('../run/verifier');
    const p = new ProgressTracker(0.4);
    expect(p.currentScore()).toBe(0.5);
    p.step('read', '完成读取');
    expect(p.currentScore()).toBeGreaterThan(0.5);
    p.step('bash', 'error 失败');
    p.step('bash', 'error 失败');
    expect(p.shouldAbort()).toBe(true);
  });

  it('summarize 聚合', async () => {
    const { summarize } = await import('../run/verifier-logger');
    const base = {
      ts: new Date().toISOString(), epoch: Date.now(), taskId: '1', taskName: 't', nCandidates: 3,
      selectedIndex: 0, scores: [0.8, 0.5, 0.6], durationMs: 10, estCost: 0.02, baselineCost: 0.01,
      costMultiplier: 2, passed: true, reasoning: '', result: 'success' as const, judgeModel: 'm',
    };
    const s = summarize([base, { ...base, passed: false, result: 'failed' }]);
    expect(s.totalVerifications).toBe(2);
    expect(s.passRate).toBe(0.5);
    expect(s.avgCostMultiplier).toBe(2);
    expect(s.marginalGain[0].n).toBe(3);
  });
});

describe('metrics 仪表盘', () => {
  it('汇总干预/用量/任务三类指标', async () => {
    const { collectMetrics, formatMetrics } = await import('../store/metrics');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const now = Date.now();
    const md = join(dir, 'metrics-memory');
    mkdirSync(join(md, 'context'), { recursive: true });
    mkdirSync(join(md, 'scheduler'), { recursive: true });
    writeFileSync(join(md, 'interventions.jsonl'),
      JSON.stringify({ ts: new Date(now).toISOString(), correctivePrompt: 'fix' }) + '\n' +
      JSON.stringify({ ts: new Date(now).toISOString(), correctivePrompt: null }) + '\n');
    writeFileSync(join(md, 'context', 'usage.jsonl'),
      JSON.stringify({ ts: new Date(now).toISOString(), input: 100, cacheRead: 100 }) + '\n');
    writeFileSync(join(md, 'scheduler', 'telemetry.json'),
      JSON.stringify({ runs: [{ result: 'success' }, { result: 'failed' }] }));
    const d = collectMetrics(md, now);
    expect(d.interventions.total).toBe(2);
    expect(d.interventions.corrected).toBe(1);
    expect(d.interventions.linkRate).toBe(0.5);
    expect(d.usage.todayCount).toBe(1);
    expect(d.usage.cacheHitRate).toBeCloseTo(0.5, 3);
    expect(d.tasks.runs).toBe(2);
    expect(d.tasks.successRate).toBe(0.5);
    expect(formatMetrics(d)).toContain('缓存');
  });
});
