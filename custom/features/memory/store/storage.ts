/**
 * Memory Feature — 持久存储（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-memory/storage.ts`。
 *
 * 数据落点：`portable/memory/{entries.json,summaries.json,notes.json}`。
 * 写路径统一脱敏（scrubSecrets）+ 原子写；读路径重洗防旧数据泄漏。
 * 未迁移：ctx-lite 旧数据迁移（my-pi 无该历史）。
 */

import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type {
  MemoryEntry,
  MemoryStore,
  MemoryStats,
  MemoryAction,
} from './types';
import { writeJSONSync } from '../../../core/atomic-write';
import { scrubSecrets } from '../../../core/secrets';
import { dataDir, ensureDir, readStoreFile } from './io';
import { loadSummaries } from './summaries';

export { dataDir };
export * from './notes';
export * from './summaries';

export function entriesFile(): string {
  return join(dataDir(), 'entries.json');
}
export function checkpointsDir(): string {
  return join(dataDir(), 'checkpoints');
}

export const STORE_VERSION = 2;
const PRUNE_CONFIDENCE = 0.3;
const PRUNE_DAYS = 30;
const PRUNE_RECURRENCE = 2;
const PRUNE_DAYS_LOW = 60;

function readEntriesFile(): MemoryStore | null {
  return readStoreFile<MemoryStore>(entriesFile(), 'entries');
}

function sanitizeEntry(e: MemoryEntry): MemoryEntry {
  return {
    ...e,
    title: scrubSecrets(e.title),
    content: scrubSecrets(e.content),
    tags: (e.tags ?? []).map((t) => scrubSecrets(t)),
  };
}

// ── L1 长期记忆 ──

const accessTouched = new Set<string>();
export function touchAccessedAt(entries: MemoryEntry[], ids: string[]): number {
  let changed = 0;
  try {
    // 剪枝：集合只保留当前存活条目，避免随会话无界增长。
    const liveIds = new Set(entries.filter((e) => !e.deleted).map((e) => e.id));
    for (const id of accessTouched) {
      if (!liveIds.has(id)) accessTouched.delete(id);
    }
    const now = new Date().toISOString();
    for (const id of ids) {
      if (accessTouched.has(id)) continue;
      const e = entries.find((x) => x.id === id);
      if (e && !e.deleted) {
        e.accessedAt = now;
        accessTouched.add(id);
        changed++;
      }
    }
    if (changed) saveEntries(entries);
  } catch {
    /* fail-open */
  }
  return changed;
}

export function loadEntries(): MemoryEntry[] {
  ensureDir();
  const store = readEntriesFile();
  if (!store || !Array.isArray(store.entries)) return [];
  return store.entries.map(migrateEntry).map(sanitizeEntry);
}

function migrateEntry(e: MemoryEntry): MemoryEntry {
  if (!e.observedAt) e.observedAt = e.createdAt;
  if (!e.id) e.id = randomUUID();
  if (typeof e.deleted !== 'boolean') e.deleted = false;
  if (!e.accessedAt || Number.isNaN(new Date(e.accessedAt).getTime())) {
    e.accessedAt =
      e.observedAt && !Number.isNaN(new Date(e.observedAt).getTime()) ? e.observedAt : new Date().toISOString();
  }
  if (!e.contentHash && e.content) {
    e.contentHash = computeContentHash(e.content);
  }
  return e;
}

export function saveEntries(entries: MemoryEntry[], opts: { excludeIds?: Set<string> } = {}): MemoryEntry[] {
  let merged = entries;
  try {
    const onDisk = readEntriesRaw();
    if (onDisk.length > 0) {
      const byId = new Map(entries.map((e) => [e.id, e]));
      for (const d of onDisk) {
        if (d.id && !byId.has(d.id) && !d.deleted && !opts.excludeIds?.has(d.id)) byId.set(d.id, d);
      }
      merged = [...byId.values()];
    }
  } catch {
    /* 读失败用传入快照 */
  }
  writeJSONSync(entriesFile(), { version: STORE_VERSION, entries: merged.map(sanitizeEntry) } satisfies MemoryStore);
  return merged;
}

function readEntriesRaw(): MemoryEntry[] {
  ensureDir();
  const store = readEntriesFile();
  if (!store || !Array.isArray(store.entries)) return [];
  return store.entries;
}

export function activeEntries(entries: MemoryEntry[]): MemoryEntry[] {
  return entries.filter((e) => !e.deleted && !e.supersededBy);
}

export function getTotalSize(entries: MemoryEntry[]): number {
  return entries.reduce((sum, e) => sum + Buffer.byteLength(e.title + e.content, 'utf-8'), 0);
}

