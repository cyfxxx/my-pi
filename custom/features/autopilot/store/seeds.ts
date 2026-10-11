/**
 * 种子任务对账（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/seeds.ts`。
 *
 * `portable/agent/scheduled-seeds.json`（git 入库共享）定义跨设备通用每日任务；
 * 每次 tick/启动对账：本地缺失同名任务则自动注册（幂等，不覆盖本地已有任务，
 * 用户删过的不复活——只补缺失）。同名任务与种子定义有差异时记入 drifted 并提醒。
 *
 * 2026-10-11 两处修正（起因：一条种子静默失效 + 漂移日志无法诊断）：
 * - 修 2：被 `isSeedLike` 拒掉的种子**不再静默丢弃**（曾经缺 `type/schedule` 的「每日更新 ClamAV
 *   病毒库」被直接过滤，既不注册也不报错，事后只能靠 daily-health 的"种子失配"侧面发现）。
 * - 修 3：漂移日志带上**两侧短摘要**（此前只记 `prompt` 这个标签，事后无法判断哪个字节不同）；
 *   漂移签名**落盘**（此前只在内存去重，于是每个新进程都会把同一条漂移再记一遍）。
 */

import { statSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
let lastRejectSig: string | null = null;

/** 无依赖短摘要（FNV-1a 32 位 + 长度）：只用于日志可诊断，不用于任何安全或相等判断 */
export function shortDigest(v: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}/${v.length}`;
}

/** 漂移签名的落盘位置（跨进程去重；不可读写时退回内存去重） */
function driftSigPath(): string {
  return join(logDir(), 'seed-drift.sig');
}

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

/** 日志行统一落进 `logs/seed-drift.log`（失败不阻塞对账） */
function appendSeedLog(line: string): void {
  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(join(logDir(), 'seed-drift.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* 日志失败不阻塞对账 */
  }
}

/** 读取种子任务定义（mtime 变化才重读；文件缺失/损坏返回缓存或 []） */
export function loadSeeds(): SeedTaskDef[] {
  try {
    const p = join(getAgentDir(), SEEDS_FILE);
    const st = statSync(p);
    if (cachedSeeds && st.mtimeMs === cachedMtimeMs) return cachedSeeds;
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as { tasks?: unknown[] };
    const arr = Array.isArray(raw?.tasks) ? raw.tasks : [];
    const seeds = arr.filter(isSeedLike);
    // 修 2：被拒掉的种子必须留下可见痕迹（同一批只记一次；mtime 缓存本身已避免重复读）
    const rejected = arr.filter((x) => !isSeedLike(x));
    if (rejected.length) {
      const names = rejected.map((x) => String((x as { name?: unknown })?.name ?? '(无名)')).join('、');
      const msg = `种子被忽略（缺 type/schedule 或字段非法）：${names}`;
      if (msg !== lastRejectSig) {
        lastRejectSig = msg;
        appendSeedLog(msg);
      }
    } else {
      lastRejectSig = null;
    }
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
  // 修 3：prompt 漂移必须能事后诊断 ⇒ 记两侧短摘要与长度（此前只有 "prompt" 这个标签）
  if (local.prompt !== s.prompt) {
    diffs.push(`prompt(本地 ${shortDigest(local.prompt)} ≠ 种子 ${shortDigest(s.prompt)})`);
  }
  return diffs.length ? diffs.join('+') : null;
}

function recordDriftLog(drifted: string[]): void {
  const sig = drifted.join('§');
  // 修 3：签名落盘 ⇒ 新进程不再重复记录同一条漂移（此前只在内存去重）
  let prev = lastDriftSig;
  try {
    const onDisk = readFileSync(driftSigPath(), 'utf-8').trim();
    if (onDisk) prev = onDisk;
  } catch {
    /* 首次或不可读：退回内存签名 */
  }
  lastDriftSig = sig;
  if (sig !== prev) {
    try {
      mkdirSync(logDir(), { recursive: true });
      writeFileSync(driftSigPath(), sig);
    } catch {
      /* 落盘失败不阻塞 */
    }
  }
  if (!drifted.length) {
    if (prev) appendSeedLog('漂移已消除（本地任务与 seeds 重新一致）');
    return;
  }
  if (sig !== prev) appendSeedLog(`漂移: ${drifted.join('；')}`);
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
  lastRejectSig = null;
}
