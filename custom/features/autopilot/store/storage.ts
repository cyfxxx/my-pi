import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { writeJSONSync } from '../../../core/atomic-write';
import { appendJSONLRotating } from '../../../core/fs-json';
import type { Task, TaskStore, SchedulerSettings, ExecHistoryEntry } from '../types';
import { STORE_VERSION, DEFAULT_MAX_RUN_TIME, HISTORY_LIMIT } from '../types';
import { schedulerDir, tasksPath, resultsFilePath, deviceTag } from './paths';
import { withStoreLock } from './locks';
import { computeNextRun, addMs, isoNow, retryDelayMs } from './schedule';

export {
  schedulerDir,
  tasksPath,
  lockPath,
  logDir,
  telemetryPath,
  resultsFilePath,
} from './paths';
export {
  parseRelativeTime,
  parseIntervalToMs,
  formatInterval,
  isoNow,
  addMs,
  retryDelayMs,
  isDue,
  cronNextRun,
  computeNextRun,
  previewCron,
} from './schedule';
export {
  withStoreLock,
  isPidInTasklistOutput,
  acquireSessionLock,
  releaseSessionLock,
} from './locks';

export interface TaskResultEntry {
  taskId: string;
  taskName: string;
  result: 'success' | 'failed';
  output: string;
  durationMs?: number;
}

export function appendTaskResult(entry: TaskResultEntry): void {
  const MAX = 2 * 1024 * 1024;
  try {
    appendJSONLRotating(
      resultsFilePath(),
      {
        ts: new Date().toISOString(),
        device: deviceTag(),
        taskId: entry.taskId,
        taskName: entry.taskName,
        result: entry.result,
        output: (entry.output || '').slice(0, 500),
        ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      },
      MAX,
    );
  } catch {}
}

function emptyStore(): TaskStore {
  return { version: STORE_VERSION, settings: {}, tasks: [] };
}

