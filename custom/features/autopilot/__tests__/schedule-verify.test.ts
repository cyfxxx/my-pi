/**
 * schedule_task / verify_* 工具回归测试
 *
 * 迁移自 pi-tools pi-autopilot/tools.ts 的 4 个工具：
 * schedule_task / verify_report / verify_config / verify_test。
 * 文件系统用 mkdtemp 隔离（PI_MEMORY_DIR + PI_AUTOPILOT_CONFIG），不触碰真实数据。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeScheduleAction } from '../tools/schedule-tool';
import { listTasks, readTasks } from '../store/storage';

// 2026-10-08：verify_config / verify_report / verify_test 三个工具已删除（见 DECISIONS 与
// docs/design/TOOL-BUDGET-DECISION.md），本文件只保留 schedule_task 的覆盖。
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
