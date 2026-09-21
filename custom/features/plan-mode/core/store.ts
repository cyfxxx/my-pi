/**
 * Plan-mode Feature — 进程内任务状态存储（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/plan-mode/store.ts`。
 */

import type { Task, TaskState } from './state';
import { EMPTY_STATE } from './state';

let _state: TaskState = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };

export function getTodos(): readonly Task[] {
  return _state.tasks;
}
export function getNextId(): number {
  return _state.nextId;
}
export function getState(): TaskState {
  return _state;
}
export function replaceState(next: TaskState): void {
  _state = next;
}
export function commitState(next: TaskState): void {
  _state = next;
}
export function resetState(): void {
  _state = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
}
