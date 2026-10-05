/**
 * 手动执行（`/daily run`、`/schedule run`）端到端接线测试
 *
 * `runTaskOnce` 会真的起 `pi` 子进程（分钟级），故这里 mock 掉它，只验证命令层的行为契约：
 *   - 立即派发，后台执行不阻塞命令；
 *   - 结果落到 tasks.json（lastResult/history/runCount）与 telemetry.json；
 *   - 结束后释放调度锁（不阻塞后续定时轮次）；
 *   - 汇报里带输出预览与汇总。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { register } from '../index';

const runner = vi.hoisted(() => ({ runTaskOnce: vi.fn() }));
vi.mock('../run/runner', () => ({ runTaskOnce: runner.runTaskOnce }));

interface CapturedCommand {
  handler: (args: string, ctx: unknown) => Promise<void>;
}

/** 覆盖 autopilot 注册期会用到的 adapters/pi 出口（同 tools-payload 的假 pi） */
function makeFakePi(cmds: Map<string, CapturedCommand>): unknown {
  return {
    registerTool: () => {},
    registerCommand: (name: string, opts: CapturedCommand) => {
      cmds.set(name, opts);
    },
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    on: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
}

let tmp = '';
let scheduler = '';
let notes: Array<[string, string]>;
let cmds: Map<string, CapturedCommand>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'my-pi-manual-run-'));
  process.env.PI_MEMORY_DIR = join(tmp, 'memory');
  process.env.PI_CODING_AGENT_DIR = join(tmp, 'agent');
  scheduler = join(tmp, 'memory', 'scheduler');
  mkdirSync(scheduler, { recursive: true });
  writeFileSync(
    join(scheduler, 'tasks.json'),
    JSON.stringify({
      version: 3,
      settings: {},
      tasks: [
        {
          id: 'a1',
          name: 'golden-fast',
          type: 'cron',
          schedule: '30 7 * * *',
          prompt: '执行 golden --fast',
          enabled: true,
          lastRun: null,
          lastResult: null,
          lastOutput: '',
          nextRun: '2030-01-01T00:00:00.000Z',
          useSubagent: false,
          notifyOnCompletion: false,
          maxRunTime: 300,
          runCount: 0,
          history: [],
          tags: ['daily'],
          retries: 0,
          failCount: 0,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    }),
    'utf-8',
  );
  runner.runTaskOnce.mockReset();
  runner.runTaskOnce.mockResolvedValue({
    result: 'success',
    output: 'ok-output',
    exitCode: 0,
    durationMs: 5,
    stderr: '',
  });
  notes = [];
  cmds = new Map();
  register(makeFakePi(cmds) as unknown as ExtensionAPI);
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

const ctx = () => ({
  hasUI: true,
  ui: { notify: (t: string, l: string) => notes.push([t, l]) },
  sessionManager: { getSessionFile: () => undefined },
});

describe('手动执行接线', () => {
  it('/daily run <名>：后台执行、落账、释放锁并汇报结果', async () => {
    await cmds.get('daily')!.handler('run golden-fast', ctx());

    expect(runner.runTaskOnce).toHaveBeenCalledTimes(1);
    expect((runner.runTaskOnce.mock.calls[0][0] as { name: string }).name).toBe('golden-fast');

    await vi.waitFor(() => {
      expect(notes.some((n) => n[0].includes('手动执行结束'))).toBe(true);
    });

    // 汇报：开始有"后台运行"，结束带输出预览与汇总
    expect(notes.some((n) => n[0].includes('后台运行'))).toBe(true);
    expect(notes.some((n) => n[0].includes('ok-output'))).toBe(true);
    expect(notes.find((n) => n[0].includes('手动执行结束'))![0]).toContain('golden-fast: 成功');

    // 落账：tasks.json 与 telemetry.json
    const store = JSON.parse(readFileSync(join(scheduler, 'tasks.json'), 'utf-8')) as {
      tasks: Array<{ lastResult: string | null; runCount: number; history: unknown[] }>;
    };
    expect(store.tasks[0].lastResult).toBe('success');
    expect(store.tasks[0].runCount).toBe(1);
    expect(store.tasks[0].history).toHaveLength(1);
    const telemetry = JSON.parse(readFileSync(join(scheduler, 'telemetry.json'), 'utf-8')) as {
      runs: Array<{ taskName: string; result: string }>;
    };
    expect(telemetry.runs).toHaveLength(1);
    expect(telemetry.runs[0]).toMatchObject({ taskName: 'golden-fast', result: 'success' });

    // 调度锁已释放，后续定时轮次可继续
    expect(existsSync(join(scheduler, 'scheduler.lock'))).toBe(false);
  });

  it('/schedule run <名> 同样可用；不存在的名字在派发前就报未找到', async () => {
    const schedule = cmds.get('schedule')!;

    await schedule.handler('run 不存在', ctx());
    expect(runner.runTaskOnce).not.toHaveBeenCalled();
    expect(notes.some((n) => n[0].includes('未找到任务'))).toBe(true);

    await schedule.handler('run golden-fast', ctx());
    expect(runner.runTaskOnce).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(notes.some((n) => n[0].includes('手动执行结束'))).toBe(true);
    });
  });
});
