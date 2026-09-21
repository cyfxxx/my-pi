/**
 * plan-mode 纯逻辑回归测试
 * 迁移自 pi-tools plan-mode/tests 的核心语义（状态机/选择器/序列化）。
 */
import { describe, it, expect } from 'vitest';
import { applyTaskMutation, EMPTY_STATE, isTransitionValid } from '../state';
import { selectTasksByStatus, selectTodoCounts, selectVisibleTasks } from '../selectors';
import { renderPlanFile, parsePlanFile, formatListLine } from '../view';
import type { TaskState } from '../state';

function fresh(): TaskState {
  return { tasks: [...EMPTY_STATE.tasks], nextId: 1 };
}

describe('applyTaskMutation: 状态机', () => {
  it('create → pending，id 自增', () => {
    const r = applyTaskMutation(fresh(), 'create', { subject: '第一步' });
    expect(r.op.kind).toBe('create');
    expect(r.state.tasks).toHaveLength(1);
    expect(r.state.tasks[0]).toMatchObject({ id: 1, subject: '第一步', status: 'pending' });
    expect(r.state.nextId).toBe(2);
  });

  it('create 缺 subject → error', () => {
    expect(applyTaskMutation(fresh(), 'create', {}).op.kind).toBe('error');
  });

  it('合法转移 pending→in_progress→completed', () => {
    let s = applyTaskMutation(fresh(), 'create', { subject: 'x' }).state;
    s = applyTaskMutation(s, 'update', { id: 1, status: 'in_progress', activeForm: '进行中' }).state;
    expect(s.tasks[0].status).toBe('in_progress');
    s = applyTaskMutation(s, 'update', { id: 1, status: 'completed' }).state;
    expect(s.tasks[0].status).toBe('completed');
  });

  it('非法转移 completed→in_progress → error', () => {
    let s = applyTaskMutation(fresh(), 'create', { subject: 'x' }).state;
    s = applyTaskMutation(s, 'update', { id: 1, status: 'completed' }).state;
    const r = applyTaskMutation(s, 'update', { id: 1, status: 'in_progress' });
    expect(r.op.kind).toBe('error');
    expect(s.tasks[0].status).toBe('completed');
  });

  it('failure 追加最多 3 条', () => {
    let s = applyTaskMutation(fresh(), 'create', { subject: 'x' }).state;
    for (let i = 0; i < 5; i++) s = applyTaskMutation(s, 'update', { id: 1, failure: `f${i}` }).state;
    expect(s.tasks[0].failures).toEqual(['f2', 'f3', 'f4']);
  });

  it('delete 软删；clear 重置', () => {
    let s = applyTaskMutation(fresh(), 'create', { subject: 'x' }).state;
    s = applyTaskMutation(s, 'delete', { id: 1 }).state;
    expect(s.tasks[0].status).toBe('deleted');
    s = applyTaskMutation(s, 'create', { subject: 'y' }).state;
    const c = applyTaskMutation(s, 'clear', {});
    expect(c.op.kind).toBe('clear');
    expect(c.state.tasks).toHaveLength(0);
  });

  it('isTransitionValid 同状态恒真', () => {
    expect(isTransitionValid('pending', 'pending')).toBe(true);
    expect(isTransitionValid('deleted', 'pending')).toBe(false);
  });
});

describe('selectors', () => {
  it('分组与计数忽略 deleted', () => {
    let s = fresh();
    s = applyTaskMutation(s, 'create', { subject: 'a' }).state;
    s = applyTaskMutation(s, 'create', { subject: 'b' }).state;
    s = applyTaskMutation(s, 'update', { id: 1, status: 'in_progress' }).state;
    s = applyTaskMutation(s, 'delete', { id: 2 }).state;
    expect(selectVisibleTasks(s)).toHaveLength(1);
    const g = selectTasksByStatus(s);
    expect(g.inProgress).toHaveLength(1);
    expect(selectTodoCounts(s).total).toBe(1);
  });
});

