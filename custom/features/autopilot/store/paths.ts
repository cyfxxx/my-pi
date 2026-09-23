import { join } from 'node:path';
import { hostname } from 'node:os';
import { getMemoryDir } from '../../../core/config';

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
export function deviceTag(): string {
  return (process.env.PI_DEVICE_ID || hostname() || 'host').replace(/[^A-Za-z0-9._-]/g, '_');
}
