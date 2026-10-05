/**
 * autopilot 命令补全接线测试（命令层 → 纯逻辑）
 *
 * 纯逻辑由 `completions.test.ts` 覆盖；这里只钉住**命令层的接线**：
 *   - `/daily show|on|off|run` 的第二段确实来自 `tasks.json`（daily 标签集合）；
 *   - `/schedule run|delete|enable|disable|history` 来自全部任务；`edit <名> ` 补字段；
 *   - `/daily run <未知名>` 在派发前就报"未找到"（不会误起子进程）。
 *
 * 用临时运行时目录写一份最小 tasks.json，不触碰真实 `portable/`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { register } from '../index';

interface CompletionItem {
  value: string;
  label: string;
}
interface CapturedCommand {
  getArgumentCompletions?: (prefix: string) => CompletionItem[] | null;
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

function makeTask(over: Record<string, unknown>): Record<string, unknown> {
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
    nextRun: null,
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
    ...over,
  };
}

let tmp = '';
let cmds: Map<string, CapturedCommand>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'my-pi-commands-'));
  process.env.PI_MEMORY_DIR = join(tmp, 'memory');
  process.env.PI_CODING_AGENT_DIR = join(tmp, 'agent');
  const scheduler = join(tmp, 'memory', 'scheduler');
  mkdirSync(scheduler, { recursive: true });
  writeFileSync(
    join(scheduler, 'tasks.json'),
    JSON.stringify({
      version: 3,
      settings: {},
      tasks: [
        makeTask({ id: 'a1', name: 'golden-fast', nextRun: '2026-10-01T01:00:00.000Z' }),
        makeTask({ id: 'b2', name: 'tool-stats-daily', nextRun: '2026-10-01T02:00:00.000Z' }),
        makeTask({ id: 'c3', name: 'ad-hoc-backup', tags: ['ops'], nextRun: '2026-10-01T03:00:00.000Z' }),
      ],
    }),
    'utf-8',
  );
  cmds = new Map();
  register(makeFakePi(cmds) as unknown as ExtensionAPI);
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

const values = (items: CompletionItem[] | null): string[] => (items ?? []).map((i) => i.value);

describe('/daily 补全接线', () => {
  it('第二段补 daily 任务名（不含非 daily 任务）', () => {
    const daily = cmds.get('daily')!;
    expect(values(daily.getArgumentCompletions!('show '))).toEqual(['show golden-fast', 'show tool-stats-daily']);
    expect(values(daily.getArgumentCompletions!('show gol'))).toEqual(['show golden-fast']);
  });

  it('on/off/run 额外提供 all', () => {
    const daily = cmds.get('daily')!;
    expect(values(daily.getArgumentCompletions!('run '))).toEqual([
      'run all',
      'run golden-fast',
      'run tool-stats-daily',
    ]);
    expect(values(daily.getArgumentCompletions!('off all'))).toEqual(['off all']);
  });

  it('第一段仍是子命令补全', () => {
    const daily = cmds.get('daily')!;
    expect(values(daily.getArgumentCompletions!('ru'))).toEqual(['run ']);
  });

  it('/daily run <未知名> 派发前就报未找到（不起子进程）', async () => {
    const daily = cmds.get('daily')!;
    const notes: Array<[string, string]> = [];
    const ctx = { hasUI: true, ui: { notify: (t: string, l: string) => notes.push([t, l]) } };
    await daily.handler('run 不存在的任务', ctx);
    expect(notes).toHaveLength(1);
    expect(notes[0][0]).toContain('未找到每日任务');
    expect(notes[0][1]).toBe('warning');
  });
});

describe('/schedule 补全接线', () => {
  it('第二段补全部任务名（含非 daily）', () => {
    const schedule = cmds.get('schedule')!;
    expect(values(schedule.getArgumentCompletions!('run '))).toEqual([
      'run golden-fast',
      'run tool-stats-daily',
      'run ad-hoc-backup',
    ]);
    expect(values(schedule.getArgumentCompletions!('delete ad'))).toEqual(['delete ad-hoc-backup']);
  });

  it('edit：名字后补字段', () => {
    const schedule = cmds.get('schedule')!;
    expect(values(schedule.getArgumentCompletions!('edit golden-fast '))).toEqual([
      'edit golden-fast schedule',
      'edit golden-fast type',
      'edit golden-fast enabled',
      'edit golden-fast prompt',
    ]);
    expect(values(schedule.getArgumentCompletions!('edit gol'))).toEqual(['edit golden-fast']);
  });

  it('第一段是子命令补全', () => {
    const schedule = cmds.get('schedule')!;
    expect(values(schedule.getArgumentCompletions!('hi'))).toEqual(['history ']);
  });
});
