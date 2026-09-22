/**
 * 种子任务对账（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/seeds.ts`。
 *
 * `portable/agent/scheduled-seeds.json`（git 入库共享）定义跨设备通用每日任务；
 * 每次 tick/启动对账：本地缺失同名任务则自动注册（幂等，不覆盖本地已有任务，
 * 用户删过的不复活——只补缺失）。同名任务与种子定义有差异时记入 drifted 并提醒。
 */

import { statSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '../../../core/config';
import { readTasks, addTask, logDir } from './storage';
import type { Task, TaskType } from '../types';

const SEEDS_FILE = 'scheduled-seeds.json';

export interface SeedTaskDef {
  name: string;
  type: TaskType;
  schedule: string;
  prompt: string;
  useSubagent?: boolean;
  notifyMain?: boolean;
  waitForUserOnLocal?: boolean;
  maxRunTime?: number;
  retries?: number;
  tags?: string[];
}

export interface SeedSyncResult {
  added: number;
  drifted: string[];
}

let cachedSeeds: SeedTaskDef[] | null = null;
let cachedMtimeMs = 0;
let lastDriftSig: string | null = null;

const isSeedLike = (s: unknown): s is SeedTaskDef => {
  const v = s as SeedTaskDef;
  return (
    !!v &&
    typeof v.name === 'string' &&
    !!v.name &&
    (v.type === 'interval' || v.type === 'cron' || v.type === 'once') &&
    typeof v.schedule === 'string' &&
    !!v.schedule &&
    typeof v.prompt === 'string' &&
    !!v.prompt
  );
};

/** 读取种子任务定义（mtime 变化才重读；文件缺失/损坏返回缓存或 []） */
export function loadSeeds(): SeedTaskDef[] {
  try {
    const p = join(getAgentDir(), SEEDS_FILE);
    const st = statSync(p);
    if (cachedSeeds && st.mtimeMs === cachedMtimeMs) return cachedSeeds;
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as { tasks?: unknown[] };
    const seeds = (Array.isArray(raw?.tasks) ? raw.tasks : []).filter(isSeedLike);
    cachedSeeds = seeds;
    cachedMtimeMs = st.mtimeMs;
    return seeds;
  } catch {
    return cachedSeeds ?? [];
  }
}

/** 比较本地同名任务与种子定义，返回差异摘要；一致返回 null */
export function diffSeedTask(local: Pick<Task, 'type' | 'schedule' | 'prompt'>, s: SeedTaskDef): string | null {
  const diffs: string[] = [];
  if (local.type !== s.type) diffs.push(`type ${local.type}≠${s.type}`);
  if (local.schedule !== s.schedule) diffs.push(`schedule ${local.schedule}≠${s.schedule}`);
  if (local.prompt !== s.prompt) diffs.push('prompt');
  return diffs.length ? diffs.join('+') : null;
}

function recordDriftLog(drifted: string[]): void {
  const sig = drifted.join('§');
  const prev = lastDriftSig;
  lastDriftSig = sig;
  try {
    if (drifted.length && sig !== prev) {
      mkdirSync(logDir(), { recursive: true });
      appendFileSync(join(logDir(), 'seed-drift.log'), `[${new Date().toISOString()}] 漂移: ${drifted.join('；')}\n`);
    } else if (!drifted.length && prev) {
      mkdirSync(logDir(), { recursive: true });
      appendFileSync(
        join(logDir(), 'seed-drift.log'),
        `[${new Date().toISOString()}] 漂移已消除（本地任务与 seeds 重新一致）\n`,
      );
    }
  } catch {
    /* 日志失败不阻塞对账 */
  }
}

/**
 * 对账：本地缺失的种子任务自动注册（幂等，不覆盖本地已有任务）；
 * 同名任务与 seeds 定义有差异时记入 drifted 并写漂移日志（签名去重）。
 * existing 传 Task[] 做完整漂移比对；不传则内部读取全量任务。
 */
export async function syncSeedTasks(existing?: Task[]): Promise<SeedSyncResult> {
  const seeds = loadSeeds();
  if (seeds.length === 0) return { added: 0, drifted: [] };
  const all = existing ?? (readTasks().tasks as Task[]);
  const byName = new Map(all.map((t) => [t.name, t]));
  let added = 0;
  const drifted: string[] = [];
  for (const s of seeds) {
    const local = byName.get(s.name);
    if (!local) {
      try {
        await addTask({
          name: s.name,
          type: s.type,
          schedule: s.schedule,
          prompt: s.prompt,
          useSubagent: s.useSubagent,
          notifyMain: s.notifyMain,
          waitForUserOnLocal: s.waitForUserOnLocal,
          maxRunTime: s.maxRunTime,
          retries: s.retries,
          tags: s.tags,
        });
        added++;
      } catch {
        /* 单条失败（如表达式非法）不阻塞其余 */
      }
      continue;
    }
    const d = diffSeedTask(local, s);
    if (d) drifted.push(`${s.name}(${d})`);
  }
  recordDriftLog(drifted);
  return { added, drifted };
}

/** 测试重置缓存 */
export function __resetSeedCache(): void {
  cachedSeeds = null;
  cachedMtimeMs = 0;
  lastDriftSig = null;
}
