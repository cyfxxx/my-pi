/**
 * Memory Feature — L2 会话摘要存储（纯逻辑，零 Pi 依赖）
 *
 * 数据落点：`portable/memory/summaries.json`。写路径统一脱敏（scrubSecrets）+ 原子写。
 */

import { join } from 'node:path';
import { writeJSONSync } from '../../../core/atomic-write';
import { scrubSecrets } from '../../../core/secrets';
import type { SummaryEntry, SummaryStore } from './types';
import { dataDir, ensureDir, readStoreFile } from './io';

export const SUMMARY_VERSION = 1;
const MAX_SUMMARIES = 50;

export function summariesFile(): string {
  return join(dataDir(), 'summaries.json');
}

function sanitizeSummary(s: SummaryEntry): SummaryEntry {
  // 历史/损坏数据可能缺字段：逐字段兜底，避免 getStats/注入路径整体抛错。
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => scrubSecrets(x)) : [];
  return {
    ...s,
    id: typeof s.id === 'string' ? s.id : '',
    sessionId: typeof s.sessionId === 'string' ? s.sessionId : null,
    ts: typeof s.ts === 'string' ? s.ts : '',
    title: scrubSecrets(typeof s.title === 'string' ? s.title : ''),
    fullText: scrubSecrets(typeof s.fullText === 'string' ? s.fullText : ''),
    decisions: list(s.decisions),
    facts: list(s.facts),
    prefs: list(s.prefs),
    lessons: list(s.lessons),
  };
}

export function loadSummaries(): SummaryEntry[] {
  ensureDir();
  const store = readStoreFile<SummaryStore>(summariesFile(), 'summaries');
  if (!store || !Array.isArray(store.summaries)) return [];
  return store.summaries.map(sanitizeSummary);
}

export function saveSummaries(summaries: SummaryEntry[]): void {
  writeJSONSync(summariesFile(), { version: SUMMARY_VERSION, summaries } satisfies SummaryStore);
}

export function appendSummary(summary: SummaryEntry): SummaryEntry[] {
  const all = loadSummaries();
  const clean = sanitizeSummary(summary);
  const existing = clean.sessionId ? all.findIndex((s) => s.sessionId === clean.sessionId) : -1;
  if (existing >= 0) {
    all[existing] = clean;
  } else {
    all.push(clean);
  }
  let trimmed = all.length > MAX_SUMMARIES ? all.slice(-MAX_SUMMARIES) : all;
  try {
    const fresh = readStoreFile<SummaryStore>(summariesFile(), 'summaries');
    if (fresh && Array.isArray(fresh.summaries)) {
      const seen = new Set(trimmed.map((s) => s.sessionId));
      for (const d of fresh.summaries) {
        if (d?.sessionId && !seen.has(d.sessionId)) trimmed.push(d);
      }
    }
  } catch {
    /* 读失败用内存态 */
  }
  if (trimmed.length > MAX_SUMMARIES) trimmed = trimmed.slice(-MAX_SUMMARIES);
  saveSummaries(trimmed);
  return trimmed;
}
