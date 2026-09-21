/**
 * Autopilot Feature — 任务存储与调度表达式（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/{storage,results}.ts`。
 * cron 使用内置 5 字段解析（pi-tools 依赖 croner，my-pi 不引入额外依赖）。
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync, openSync, closeSync, statSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { getMemoryDir } from '../../../core/config';
import { writeJSONSync } from '../../../core/atomic-write';
import type { Task, TaskStore, SchedulerSettings, ExecHistoryEntry } from '../types';
import { STORE_VERSION, DEFAULT_MAX_RUN_TIME, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS, HISTORY_LIMIT } from '../types';

// ── 路径 ──

export function schedulerDir(): string {
  return join(process.env.PI_MEMORY_DIR || getMemoryDir(), 'scheduler');
}
export function tasksPath(): string {
  return join(schedulerDir(), 'tasks.json');
}
export function lockPath(): string {
  return join(schedulerDir(), 'scheduler.lock');
}
export function logDir(): string {
  return join(schedulerDir(), 'logs');
}
export function telemetryPath(): string {
  return join(schedulerDir(), 'telemetry.json');
}
function resultsDir(): string {
  return process.env.PI_DAILY_RESULTS_DIR || join(getMemoryDir(), 'daily-results');
}
export function resultsFilePath(device = deviceTag()): string {
  return join(resultsDir(), `results-${device}.jsonl`);
}
function deviceTag(): string {
  return (process.env.PI_DEVICE_ID || hostname() || 'host').replace(/[^A-Za-z0-9._-]/g, '_');
}

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
    const f = resultsFilePath();
    if (existsSync(f) && statSync(f).size > MAX) {
      try {
        renameSync(f, `${f}.old`);
      } catch {
        /* 轮转失败忽略 */
      }
    }
    mkdirSync(resultsDir(), { recursive: true });
    appendFileSync(
      f,
      JSON.stringify({
        ts: new Date().toISOString(),
        device: deviceTag(),
        taskId: entry.taskId,
        taskName: entry.taskName,
        result: entry.result,
        output: (entry.output || '').slice(0, 500),
        ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      }) + '\n',
      'utf8',
    );
  } catch {
    /* 静默 */
  }
}

// ── 存储读写 ──

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
      } catch {
        /* 留档失败不阻塞 */
      }
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
    if (typeof t.pendingInject !== 'boolean') t.pendingInject = false;
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

let storeWriteQueue: Promise<unknown> = Promise.resolve();
export function withStoreLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = storeWriteQueue.then(fn, fn);
  storeWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ── 调度表达式 ──

function parseInterval(s: string): number | null {
  const m = s.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()[0]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 3600 * 1000;
    case 'd':
      return n * 86400 * 1000;
    default:
      return null;
  }
}