describe('view: 序列化往返', () => {
  it('renderPlanFile → parsePlanFile 往返保真', () => {
    let s = fresh();
    s = applyTaskMutation(s, 'create', { subject: '任务一' }).state;
    s = applyTaskMutation(s, 'create', { subject: '任务二' }).state;
    s = applyTaskMutation(s, 'update', { id: 2, status: 'in_progress', activeForm: '进行中' }).state;
    const text = renderPlanFile(s.tasks, s.nextId);
    const parsed = parsePlanFile(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.tasks).toHaveLength(2);
    expect(parsed!.tasks[1]).toMatchObject({ id: 2, subject: '任务二', status: 'in_progress', activeForm: '进行中' });
    expect(parsed!.nextId).toBe(s.nextId);
  });

  it('手改污染（不可解析）→ null', () => {
    expect(parsePlanFile('随便写的东西\n没有任何任务行')).toBeNull();
  });

  it('formatListLine 含状态与失败标记', () => {
    const line = formatListLine({ id: 1, subject: 'x', status: 'blocked', failures: ['f1'] });
    expect(line).toContain('已阻塞');
    expect(line).toContain('1次失败');
  });
});

describe('selectOverlayLayout', () => {
  it('全量小于预算 → 全部可见', async () => {
    const { selectOverlayLayout } = await import('../selectors');
    let s = fresh();
    s = applyTaskMutation(s, 'create', { subject: 'a' }).state;
    s = applyTaskMutation(s, 'create', { subject: 'b' }).state;
    const l = selectOverlayLayout(s, 10);
    expect(l.visible).toHaveLength(2);
    expect(l.hiddenCompleted).toBe(0);
    expect(l.truncatedTail).toBe(0);
  });

  it('超预算时优先保留非完成项并统计隐藏', async () => {
    const { selectOverlayLayout } = await import('../selectors');
    let s = fresh();
    for (let i = 0; i < 6; i++) s = applyTaskMutation(s, 'create', { subject: `t${i}` }).state;
    // 完成 3 个
    for (let id = 1; id <= 3; id++) s = applyTaskMutation(s, 'update', { id: 1, status: 'completed' }).state;
    const l = selectOverlayLayout(s, 3);
    expect(l.visible.length).toBeLessThanOrEqual(3);
    // 非完成项优先
    expect(l.visible.some((t) => t.status !== 'completed')).toBe(true);
    expect(l.hiddenCompleted + l.truncatedTail).toBeGreaterThan(0);
  });
});

describe('plan-mode: 只读 bash 判定', () => {
  it('放行纯只读命令', async () => {
    const { isReadonlyBashCommand } = await import('../readonly');
    expect(isReadonlyBashCommand('ls -la')).toBe(true);
    expect(isReadonlyBashCommand('git status')).toBe(true);
    expect(isReadonlyBashCommand('git -C /repo log --oneline -5')).toBe(true);
    expect(isReadonlyBashCommand('grep -E "(a|b)" file')).toBe(true);
    expect(isReadonlyBashCommand('rg foo')).toBe(true);
    expect(isReadonlyBashCommand('tsc --noEmit')).toBe(true);
  });

  it('拒绝命令串联与重定向', async () => {
    const { isReadonlyBashCommand } = await import('../readonly');
    expect(isReadonlyBashCommand('ls; rm -rf /tmp/x')).toBe(false);
    expect(isReadonlyBashCommand('echo pwned > file')).toBe(false);
    expect(isReadonlyBashCommand('cat a | tee b')).toBe(false);
    expect(isReadonlyBashCommand('ls && rm x')).toBe(false);
    expect(isReadonlyBashCommand('echo $(whoami)')).toBe(false);
  });

  it('拒绝可写标志与非白名单命令', async () => {
    const { isReadonlyBashCommand } = await import('../readonly');
    expect(isReadonlyBashCommand('find . -delete')).toBe(false);
    expect(isReadonlyBashCommand('sort -o out.txt in.txt')).toBe(false);
    expect(isReadonlyBashCommand('date -s 2020-01-01')).toBe(false);
    expect(isReadonlyBashCommand('git branch -D main')).toBe(false);
    expect(isReadonlyBashCommand('rm -rf /')).toBe(false);
    expect(isReadonlyBashCommand('python evil.py')).toBe(false);
    expect(isReadonlyBashCommand('')).toBe(false);
  });
});
