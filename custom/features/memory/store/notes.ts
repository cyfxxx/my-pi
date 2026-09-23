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

export function updateNotes<T>(fn: (notes: Record<string, string>) => T): T {
  const notes = rawLoadNotes();
  const result = fn(notes);
  rawSaveNotes(notes);
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
