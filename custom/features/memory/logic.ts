/**
 * Memory Feature - Logic
 *
 * 纯逻辑，零 Pi 依赖
 * 负责记忆存储、检索、注入
 *
 * 笔记持久化复用 custom/core/note-store（原子写 + 写时脱敏，数据落在 portable/memory）。
 */

import { loadNotes as nsLoadNotes, updateNotes as nsUpdateNotes } from '../../core/note-store';

// ── 记忆条目 ──

export interface MemoryEntry {
  id: string;
  content: string;
  type: 'note' | 'memory' | 'summary';
  timestamp: number;
  tags?: string[];
}

// ── 摘要 ──

export interface MemorySummary {
  id: string;
  content: string;
  timestamp: number;
}

// ── 注入块 ──

export interface InjectionBlock {
  block: string;
  entries: number;
  summaries: number;
}

// ── 存储管理 ──

export function loadEntries(): MemoryEntry[] {
  return [];
}

export function loadNotes(): Record<string, string> {
  return nsLoadNotes();
}

export function loadSummaries(): MemorySummary[] {
  return [];
}

export function updateNotes(updater: (notes: Record<string, string>) => Record<string, string>): void {
  nsUpdateNotes(updater);
}

export function activeEntries(entries: MemoryEntry[]): MemoryEntry[] {
  return entries.filter(e => !e.id.startsWith('__') && !e.id.startsWith('_ctx.'));
}

export function autoReclaim(entries: MemoryEntry[]): MemoryEntry[] | undefined {
  return entries;
}

export function migrateFromCtxLite(): void {
  // 纯逻辑：迁移旧格式
}

// ── 注入块构建 ──

export const INJECT_TAG = 'pi-memory-inject';

export function buildInjectionBlock(
  entries: MemoryEntry[],
  summaries: MemorySummary[],
): InjectionBlock {
  let block = '';
  const filtered = activeEntries(entries);
  
  if (filtered.length > 0) {
    block += '## 记忆\n\n';
    for (const entry of filtered) {
      block += `- [${entry.type}] ${entry.content}\n`;
    }
  }
  
  if (summaries.length > 0) {
    block += '\n## 摘要\n\n';
    for (const summary of summaries) {
      block += `- ${summary.content}\n`;
    }
  }
  
  return {
    block,
    entries: filtered.length,
    summaries: summaries.length,
  };
}

// ── 消息过滤 ──

export function filterInjectedMessages(messages: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  
  for (const msg of messages) {
    const m = msg as { customType?: string };
    if (m.customType === INJECT_TAG) {
      if (seen.has(m.customType)) continue;
      seen.add(m.customType);
    }
    result.push(msg);
  }
  
  return result;
}

// ── 提取 ──

export function extractTextFromEntries(entries: unknown[]): string[] {
  return [];
}

export function isExtractWorker(): boolean {
  return process.env.PI_MEMORY_EXTRACT === '1';
}

export function queuePendingExtract(messages: string[], sessionId: string | null): void {
  // 纯逻辑：排队待提取
}

export async function processPendingExtracts(): Promise<{ ok: number; failed: number }> {
  return { ok: 0, failed: 0 };
}

export async function extractConversation(
  messages: string[],
  options: { sessionId: string | null; messageCount: number },
): Promise<void> {
  // 纯逻辑：提取对话
}

// ── 快照 ──

export function writeCompactionSnapshot(ctx: unknown): void {
  // 纯逻辑：写入压缩快照
}