export function parseRelativeTime(s: string): number | null {
  const m = s.match(/^\+(\d+)\s*(s|m|h|d|min|hr)?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  switch ((m[2] || 'm').toLowerCase()[0]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 3600 * 1000;
    case 'd':
      return n * 86400 * 1000;
    default:
      return null;
  }
}

export function parseIntervalToMs(s: string): number | null {
  return parseInterval(s) ?? parseRelativeTime(s) ?? null;
}

export function formatInterval(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

export function isoNow(): string {
  return new Date().toISOString();
}
export function addMs(date: string, ms: number): string {
  return new Date(new Date(date).getTime() + ms).toISOString();
}

export function retryDelayMs(failCount: number): number {
  const base = RETRY_BASE_DELAY_MS;
  const max = RETRY_MAX_DELAY_MS;
  const exp = Math.min(max, base * Math.pow(2, Math.max(0, failCount - 1)));
  const jitter = exp * 0.5 * (Math.random() * 2 - 1);
  return Math.max(base / 2, Math.round(exp + jitter));
}

export function isDue(task: Task): boolean {
  if (!task.enabled || !task.nextRun) return false;
  return new Date(task.nextRun).getTime() <= Date.now();
}

// ── 内置 cron（5 字段：分 时 日 月 周）──

interface CronField {
  values: Set<number> | null; // null = *
}

function parseCronField(field: string, min: number, max: number): CronField | null {
  if (field === '*') return { values: null };
  const values = new Set<number>();
  for (const part of field.split(',')) {
    let step = 1;
    let range = part;
    const slash = part.split('/');
    if (slash.length === 2) {
      range = slash[0];
      step = parseInt(slash[1], 10);
      if (!Number.isFinite(step) || step <= 0) return null;
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = parseInt(a, 10);
      hi = parseInt(b, 10);
    } else {
      lo = parseInt(range, 10);
      hi = lo;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values };
}

function matches(field: CronField, value: number, wrap?: number): boolean {
  if (field.values === null) return true;
  if (wrap !== undefined && value === 0 && field.values.has(wrap)) return true;
  return field.values.has(value);
}

/** 计算 cron 表达式在 from 之后的下一次触发时间（本地时区），无则 null */
export function cronNextRun(expr: string, from: Date = new Date()): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dom = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12);
  const dow = parseCronField(parts[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;

  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = 366 * 24 * 60 * 4; // 最多向前找 4 年
  for (let i = 0; i < limit; i++) {
    if (
      matches(month, d.getMonth() + 1) &&
      matches(dom, d.getDate()) &&
      matches(dow, d.getDay(), 7) &&
      matches(hour, d.getHours()) &&
      matches(minute, d.getMinutes())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

export function computeNextRun(task: Task): string | null {
  const now = new Date();
  if (task.type === 'once') {
    if (task.lastRun) return null;
    const rel = parseRelativeTime(task.schedule);
    if (rel !== null) return addMs(isoNow(), rel);
    const d = new Date(task.schedule);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (task.type === 'interval') {
    const ms = parseIntervalToMs(task.schedule);
    if (ms === null) return null;
    const from = task.lastRun ? new Date(task.lastRun) : now;
    return new Date(from.getTime() + ms).toISOString();
  }
  if (task.type === 'cron') {
    const next = cronNextRun(task.schedule, now);
    return next ? next.toISOString() : null;
  }
  return null;
}

export function previewCron(expr: string, count = 5): string[] {
  const out: string[] = [];
  let from = new Date();
  for (let i = 0; i < count; i++) {
    const next = cronNextRun(expr, from);
    if (!next) break;
    out.push(next.toISOString());
    from = new Date(next.getTime());
  }
  if (out.length === 0) throw new Error(`无效 cron 表达式: "${expr}"`);
  return out;
}

// ── 任务 CRUD ──

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
    pendingInject: false,
    recoveryCount: 0,
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

// ── 会话锁 ──

let lockPid: string | null = null;

export function isPidInTasklistOutput(stdout: string, pid: string | number): boolean {
  return stdout.split(/\s+/).includes(String(pid));
}

export function acquireSessionLock(): boolean {
  const lockF = lockPath();
  const myPid = String(process.pid);
  const LOCK_TTL_MS = 24 * 3600 * 1000;
  const tryOnce = (): boolean => {
    if (existsSync(lockF)) {
      try {
        const raw = readFileSync(lockF, 'utf-8').trim();
        const oldPid = raw.split(':')[0] ?? raw;
        const oldTs = Number(raw.split(':')[1] ?? 0);
        const staleByAge = oldTs > 0 && Date.now() - oldTs > LOCK_TTL_MS;
        if (oldPid && oldPid !== myPid && !staleByAge && existsSync(`/proc/${oldPid}`)) {
          return false;
        }
        unlinkSync(lockF);
      } catch {
        /* 覆盖 */
      }
    }
    try {
      mkdirSync(schedulerDir(), { recursive: true });
      const fd = openSync(lockF, 'wx');
      closeSync(fd);
      writeFileSync(lockF, `${myPid}:${Date.now()}`, 'utf-8');
      return true;
    } catch {
      return false;
    }
  };
  if (tryOnce()) {
    lockPid = myPid;
    return true;
  }
  return false;
}

export function releaseSessionLock(): void {
  if (!lockPid) return;
  try {
    const raw = readFileSync(lockPath(), 'utf-8').trim();
    if (raw.split(':')[0] === lockPid) unlinkSync(lockPath());
  } catch {
    /* ignore */
  }
  lockPid = null;
}

/** 清理泄漏的 .pi-autopilot-*.lock 等陈旧文件（占位：my-pi 用 scheduler.lock） */
export function listSchedulerFiles(): string[] {
  try {
    return readdirSync(schedulerDir());
  } catch {
    return [];
  }
}
