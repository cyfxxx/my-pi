import type { Task } from '../types';
import { RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from '../types';

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

interface CronField {
  values: Set<number> | null;
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
  const limit = 366 * 24 * 60 * 4;
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
