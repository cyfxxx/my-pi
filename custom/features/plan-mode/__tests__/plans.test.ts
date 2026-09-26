/**
 * 计划落盘（plans）测试：渲染/解析往返、格式校验、清理、磁盘恢复
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderPlanFile,
  parsePlanFile,
  writePlanFile,
  listPlans,
  cleanupOldPlans,
  restoreStateFromPlans,
  findActivePlan,
  removePlan,
  syncPlanFile,
  plansDir,
  planDirPath,
  MAX_PLANS,
  MAX_RESTORE_AGE_MS,
} from '../core/plans';
import type { Task, TaskState } from '../core/state';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-plans-'));
  process.env.PI_PLANS_DIR = join(dir, 'plans');
  process.env.PI_MEMORY_DIR = dir;
});

afterEach(() => {
  delete process.env.PI_PLANS_DIR;
  delete process.env.PI_MEMORY_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const tasks: Task[] = [
  { id: 1, subject: '已完成项', status: 'completed' },
  { id: 2, subject: '进行中项', status: 'in_progress', activeForm: '正在做' },
  { id: 3, subject: '阻塞项', status: 'blocked' },
  { id: 4, subject: '待办项', status: 'pending' },
  { id: 5, subject: '已删除项', status: 'deleted' },
];

describe('renderPlanFile / parsePlanFile', () => {
  it('渲染含状态标记与 activeForm，跳过 deleted', () => {
    const text = renderPlanFile(tasks, 6);
    expect(text).toContain('- [x] 1. 已完成项');
    expect(text).toContain('- [~] 2. 进行中项 (正在做)');
    expect(text).toContain('- [b] 3. 阻塞项');
    expect(text).toContain('- [ ] 4. 待办项');
    expect(text).not.toContain('已删除项');
    expect(text).toContain('<!-- nextId: 6 -->');
  });

  it('往返一致（状态与 activeForm 保留，nextId 保留）', () => {
    const parsed = parsePlanFile(renderPlanFile(tasks, 6));
    expect(parsed).not.toBeNull();
    const st = parsed as TaskState;
    expect(st.nextId).toBe(6);
    expect(st.tasks.map((t) => [t.id, t.status, t.activeForm])).toEqual([
      [1, 'completed', undefined],
      [2, 'in_progress', '正在做'],
      [3, 'blocked', undefined],
      [4, 'pending', undefined],
    ]);
  });

  it('单任务计划也能解析（非空行仅 3 行）', () => {
    const one = parsePlanFile(renderPlanFile([{ id: 1, subject: '唯一任务', status: 'pending' }], 2));
    expect(one?.tasks).toHaveLength(1);
  });

  it('无任务行或手改污染时返回 null', () => {
    expect(parsePlanFile('# 随便写的')).toBeNull();
    expect(parsePlanFile('')).toBeNull();
    const polluted = `${'# 说明\n'.repeat(10)}- [ ] 1. 仅一条`;
    expect(parsePlanFile(polluted)).toBeNull();
  });

  it('缺 nextId 注释时用 maxId+1 推断', () => {
    const parsed = parsePlanFile('- [ ] 3. 任务\n- [x] 7. 另一个');
    expect(parsed?.nextId).toBe(8);
  });
});

describe('写盘 / 列表 / 清理', () => {
  it('writePlanFile 落到 plan-<ts>/plan.md', () => {
    const ts = 1700000000000;
    const file = writePlanFile(ts, renderPlanFile(tasks, 6));
    expect(file).toBe(join(planDirPath(ts), 'plan.md'));
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf-8')).toContain('进行中项');
  });

  it('listPlans 按时间倒序', () => {
    writePlanFile(1000, renderPlanFile(tasks, 6));
    writePlanFile(3000, renderPlanFile(tasks, 6));
    writePlanFile(2000, renderPlanFile(tasks, 6));
    expect(listPlans().map((p) => p.ts)).toEqual([3000, 2000, 1000]);
  });

  it('cleanupOldPlans 仅保留最近 N 份', () => {
    for (let i = 1; i <= MAX_PLANS + 3; i++) writePlanFile(i * 1000, renderPlanFile(tasks, 6));
    expect(listPlans()).toHaveLength(MAX_PLANS + 3);
    const removed = cleanupOldPlans(MAX_PLANS);
    expect(removed).toBe(3);
    expect(listPlans()).toHaveLength(MAX_PLANS);
  });
});

describe('restoreStateFromPlans（磁盘恢复兜底）', () => {
  it('恢复最新一份未完成计划并给出其时间戳', () => {
    const now = Date.now();
    writePlanFile(now - 5000, renderPlanFile([{ id: 1, subject: '旧任务', status: 'pending' }], 2));
    writePlanFile(now - 1000, renderPlanFile(tasks, 6));
    const restored = restoreStateFromPlans(now);
    expect(restored).not.toBeNull();
    expect(restored?.ts).toBe(now - 1000);
    expect(restored?.state.tasks.some((t) => t.status === 'pending')).toBe(true);
  });

  it('跳过全为完成/已删除的计划', () => {
    const now = Date.now();
    writePlanFile(
      now - 1000,
      renderPlanFile(
        [
          { id: 1, subject: 'a', status: 'completed' },
          { id: 2, subject: 'b', status: 'deleted' },
        ],
        3,
      ),
    );
    expect(restoreStateFromPlans(now)).toBeNull();
  });

  it('跳过超过 MAX_RESTORE_AGE_MS 的过期计划', () => {
    const now = Date.now();
    writePlanFile(now - MAX_RESTORE_AGE_MS - 1000, renderPlanFile(tasks, 6));
    expect(restoreStateFromPlans(now)).toBeNull();
  });

  it('目录不存在时返回 null', () => {
    expect(restoreStateFromPlans()).toBeNull();
    expect(listPlans()).toEqual([]);
  });

  it('plan.md 损坏时跳到下一份', () => {
    const now = Date.now();
    mkdirSync(planDirPath(now - 1000), { recursive: true });
    writeFileSync(join(planDirPath(now - 1000), 'plan.md'), '不是计划文件');
    writePlanFile(now - 2000, renderPlanFile(tasks, 6));
    const restored = restoreStateFromPlans(now);
    expect(restored?.ts).toBe(now - 2000);
  });
});

describe('syncPlanFile / removePlan（M4：清空计划不复活）', () => {
  it('空状态删除当前计划目录，重启不再恢复', () => {
    const now = Date.now();
    writePlanFile(now - 1000, renderPlanFile(tasks, 6));
    expect(restoreStateFromPlans(now)?.ts).toBe(now - 1000);
    expect(syncPlanFile(now - 1000, { tasks: [], nextId: 1 })).toBe('removed');
    expect(existsSync(planDirPath(now - 1000))).toBe(false);
    expect(restoreStateFromPlans(now)).toBeNull();
  });

  it('仅删除当前计划，不误删其它计划目录', () => {
    const now = Date.now();
    writePlanFile(now - 5000, renderPlanFile([{ id: 1, subject: '旧计划', status: 'pending' }], 2));
    writePlanFile(now - 1000, renderPlanFile(tasks, 6));
    expect(syncPlanFile(now - 1000, { tasks: [], nextId: 1 })).toBe('removed');
    expect(listPlans().map((p) => p.ts)).toEqual([now - 5000]);
    expect(restoreStateFromPlans(now)?.ts).toBe(now - 5000);
  });

  it('有任务时写入；removePlan 对不存在路径幂等返回 false', () => {
    const now = Date.now();
    expect(syncPlanFile(now - 1000, { tasks: [{ id: 1, subject: 'x', status: 'pending' }], nextId: 2 })).toBe('written');
    expect(readFileSync(join(planDirPath(now - 1000), 'plan.md'), 'utf-8')).toContain('- [ ] 1. x');
    expect(removePlan(now - 999999)).toBe(false);
    expect(syncPlanFile(now - 999998, { tasks: [], nextId: 1 })).toBe('removed');
  });
});

describe('findActivePlan（活跃计划查找语义，subagent 复用）', () => {
  it('取最新 ≤7 天且含未完成任务的计划，返回原始内容', () => {
    const now = Date.now();
    writePlanFile(now - 5000, renderPlanFile([{ id: 1, subject: '旧计划', status: 'pending' }], 2));
    const content = renderPlanFile(tasks, 6);
    writePlanFile(now - 1000, content);
    const active = findActivePlan(now);
    expect(active?.ts).toBe(now - 1000);
    expect(active?.content).toBe(content);
    expect(active?.state.tasks.some((t) => t.status === 'pending')).toBe(true);
  });

  it('跳过过期计划与全完成/已删除计划', () => {
    const now = Date.now();
    writePlanFile(now - MAX_RESTORE_AGE_MS - 1000, renderPlanFile(tasks, 6));
    writePlanFile(
      now - 2000,
      renderPlanFile(
        [
          { id: 1, subject: 'done', status: 'completed' },
          { id: 2, subject: 'del', status: 'deleted' },
        ],
        3,
      ),
    );
    expect(findActivePlan(now)).toBeNull();
    writePlanFile(now - 3000, renderPlanFile([{ id: 1, subject: '阻塞中', status: 'blocked' }], 2));
    expect(findActivePlan(now)?.ts).toBe(now - 3000);
  });

  it('plan.md 损坏时跳到下一份', () => {
    const now = Date.now();
    mkdirSync(planDirPath(now - 500), { recursive: true });
    writeFileSync(join(planDirPath(now - 500), 'plan.md'), '不是计划文件');
    writePlanFile(now - 1000, renderPlanFile([{ id: 1, subject: '有效', status: 'pending' }], 2));
    expect(findActivePlan(now)?.ts).toBe(now - 1000);
  });

  it('statSync 判目录：符号链接指向的计划目录同样命中（dirent.isDirectory 会漏）', () => {
    const now = Date.now();
    mkdirSync(plansDir(), { recursive: true });
    const realDir = join(dir, 'real-plan-dir');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'plan.md'), renderPlanFile([{ id: 1, subject: '链接计划', status: 'pending' }], 2));
    symlinkSync(realDir, planDirPath(now - 42));
    expect(listPlans().some((p) => p.ts === now - 42)).toBe(true);
    expect(findActivePlan(now)?.ts).toBe(now - 42);
  });

  it('与 restoreStateFromPlans 选择同一份计划', () => {
    const now = Date.now();
    writePlanFile(now - 5000, renderPlanFile([{ id: 1, subject: 'a', status: 'pending' }], 2));
    writePlanFile(now - 1000, renderPlanFile(tasks, 6));
    expect(findActivePlan(now)?.ts).toBe(restoreStateFromPlans(now)?.ts);
  });
});

describe('plansDir 解析', () => {
  it('PI_PLANS_DIR 优先，缺省落到 <memoryDir>/plans', () => {
    expect(plansDir()).toBe(join(dir, 'plans'));
    delete process.env.PI_PLANS_DIR;
    expect(plansDir()).toBe(join(dir, 'plans'));
  });
});
