/**
 * schedule_task / verify_* 工具回归测试
 *
 * 迁移自 pi-tools pi-autopilot/tools.ts 的 4 个工具：
 * schedule_task / verify_report / verify_config / verify_test。
 * 文件系统用 mkdtemp 隔离（PI_MEMORY_DIR + PI_AUTOPILOT_CONFIG），不触碰真实数据。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeScheduleAction } from '../tools/schedule-tool';
import {
  applyVerifierConfigPatch,
  buildVerifierReport,
  computeVerifierReport,
  currentVerifierConfig,
  formatVerifierConfig,
  runVerifyTest,
} from '../tools/verify-tools';
import { listTasks, readTasks } from '../store/storage';
import type { VerificationRecord } from '../run/verifier-logger';

let dir: string;
let cfgPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-schverify-'));
  cfgPath = join(dir, 'config.json');
  process.env.PI_MEMORY_DIR = dir;
  process.env.PI_AUTOPILOT_CONFIG = cfgPath;
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_AUTOPILOT_CONFIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('schedule_task', () => {
  it('add/list/update/enable/disable/delete 全流程', async () => {
    const add = await executeScheduleAction({
      action: 'add',
      name: 'daily',
      type: 'interval',
      schedule: '5m',
      prompt: '巡检 {{date}}',
      tags: ['ops'],
      retries: 1,
    });
    expect(add).toContain('已创建任务: daily');
    expect(add).toContain('调度: 5m');
    expect(add).toContain('标签: ops');
    expect(listTasks()).toHaveLength(1);

    const list = await executeScheduleAction({ action: 'list' });
    expect(list).toContain('定时任务 (1)');
    expect(list).toContain('#ops');
    expect(list).toContain('巡检 {{date}}');

    const upd = await executeScheduleAction({ action: 'update', name: 'daily', prompt: '改为巡检 {{cwd}}' });
    expect(upd).toContain('已更新任务: daily');
    expect(listTasks()[0].prompt).toBe('改为巡检 {{cwd}}');

    const dis = await executeScheduleAction({ action: 'disable', name: 'daily' });
    expect(dis).toContain('已禁用任务: daily');
    expect(listTasks()[0].enabled).toBe(false);

    const en = await executeScheduleAction({ action: 'enable', name: 'daily' });
    expect(en).toContain('已启用任务: daily');
    expect(listTasks()[0].enabled).toBe(true);

    const del = await executeScheduleAction({ action: 'delete', name: 'daily' });
    expect(del).toContain('已删除任务: daily');
    expect(listTasks()).toHaveLength(0);
  });

  it('pause/resume 写入全局设置', async () => {
    expect(await executeScheduleAction({ action: 'pause' })).toContain('暂停');
    expect(readTasks().settings.paused).toBe(true);
    expect(await executeScheduleAction({ action: 'resume' })).toContain('恢复');
    expect(readTasks().settings.paused).toBe(false);
  });

  it('缺参/非法类型/非法调度/同名/未知操作返回可读错误', async () => {
    expect(await executeScheduleAction({ action: 'add', name: 'x', type: 'interval', schedule: '5m' })).toContain(
      '缺少参数',
    );
    expect(
      await executeScheduleAction({ action: 'add', name: 'x', type: 'week', schedule: '5m', prompt: 'p' }),
    ).toContain('无效任务类型');
    expect(
      await executeScheduleAction({ action: 'add', name: 'x', type: 'interval', schedule: 'abc', prompt: 'p' }),
    ).toContain('创建失败');
    await executeScheduleAction({ action: 'add', name: 'dup', type: 'interval', schedule: '5m', prompt: 'p' });
    expect(
      await executeScheduleAction({ action: 'add', name: 'dup', type: 'interval', schedule: '5m', prompt: 'p' }),
    ).toContain('创建失败');
    expect(await executeScheduleAction({ action: 'update', name: 'dup' })).toContain('未指定修改项');
    expect(await executeScheduleAction({ action: 'bogus' })).toContain('未知操作');
    expect(await executeScheduleAction({ action: 'delete', taskId: 'nope' })).toContain('未找到任务');
  });

  it('空列表输出', async () => {
    expect(await executeScheduleAction({ action: 'list' })).toBe('暂无定时任务');
  });
});

describe('verify_config', () => {
  it('未配置时返回默认（禁用、3 候选）', () => {
    const cfg = currentVerifierConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.nCandidates).toBe(3);
    expect(cfg.logLevel).toBe('summary');
  });

  it('applyVerifierConfigPatch 钳制范围并持久化，保留其它配置字段', () => {
    writeFileSync(cfgPath, JSON.stringify({ enabled: false, maxIdleMinutes: 42 }));
    const out = applyVerifierConfigPatch({ enabled: true, nCandidates: 9, threshold: 1.7, logLevel: 'full' });
    expect(out.enabled).toBe(true);
    expect(out.nCandidates).toBe(5);
    expect(out.threshold).toBe(1);
    expect(out.logLevel).toBe('full');

    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    expect(raw.maxIdleMinutes).toBe(42);
    expect((raw.verifier as Record<string, unknown>).nCandidates).toBe(5);
    // 再次读取走 readAutopilotConfig 的校验路径
    expect(currentVerifierConfig().enabled).toBe(true);
  });

  it('非法验证器字段被校验回退', () => {
    writeFileSync(
      cfgPath,
      JSON.stringify({ verifier: { enabled: 'yes', nCandidates: 99, threshold: 'x', logLevel: 'verbose' } }),
    );
    const cfg = currentVerifierConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.nCandidates).toBe(5);
    expect(cfg.threshold).toBe(0.6);
    expect(cfg.logLevel).toBe('summary');
  });

  it('formatVerifierConfig 输出关键字段', () => {
    const text = formatVerifierConfig(
      { enabled: true, nCandidates: 2, verifyAfter: 1, threshold: 0.5, maxCostPerVerify: 0.01, logLevel: 'none' },
      '已更新验证配置',
    );
    expect(text).toContain('已更新验证配置:');
    expect(text).toContain('enabled: true');
    expect(text).toContain('nCandidates: 2');
    expect(text).toContain('logLevel: none');
  });
});

function record(over: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    ts: new Date().toISOString(),
    epoch: Date.now(),
    taskId: 't1',
    taskName: 'task-a',
    nCandidates: 3,
    selectedIndex: 1,
    scores: [0.5, 0.9, 0.6],
    durationMs: 10,
    estCost: 0.02,
    baselineCost: 0.01,
    costMultiplier: 2,
    passed: true,
    reasoning: '',
    result: 'success',
    judgeModel: 'm',
    ...over,
  };
}

describe('verify_report', () => {
  it('无记录 → 暂无数据', () => {
    expect(buildVerifierReport()).toBe('验证统计：暂无数据');
  });

  it('computeVerifierReport 聚合通过率/成本倍数/边际收益/任务分布', () => {
    const stats = computeVerifierReport([
      record(),
      record({
        taskId: 't2',
        taskName: 'task-b',
        passed: false,
        result: 'failed',
        scores: [0.4, 0.7, 0.5],
        costMultiplier: 4,
      }),
    ]);
    expect(stats.total).toBe(2);
    expect(stats.passRate).toBe(0.5);
    expect(stats.avgCostMultiplier).toBe(3);
    expect(stats.avgScoreImprovement).toBeCloseTo(0.35, 5);
    expect(stats.successRateWithVerification).toBe(0.5);
    expect(stats.successRateWithoutVerification).toBe(0.5);
    expect(stats.marginalGain).toHaveLength(1);
    expect(stats.marginalGain[0]).toMatchObject({ n: 3, count: 2 });
    expect(stats.marginalGain[0].avgGain).toBeCloseTo(0.35, 5);
    expect(stats.byTask.map((t) => t.name).sort()).toEqual(['task-a', 'task-b']);
  });

  it('落盘 verifier.jsonl 后 buildVerifierReport 汇总', () => {
    mkdirSync(join(dir, 'scheduler'), { recursive: true });
    const lines = [record(), record({ passed: false, result: 'failed' })];
    writeFileSync(join(dir, 'scheduler', 'verifier.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const text = buildVerifierReport();
    expect(text).toContain('总验证次数: 2');
    expect(text).toContain('通过率: 50%');
    expect(text).toContain('边际收益');
    expect(text).toContain('按任务（Top 5）');
  });
});

describe('verify_test', () => {
  it('未启用 → 提示先启用', async () => {
    expect(await runVerifyTest('hello', 3)).toContain('验证功能未启用');
  });

  it('启用后注入评审函数 → 展示候选评分与最优', async () => {
    applyVerifierConfigPatch({ enabled: true, threshold: 0.6 });
    const out = await runVerifyTest('写一个函数', 3, {
      generate: async (p) => `候选:${p}`,
      judge: async (_p, candidates) =>
        candidates.map((_c, i) => ({ index: i, score: [0.3, 0.95, 0.6][i], reasoning: `理由${i + 1}` })),
    });
    expect(out).toContain('候选数: 3');
    expect(out).toContain('候选 2: 95.0% ← 最优');
    expect(out).toContain('通过: 是');
    expect(out).toContain('理由2');
  });

  it('未提供评审函数 → fail-open 回退；nCandidates 钳制到 2-5', async () => {
    applyVerifierConfigPatch({ enabled: true });
    const out = await runVerifyTest('x', 99, { generate: async () => 'c' });
    expect(out).toContain('候选数: 5');
    expect(out).toContain('fail-open');
  });
});
