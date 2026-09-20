/**
 * note-store.ts — 笔记持久化（JSON + 原子写 + 写时脱敏）
 *
 * 迁移自 pi-tools services/note-store.ts。
 * 数据目录：portable/memory（由 PI_MEMORY_DIR 指定，随项目移动）。
 * 纯逻辑，零 Pi 依赖。
 */

import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { scrubSecrets } from './secrets';
import { writeJSONSync } from './atomic-write';

/** 数据目录（惰性解析，便于测试注入与运行时变更） */
export function dataDir(): string {
  return process.env.PI_MEMORY_DIR || process.env.CTX_LITE_DIR || join(homedir(), '.pi', 'memory');
}

export function notesFile(): string {
  return join(dataDir(), 'notes.json');
}

export function checkpointsDir(): string {
  return join(dataDir(), 'checkpoints');
}

export const MAX_NOTES_SIZE = 1024 * 1024;

export function ensureDir(): void {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cp = checkpointsDir();
  if (!existsSync(cp)) mkdirSync(cp, { recursive: true });
}

export function loadNotes(): Record<string, string> {
  ensureDir();
  let raw: Record<string, string>;
  try {
    raw = JSON.parse(readFileSync(notesFile(), 'utf-8'));
  } catch {
    if (existsSync(notesFile())) {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backup = `${notesFile()}.corrupt-${stamp}`;
        renameSync(notesFile(), backup);
        console.error(`[note-store] notes.json 损坏：已备份到 ${backup}，请人工检查恢复后再移除该备份。`);
      } catch (e) {
        console.error('[note-store] notes.json 损坏且自动备份失败，原文件保持原位：', e);
        return {};
      }
    }
    raw = {};
  }
  // TTL 惰性清理：仅过滤内存视图不落盘
  const now = Date.now();
  for (const key of Object.keys(raw)) {
    const ttlKey = `__ttl_${key}`;
    const ttl = raw[ttlKey];
    if (ttl && new Date(ttl).getTime() <= now) {
      delete raw[key];
      delete raw[ttlKey];
    }
  }
  return raw;
}

/** notes 原子更新基座：fresh 读 → 调用方原地改 → 落盘 */
export function updateNotes<T>(fn: (notes: Record<string, string>) => T): T {
  const notes = loadNotes();
  const result = fn(notes);
  saveNotes(notes);
  return result;
}

export function saveNotes(notes: Record<string, string>): void {
  ensureDir();
  // 写时净化：值统一过 scrubSecrets（键不改写，避免破坏读回一致性）
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(notes)) {
    clean[k] = typeof v === 'string' ? scrubSecrets(v) : v;
  }
  writeJSONSync(notesFile(), clean);
}

export function clearCompactionFlag(): void {
  updateNotes(notes => {
    if (notes['_ctx.just_compacted']) {
      delete notes['_ctx.just_compacted'];
      delete notes['_ctx.compacted_at'];
    }
  });
}

export function getTotalSize(notes: Record<string, string>): number {
  return Object.entries(notes)
    .filter(([k]) => !k.startsWith('__'))
    .reduce((sum, [, v]) => sum + Buffer.byteLength(v, 'utf-8'), 0);
}
