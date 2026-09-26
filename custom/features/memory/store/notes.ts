/**
 * Memory Feature — L0 工作笔记存储（纯逻辑，零 Pi 依赖）
 *
 * 数据落点：`portable/memory/notes.json`。写路径统一脱敏（scrubSecrets）+ 原子写。
 */

import { join } from 'node:path';
import { writeJSONSync } from '../../../core/atomic-write';
import { scrubSecrets } from '../../../core/secrets';
import { dataDir, ensureDir, readStoreFile } from './io';

export function notesFile(): string {
  return join(dataDir(), 'notes.json');
}

function rawLoadNotes(): Record<string, string> {
  return readStoreFile<Record<string, string>>(notesFile(), 'notes') || {};
}

function rawSaveNotes(notes: Record<string, string>): void {
  const scrubbed: Record<string, string> = {};
  for (const [k, v] of Object.entries(notes)) {
    const cleanKey = k.startsWith('__ttl_') ? k : scrubSecrets(k);
    scrubbed[cleanKey] = k.startsWith('__ttl_') ? v : scrubSecrets(v);
  }
  writeJSONSync(notesFile(), scrubbed);
}

/**
 * 读-改-写便笺集合（跨进程合并，防丢更新）。
 *
 * 回调在独立快照副本上执行；保存前重新读取盘上最新内容，只把本次变更集
 * （相对快照新增/修改的键 + 快照中被删除的键）应用到最新内容后再原子落盘。
 * 未变更的键尊重盘上最新值，因此并发写者（另一实例/多会话/同步脚本）
 * 在本次读-写窗口内写入的键不会被静默覆盖。
 * `__ttl_*` 元数据键按普通键参与差分与合并（写入路径仍豁免脱敏），
 * 与数据键成对增删的现有约定不变。
 *
 * 残留窗口：重新读盘与 rename 之间仍有极短 TOCTOU 窗口（无跨进程锁），
 * 只保证不会覆盖窗口之前已落盘的更新。
 */
export function updateNotes<T>(fn: (notes: Record<string, string>) => T): T {
  const working = rawLoadNotes();
  const before = { ...working };
  const result = fn(working);

  // 保存前重新读盘：以回调变更集为补丁应用到盘上最新内容
  const merged = rawLoadNotes();
  for (const [k, v] of Object.entries(working)) {
    if (before[k] !== v) merged[k] = v; // 新增或修改
  }
  for (const k of Object.keys(before)) {
    if (!(k in working)) delete merged[k]; // after 缺失 = 删除
  }
  rawSaveNotes(merged);
  return result;
}

export function loadNotes(): Record<string, string> {
  ensureDir();
  const notes = rawLoadNotes();
  const now = Date.now();
  for (const key of Object.keys(notes)) {
    const ttlKey = `__ttl_${key}`;
    const ttl = notes[ttlKey];
    if (ttl && new Date(ttl).getTime() <= now) {
      delete notes[key];
      delete notes[ttlKey];
    }
  }
  return notes;
}

export function saveNotes(notes: Record<string, string>): void {
  rawSaveNotes(notes);
}

/**
 * 删除已过期（TTL 到期）的工作笔记并落盘，返回删除条数。
 * loadNotes 只在内存视图中过滤，不会持久化；清理命令走这里才真正生效。
 */
export function purgeExpiredNotes(): number {
  const notes = rawLoadNotes();
  const now = Date.now();
  let removed = 0;
  for (const key of Object.keys(notes)) {
    const ttl = notes[`__ttl_${key}`];
    const expires = ttl ? new Date(ttl).getTime() : NaN;
    if (Number.isFinite(expires) && expires <= now) {
      delete notes[key];
      delete notes[`__ttl_${key}`];
      removed++;
    }
  }
  if (removed > 0) rawSaveNotes(notes);
  return removed;
}

export function clearCompactionFlag(): void {
  updateNotes((notes) => {
    if (notes['_ctx.just_compacted']) {
      delete notes['_ctx.just_compacted'];
      delete notes['_ctx.compacted_at'];
    }
  });
}