export function readTasks(): TaskStore {
  try {
    const data = JSON.parse(readFileSync(tasksPath(), 'utf-8')) as TaskStore;
    if (!Array.isArray(data.tasks)) data.tasks = [];
    if (!data.settings) data.settings = {};
    if ((data.version ?? 1) < STORE_VERSION) migrateTasks(data);
    data.version = STORE_VERSION;
    return data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      try {
        const raw = readFileSync(tasksPath(), 'utf-8');
        const backup = `${tasksPath()}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        writeFileSync(backup, raw, 'utf-8');
        console.error(`[autopilot] tasks.json 解析失败，已留档 ${backup}`);
      } catch {}
    }
    return emptyStore();
  }
}

function migrateTasks(data: TaskStore): void {
  for (const t of data.tasks) {
    if (!Array.isArray(t.history)) t.history = [];
    if (!Array.isArray(t.tags)) t.tags = [];
    if (typeof t.retries !== 'number') t.retries = 0;
    if (typeof t.failCount !== 'number') t.failCount = 0;
    if (typeof t.failoverCount !== 'number') t.failoverCount = 0;
    if (typeof t.maxRunTime !== 'number') t.maxRunTime = DEFAULT_MAX_RUN_TIME;
    if (typeof t.notifyOnCompletion !== 'boolean') t.notifyOnCompletion = false;
    if (typeof t.useSubagent !== 'boolean') t.useSubagent = false;
    if (typeof t.runCount !== 'number') t.runCount = 0;
    if (typeof t.lastResult !== 'string') t.lastResult = null;
    if (typeof t.lastOutput !== 'string') t.lastOutput = '';
  }
}

export function writeTasks(store: TaskStore): void {
  writeJSONSync(tasksPath(), store);
}

export function createTask(params: {
  name: string;
  type: Task['type'];
  schedule: string;
  prompt: string;
  enabled?: boolean;
  useSubagent?: boolean;
  notifyOnCompletion?: boolean;
  notifyMain?: boolean;
  waitForUserOnLocal?: boolean;
  maxRunTime?: number;
  tags?: string[];
  retries?: number;
}): Task {
  const task: Task = {
    id: randomUUID(),
    name: params.name,
    type: params.type,
    schedule: params.schedule,
    prompt: params.prompt,
    enabled: params.enabled ?? true,
    lastRun: null,
    lastResult: null,
    lastOutput: '',
    nextRun: null,
    useSubagent: params.useSubagent ?? false,
    notifyOnCompletion: params.notifyOnCompletion ?? false,
    notifyMain: params.notifyMain ?? false,
    waitForUserOnLocal: params.waitForUserOnLocal ?? false,
    maxRunTime: params.maxRunTime ?? DEFAULT_MAX_RUN_TIME,
    runCount: 0,
    history: [],
    tags: params.tags ?? [],
    retries: Math.max(0, params.retries ?? 0),
    failCount: 0,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
  task.nextRun = computeNextRun(task);
  if (task.nextRun === null) {
    throw new Error(
      `无效调度表达式: "${params.schedule}"（类型 ${params.type}）。interval 示例 "5m"/"1h"，cron 示例 "0 9 * * 1-5"，once 示例 "+30m" 或 ISO 时间`,
    );
  }
  return task;
}

export function addTask(params: Parameters<typeof createTask>[0]): Promise<Task> {
  return withStoreLock(() => {
    const store = readTasks();
    if (store.tasks.some((t) => t.name === params.name)) {
      throw new Error(`已存在同名任务: "${params.name}"，请更换名称`);
    }
    const task = createTask(params);
    store.tasks.push(task);
    writeTasks(store);
    return task;
  });
}

export function updateTask(
  idOrName: string,
  updates: Partial<
    Pick<
      Task,
      | 'enabled'
      | 'prompt'
      | 'schedule'
      | 'type'
      | 'useSubagent'
      | 'notifyOnCompletion'
      | 'notifyMain'
      | 'waitForUserOnLocal'
      | 'maxRunTime'
      | 'name'
      | 'tags'
      | 'retries'
      | 'failCount'
      | 'failoverCount'
    >
  >,
): Promise<Task | null> {
  return withStoreLock(() => {
    const store = readTasks();
    const task = store.tasks.find((t) => t.id === idOrName || t.name === idOrName);
    if (!task) return null;
    let needsRecalc = false;
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      if (k === 'tags' && !Array.isArray(v)) continue;
      (task as unknown as Record<string, unknown>)[k] = v;
      if (k === 'schedule' || k === 'type') needsRecalc = true;
    }
    if (needsRecalc) {
      task.nextRun = computeNextRun(task);
      if (task.nextRun === null) throw new Error(`无效调度表达式: "${task.schedule}"（类型 ${task.type}）`);
    }
    task.updatedAt = isoNow();
    writeTasks(store);
    return task;
  });
}

export function deleteTask(idOrName: string): Promise<boolean> {
  return withStoreLock(() => {
    const store = readTasks();
    const idx = store.tasks.findIndex((t) => t.id === idOrName || t.name === idOrName);
    if (idx === -1) return false;
    store.tasks.splice(idx, 1);
    writeTasks(store);
    return true;
  });
}

export function listTasks(): Task[] {
  return readTasks()
    .tasks.filter((t) => !t.deleted)
    .sort((a, b) => {
      if (!a.nextRun) return 1;
      if (!b.nextRun) return -1;
      return a.nextRun.localeCompare(b.nextRun);
    });
}

export function updateTaskAfterRun(id: string, result: 'success' | 'failed', output: string, durationMs?: number): Promise<void> {
  return withStoreLock(() => {
    const store = readTasks();
    const idx = store.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const task = store.tasks[idx];
    appendTaskResult({ taskId: id, taskName: task.name, result, output, durationMs });
    const entry: ExecHistoryEntry = { time: isoNow(), result, output: output.slice(0, 1000), durationMs };
    task.history.push(entry);
    if (task.history.length > HISTORY_LIMIT) task.history = task.history.slice(-HISTORY_LIMIT);
    task.lastRun = isoNow();
    task.lastResult = result;
    task.lastOutput = output.slice(0, 1000);
    task.updatedAt = isoNow();
    if (result === 'success') {
      task.failCount = 0;
      task.failoverCount = 0;
      task.runCount++;
      if (task.type === 'once') {
        store.tasks.splice(idx, 1);
        writeTasks(store);
        return;
      }
      task.nextRun = computeNextRun(task);
    } else {
      task.failCount++;
      if (task.retries > 0 && task.failCount <= task.retries) {
        task.nextRun = addMs(isoNow(), retryDelayMs(task.failCount));
      } else {
        if (task.type === 'once') {
          store.tasks.splice(idx, 1);
          writeTasks(store);
          return;
        }
        task.runCount++;
        task.nextRun = computeNextRun(task);
      }
    }
    writeTasks(store);
  });
}

export function getSettings(): SchedulerSettings {
  return readTasks().settings;
}
export function setSettings(updates: Partial<SchedulerSettings>): Promise<SchedulerSettings> {
  return withStoreLock(() => {
    const store = readTasks();
    store.settings = { ...store.settings, ...updates };
    writeTasks(store);
    return store.settings;
  });
}

export function renderPrompt(prompt: string): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const vars: Record<string, string> = {
    '{{date}}': `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    '{{time}}': `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    '{{datetime}}': now.toISOString(),
    '{{cwd}}': process.cwd(),
  };
  let out = prompt;
  for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
  return out;
}

export function listSchedulerFiles(): string[] {
  try {
    return readdirSync(schedulerDir());
  } catch {
    return [];
  }
}