// ── links 双向链接 ──

const LINK_SIM = 0.34;
function titleBigrams(s: string): Set<string> {
  const t = String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function linkSim(a: string, b: string): number {
  const A = titleBigrams(a);
  const B = titleBigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
export function linkEntries(entries: MemoryEntry[], aId: string, bId: string): void {
  if (aId === bId) return;
  const a = entries.find((e) => e.id === aId);
  const b = entries.find((e) => e.id === bId);
  if (!a || !b) return;
  a.links = a.links || [];
  b.links = b.links || [];
  if (!a.links.includes(bId)) a.links.push(bId);
  if (!b.links.includes(aId)) b.links.push(aId);
}
export function autoLinkNewEntry(entries: MemoryEntry[], fresh: MemoryEntry): void {
  let best: MemoryEntry | null = null;
  let bestSim = 0;
  for (const e of entries) {
    if (e.deleted || e.id === fresh.id) continue;
    const s = linkSim(e.title, fresh.title);
    if (s > bestSim) {
      bestSim = s;
      best = e;
    }
  }
  if (best && bestSim >= LINK_SIM) linkEntries(entries, best.id, fresh.id);
}

// ── 写入与消解 ──

export function storeEntry(
  entries: MemoryEntry[],
  entry: MemoryEntry,
): { entries: MemoryEntry[]; action: 'created' | 'merged' | 'updated' } {
  const live = activeEntries(entries);

  const titleMatch = live.findIndex((e) => e.title.toLowerCase() === entry.title.toLowerCase());
  if (titleMatch !== -1) {
    const e = live[titleMatch];
    e.content = entry.content;
    e.contentHash = computeContentHash(entry.content);
    e.tags = [...new Set([...e.tags, ...entry.tags])];
    e.environments = mergeEnvironments(e.environments, entry.environments);
    e.confidence = Math.max(e.confidence, entry.confidence);
    e.recurrence += 1;
    e.updatedAt = entry.updatedAt;
    e.accessedAt = entry.accessedAt;
    if (entry.lastSessionId) e.lastSessionId = entry.lastSessionId;
    const merged = saveEntries(entries);
    return { entries: merged, action: 'updated' };
  }

  const newHash = computeContentHash(entry.content);
  const hashMatch = live.findIndex((e) => e.contentHash && e.contentHash === newHash);
  if (hashMatch !== -1) {
    const e = live[hashMatch];
    e.tags = [...new Set([...e.tags, ...entry.tags])];
    e.environments = mergeEnvironments(e.environments, entry.environments);
    e.confidence = Math.max(e.confidence, entry.confidence);
    e.recurrence += 1;
    e.updatedAt = entry.updatedAt;
    e.accessedAt = entry.accessedAt;
    if (entry.lastSessionId) e.lastSessionId = entry.lastSessionId;
    const merged = saveEntries(entries);
    return { entries: merged, action: 'merged' };
  }

  // 近似内容合并：hash 完全相同已在上方命中；此处按 jaccard 合并近似重复（不同措辞的同义内容）。
  const contentTokens = tokenize(entry.content);
  const mergeIdx = live.findIndex((e) => jaccardSimilarity(contentTokens, tokenize(e.content)) > 0.7);
  if (mergeIdx !== -1) {
    const e = live[mergeIdx];
    if (contentTokens.length > tokenize(e.content).length) {
      e.content = entry.content;
    }
    e.contentHash = computeContentHash(e.content);
    e.tags = [...new Set([...e.tags, ...entry.tags])];
    e.environments = mergeEnvironments(e.environments, entry.environments);
    e.confidence = Math.max(e.confidence, entry.confidence);
    e.recurrence += 1;
    e.updatedAt = entry.updatedAt;
    e.accessedAt = entry.accessedAt;
    if (entry.lastSessionId) e.lastSessionId = entry.lastSessionId;
    const merged = saveEntries(entries);
    return { entries: merged, action: 'merged' };
  }

  entry.contentHash = newHash;
  entries.push(entry);
  autoLinkNewEntry(entries, entry);
  const merged2 = saveEntries(entries);
  return { entries: merged2, action: 'created' };
}

export function applyMem0Action(
  entries: MemoryEntry[],
  action: MemoryAction,
  candidate: MemoryEntry,
  targetId?: string,
): { entries: MemoryEntry[]; applied: boolean } {
  switch (action) {
    case 'ADD': {
      candidate.contentHash = computeContentHash(candidate.content);
      entries.push(candidate);
      autoLinkNewEntry(entries, candidate);
      const merged = saveEntries(entries);
      return { entries: merged, applied: true };
    }
    case 'UPDATE': {
      const idx = entries.findIndex((e) => e.id === targetId);
      if (idx === -1) return { entries, applied: false };
      const e = entries[idx];
      e.content = candidate.content;
      e.contentHash = computeContentHash(candidate.content);
      e.tags = [...new Set([...e.tags, ...candidate.tags])];
      e.confidence = Math.max(e.confidence, candidate.confidence);
      e.recurrence += 1;
      e.updatedAt = candidate.updatedAt;
      e.accessedAt = candidate.accessedAt;
      if (candidate.observedAt) e.observedAt = candidate.observedAt;
      e.environments = mergeEnvironments(e.environments, candidate.environments);
      const merged = saveEntries(entries);
      return { entries: merged, applied: true };
    }
    case 'DELETE': {
      const idx = entries.findIndex((e) => e.id === targetId);
      if (idx === -1) return { entries, applied: false };
      entries[idx].deleted = true;
      entries[idx].updatedAt = new Date().toISOString();
      const merged = saveEntries(entries);
      return { entries: merged, applied: true };
    }
    case 'NOOP':
      return { entries, applied: false };
  }
}

export function deleteEntry(entries: MemoryEntry[], id: string): boolean {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries[idx].deleted = true;
  entries[idx].updatedAt = new Date().toISOString();
  saveEntries(entries);
  return true;
}

export function pruneEntries(entries: MemoryEntry[]): { removed: number; titles: string[] } {
  const now = Date.now();
  const before = entries.length;
  const removedTitles: string[] = [];
  const kept = entries.filter((e) => {
    if (e.deleted) return false;
    const ts = new Date(e.accessedAt).getTime();
    const age = Number.isNaN(ts) ? 0 : now - ts;
    const daysOld = age / (1000 * 60 * 60 * 24);
    if (e.confidence < PRUNE_CONFIDENCE && daysOld > PRUNE_DAYS) return false;
    if (e.recurrence < PRUNE_RECURRENCE && daysOld > PRUNE_DAYS_LOW) return false;
    return true;
  });
  const keptSet = new Set(kept);
  const prunedIds = new Set<string>();
  if (kept.length < before) {
    for (const e of entries) {
      if (!keptSet.has(e)) {
        removedTitles.push(e.title);
        prunedIds.add(e.id);
      }
    }
  }
  const removed = before - kept.length;
  entries.length = 0;
  entries.push(...kept);
  saveEntries(entries, { excludeIds: prunedIds });
  return { removed, titles: removedTitles };
}

export function autoReclaim(entries: MemoryEntry[], softLimit = 600): MemoryEntry[] | null {
  if (entries.length <= softLimit) return null;
  const kept = entries.filter((e) => !e.deleted);
  if (kept.length === entries.length) return null;
  saveEntries(kept);
  return kept;
}

export function getStats(entries: MemoryEntry[]): MemoryStats {
  const now = Date.now();
  const byCategory: Record<string, number> = {};
  let oldest: string | null = null;
  let newest: string | null = null;
  let cold = 0;
  let superseded = 0;

  for (const e of entries) {
    if (e.deleted) continue;
    if (e.supersededBy) {
      superseded++;
      continue;
    }
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    if (!oldest || e.createdAt < oldest) oldest = e.createdAt;
    if (!newest || e.createdAt > newest) newest = e.createdAt;
    const ts = new Date(e.accessedAt).getTime();
    const age = Number.isNaN(ts) ? 0 : now - ts;
    if (age / (1000 * 60 * 60 * 24) > PRUNE_DAYS) cold++;
  }

  return {
    totalEntries: entries.length,
    activeEntries: activeEntries(entries).length,
    byCategory,
    totalSizeBytes: getTotalSize(entries),
    oldestEntry: oldest,
    newestEntry: newest,
    coldEntries: cold,
    summaries: loadSummaries().length,
    superseded,
  };
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[\s,，。.、：:;；!！?？()（）[\]【】{}""''/\\\-_+#@$%^&*=|~`]+/)
    .filter((t) => t.length > 0);
  const cjk = text.replace(/[^\u4e00-\u9fff]/g, '');
  if (cjk.length >= 2) {
    for (let i = 0; i < cjk.length - 1; i++) {
      tokens.push(cjk.slice(i, i + 2));
    }
  }
  return tokens;
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export function mergeEnvironments(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  const base = existing && existing.length > 0 ? existing : ['all'];
  const inc = incoming && incoming.length > 0 ? incoming : ['all'];
  return [...new Set([...base, ...inc])];
}
