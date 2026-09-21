/**
 * Plan-mode Feature — 选择器（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/plan-mode/selectors.ts`。
 */

import type { Task, TaskState } from './state';

export function selectVisibleTasks(state: TaskState): readonly Task[] {
  return state.tasks.filter((t) => t.status !== 'deleted');
}

export interface TasksByStatus {
  pending: readonly Task[];
  inProgress: readonly Task[];
  blocked: readonly Task[];
  completed: readonly Task[];
}

export function selectTasksByStatus(state: TaskState): TasksByStatus {
  const visible = selectVisibleTasks(state);
  return {
    pending: visible.filter((t) => t.status === 'pending'),
    inProgress: visible.filter((t) => t.status === 'in_progress'),
    blocked: visible.filter((t) => t.status === 'blocked'),
    completed: visible.filter((t) => t.status === 'completed'),
  };
}

export interface TodoCounts {
  total: number;
  pending: number;
  inProgress: number;
  blocked: number;
  completed: number;
}

export function selectTodoCounts(state: TaskState): TodoCounts {
  const g = selectTasksByStatus(state);
  return {
    total: g.pending.length + g.inProgress.length + g.blocked.length + g.completed.length,
    pending: g.pending.length,
    inProgress: g.inProgress.length,
    blocked: g.blocked.length,
    completed: g.completed.length,
  };
}

export function selectHasActive(state: TaskState): boolean {
  return selectVisibleTasks(state).some((t) => t.status === 'in_progress' || t.status === 'pending');
}
