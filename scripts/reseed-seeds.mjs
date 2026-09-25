#!/usr/bin/env node
/**
 * reseed-seeds.mjs —— 把 scheduled-seeds.json 的种子定义**应用到已存在的同名任务**
 *
 * 背景：autopilot 的种子对账是「只补缺失，不覆盖」，因此修改种子提示词后，
 * 已注册过该任务的设备**不会自动生效**（只在启动时提示 drift）。本脚本用于显式应用，
 * 也可用于修正被本地改坏的种子任务。
 *
 * 保留：任务的 id / enabled / lastRun / runCount / history 等运行态字段；
 * 覆盖：种子拥有的定义字段（type/schedule/prompt/maxRunTime/retries/useSubagent/notifyMain/
 *       waitForUserOnLocal/tags）。
 *
 * 用法：
 *   node scripts/reseed-seeds.mjs            # 预演（默认，不改文件）
 *   node scripts/reseed-seeds.mjs --apply    # 实际写入（先备份 tasks.json）
 *   环境：PI_MEMORY_DIR 可覆盖任务目录（<PI_MEMORY_DIR>/scheduler/tasks.json）
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEMORY = process.env.PI_MEMORY_DIR || join(ROOT, 'portable', 'memory');
const TASKS = join(MEMORY, 'scheduler', 'tasks.json');
const SEEDS = join(ROOT, 'portable', 'agent', 'scheduled-seeds.json');
const APPLY = process.argv.includes('--apply');

/** 种子拥有的定义字段 */
const OWNED = ['type', 'schedule', 'prompt', 'maxRunTime', 'retries', 'useSubagent', 'notifyMain', 'waitForUserOnLocal', 'tags'];

if (!existsSync(SEEDS)) {
  console.error(`❌ 未找到 ${SEEDS}`);
  process.exit(2);
}
if (!existsSync(TASKS)) {
  console.log(`无 ${TASKS}（任务尚未注册；fresh 设备首次启动会自动补种子，无需 reseed）`);
  process.exit(0);
}

const seeds = (JSON.parse(readFileSync(SEEDS, 'utf-8')).tasks ?? []).filter((s) => s?.name);
const store = JSON.parse(readFileSync(TASKS, 'utf-8'));
const tasks = Array.isArray(store.tasks) ? store.tasks : [];

let updated = 0;
let missing = 0;
for (const seed of seeds) {
  const local = tasks.find((t) => t.name === seed.name && !t.deleted);
  if (!local) {
    console.log(`· ${seed.name}：本地无同名任务（首次启动会自动注册）`);
    missing++;
    continue;
  }
  const changed = OWNED.filter((k) => seed[k] !== undefined && JSON.stringify(local[k]) !== JSON.stringify(seed[k]));
  if (changed.length === 0) {
    console.log(`✓ ${seed.name}：已一致`);
    continue;
  }
  console.log(`${APPLY ? '✎' : '·'} ${seed.name}：将更新 ${changed.join(', ')}`);
  if (APPLY) {
    for (const k of changed) local[k] = seed[k];
    local.updatedAt = new Date().toISOString();
  }
  updated++;
}

if (updated === 0) {
  console.log(`\n无需更新${missing ? `（${missing} 个种子本地尚未注册）` : ''}。`);
  process.exit(0);
}
if (!APPLY) {
  console.log(`\n预演：${updated} 个任务待更新。加 --apply 实际写入。`);
  process.exit(0);
}

const backup = `${TASKS}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(TASKS, backup);
mkdirSync(dirname(TASKS), { recursive: true });
writeFileSync(TASKS, JSON.stringify(store, null, 2) + '\n', 'utf-8');
console.log(`\n已更新 ${updated} 个任务（备份：${backup}）。`);
