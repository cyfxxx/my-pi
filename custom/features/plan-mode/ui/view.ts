/**
 * Plan-mode Feature — 视图/序列化（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/plan-mode/view.ts` 的非 TUI 部分。
 */

import type { Task, TaskStatus } from '../core/state';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  deleted: '已删除',
};

export function formatStatusLabel(status: TaskStatus): string {
  return STATUS_LABEL[status];
}

export function formatCommandTaskLine(t: Task, glyph: string): string {
  const form = t.status === 'in_progress' && t.activeForm ? ` (${t.activeForm})` : '';
  return `  ${glyph} #${t.id} ${t.subject}${form}`;
}

export function formatPlanMessageLine(t: Task, maxSubject = 40): string {
  const check =
    t.status === 'completed' ? '[✓]' : t.status === 'in_progress' ? '[•]' : t.status === 'blocked' ? '[⏸]' : '[ ]';
  const subject = t.subject.length > maxSubject ? `${t.subject.slice(0, maxSubject - 1)}…` : t.subject;
  const form = t.status === 'in_progress' && t.activeForm ? ` (${t.activeForm})` : '';
  return `${t.id}. ${check} ${subject}${form}`;
}

export function formatListLine(t: Task): string {
  const form = t.status === 'in_progress' && t.activeForm ? ` (${t.activeForm})` : '';
  const failed = t.failures && t.failures.length > 0 ? ` [!${t.failures.length}次失败]` : '';
  return `[${STATUS_LABEL[t.status]}] #${t.id} ${t.subject}${form}${failed}`;
}

export function formatGetLines(task: Task): string {
  const lines = [`#${task.id} [${STATUS_LABEL[task.status]}] ${task.subject}`];
  if (task.description) lines.push(`  描述: ${task.description}`);
  if (task.activeForm) lines.push(`  状态: ${task.activeForm}`);
  if (task.failures && task.failures.length > 0) {
    lines.push('  已失败尝试:');
    for (const f of task.failures) lines.push(`    - ${f}`);
  }
  return lines.join('\n');
}

export function renderPlanFile(tasks: readonly Task[], nextId: number): string {
  const lines = ['# 计划（plan-mode 自动同步，勿手改——下一次状态变化会覆盖）', ''];
  for (const t of tasks) {
    if (t.status === 'deleted') continue;
    const check = t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '~' : t.status === 'blocked' ? 'b' : ' ';
    const form = t.status === 'in_progress' && t.activeForm ? ` (${t.activeForm})` : '';
    lines.push(`- [${check}] ${t.id}. ${t.subject}${form}`);
  }
  lines.push('');
  lines.push(`<!-- nextId: ${nextId} -->`);
  return lines.join('\n');
}

export function parsePlanFile(content: string): { tasks: Task[]; nextId: number } | null {
  const tasks: Task[] = [];
  const lines = content.split('\n');
  let maxId = 0;
  let parsed = 0;
  for (const line of lines) {
    const m = line.match(/^- \[([ x~b])\] (\d+)\. (.+)$/);
    if (!m) continue;
    parsed++;
    const id = parseInt(m[2], 10);
    maxId = Math.max(maxId, id);
    const status =
      m[1] === 'x' ? 'completed' : m[1] === '~' ? 'in_progress' : m[1] === 'b' ? 'blocked' : 'pending';
    let subject = m[3];
    let activeForm: string | undefined;
    const fm = subject.match(/^(.+?)\s*\((.*)\)$/);
    if (fm && status === 'in_progress') {
      subject = fm[1];
      activeForm = fm[2];
    }
    tasks.push({ id, subject, status, activeForm } as Task);
  }
  const nonEmpty = lines.filter((l) => l.trim() !== '').length;
  if (parsed === 0) return null;
  if (nonEmpty > 3 && parsed < nonEmpty / 2) return null;
  const nextIdMatch = content.match(/<!-- nextId: (\d+) -->/);
  const nextId = nextIdMatch ? parseInt(nextIdMatch[1], 10) : maxId + 1;
  return { tasks, nextId };
}
