/**
 * autopilot 命令补全纯逻辑测试
 *
 * 关注点（都是"敲错就误操作"的地方）：
 *   1. 任务名按前缀过滤（name 与 id 都认），不匹配时返回 null（pi 约定无补全）；
 *   2. `value` 是**整段参数文本**（`<子命令> <任务名>`），因为 pi-tui 用 argumentPrefix
 *      整体替换；只给任务名会把子命令冲掉；
 *   3. `all` 之类固定候选只在匹配时出现；
 *   4. `edit` 的字段补全与"名字后是否有空格"的区分。
 */
import { describe, it, expect } from 'vitest';
import { taskNameCompletions, editFieldCompletions, splitArgument } from '../completions';
import type { Task } from '../types';

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
    nextRun: null,
    useSubagent: true,
    notifyOnCompletion: false,
    maxRunTime: 600,
    runCount: 0,
    history: [],
    tags: ['daily'],
    retries: 1,
    failCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('taskNameCompletions', () => {
  const tasks = [
    makeTask({ id: 'a1', name: 'golden-fast' }),
    makeTask({ id: 'b2', name: 'tool-stats-daily', enabled: false }),
    makeTask({ id: 'c3', name: 'memory-lifecycle' }),
  ];

  it('value 带全整段参数（子命令 + 任务名）', () => {
    const items = taskNameCompletions(tasks, 'show', 'gold');
    expect(items).not.toBeNull();
    expect(items![0].value).toBe('show golden-fast');
    expect(items![0].label).toBe('golden-fast');
  });

  it('按 name 前缀过滤，命中的任务才出现', () => {
    const items = taskNameCompletions(tasks, 'run', 'tool');
    expect(items!.map((i) => i.label)).toEqual(['tool-stats-daily']);
  });

  it('按 id 前缀也能命中', () => {
    const items = taskNameCompletions(tasks, 'show', 'c3');
    expect(items!.map((i) => i.value)).toEqual(['show memory-lifecycle']);
  });

  it('空前缀列出全部，已禁用任务在 description 标注', () => {
    const items = taskNameCompletions(tasks, 'run', '');
    expect(items!.map((i) => i.label)).toEqual(['golden-fast', 'tool-stats-daily', 'memory-lifecycle']);
    expect(items!.find((i) => i.label === 'tool-stats-daily')!.description).toContain('[已禁用]');
  });

  it('无命中返回 null（pi 约定：null = 无补全）', () => {
    expect(taskNameCompletions(tasks, 'show', 'zzz')).toBeNull();
  });

  it('extras（all）参与过滤并带说明', () => {
    const items = taskNameCompletions(tasks, 'run', 'al', ['all']);
    expect(items!.map((i) => i.value)).toEqual(['run all']);
    expect(items![0].description).toBe('全部任务');
    expect(taskNameCompletions(tasks, 'run', 'zz', ['all'])).toBeNull();
  });
});

describe('editFieldCompletions', () => {
  it('value 带全 `edit <名> <字段>`，按前缀过滤', () => {
    const items = editFieldCompletions('edit', 'golden-fast', 's');
    expect(items!.map((i) => i.value)).toEqual(['edit golden-fast schedule']);
  });

  it('空前缀列出全部字段', () => {
    expect(editFieldCompletions('edit', 't', '')!.map((i) => i.label)).toEqual([
      'schedule',
      'type',
      'enabled',
      'prompt',
    ]);
  });

  it('无命中返回 null', () => {
    expect(editFieldCompletions('edit', 't', 'zzz')).toBeNull();
  });
});

describe('splitArgument', () => {
  it('拆出小写子命令与其余文本', () => {
    expect(splitArgument('SHOW gol')).toEqual({ sub: 'show', rest: 'gol', hasTrailingSpace: false });
  });

  it('保留尾部空格标记（用于 edit 的名字→字段切换）', () => {
    expect(splitArgument('edit golden-fast ')).toEqual({
      sub: 'edit',
      rest: 'golden-fast',
      hasTrailingSpace: true,
    });
    expect(splitArgument('edit golden-fast')).toEqual({
      sub: 'edit',
      rest: 'golden-fast',
      hasTrailingSpace: false,
    });
  });

  it('空输入不炸', () => {
    expect(splitArgument('')).toEqual({ sub: '', rest: '', hasTrailingSpace: false });
  });
});
