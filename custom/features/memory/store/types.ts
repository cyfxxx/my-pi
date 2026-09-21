/**
 * Memory Feature — 类型定义（纯类型，零依赖）
 * 迁移自 pi-tools `agent/extensions/pi-memory/types.ts`。
 */

export type MemoryCategory = 'fact' | 'preference' | 'habit' | 'procedure' | 'reference' | 'solutions';

export const CATEGORIES: MemoryCategory[] = ['fact', 'preference', 'habit', 'procedure', 'reference', 'solutions'];
export type MemorySource = 'manual' | 'extract' | 'digest';
export type MemoryAction = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  source: MemorySource;
  recurrence: number;
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  observedAt?: string;
  supersededBy?: string;
  deleted?: boolean;
  environments?: string[];
  lastSessionId?: string;
  validUntil?: string;
  links?: string[];
  contentHash?: string;
}

export interface SummaryEntry {
  id: string;
  sessionId: string | null;
  ts: string;
  title: string;
  decisions: string[];
  facts: string[];
  prefs: string[];
  lessons: string[];
  fullText: string;
}

export interface MemoryStore {
  version: number;
  entries: MemoryEntry[];
}

export interface SummaryStore {
  version: number;
  summaries: SummaryEntry[];
}

export interface MemoryStats {
  totalEntries: number;
  activeEntries: number;
  byCategory: Record<string, number>;
  totalSizeBytes: number;
  oldestEntry: string | null;
  newestEntry: string | null;
  coldEntries: number;
  summaries: number;
  superseded: number;
}
