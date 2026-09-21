/**
 * Memory Feature — Mem0 式规则消解（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-memory/merge.ts`。
 * 候选 vs 相似既有条目 → ADD/UPDATE/DELETE/NOOP（提取由 LLM 完成，此处纯规则）。
 */

import type { MemoryAction, MemoryEntry } from './types';
import {
  activeEntries,
  tokenize,
  jaccardSimilarity,
  saveEntries,
  applyMem0Action,
  mergeEnvironments,
  linkEntries,
  computeContentHash,
  autoLinkNewEntry,
} from './storage';
import { findSimilar } from '../recall/retrieval';

export interface MergeDecision {
  action: MemoryAction;
  targetId?: string;
  note: string;
}

const OPPOSITE_PAIRS: Array<[string, string]> = [
  ['喜欢', '不喜欢'],
  ['喜欢', '讨厌'],
  ['喜欢', '厌恶'],
  ['启用', '禁用'],
  ['启用', '关闭'],
  ['开启', '关闭'],
  ['开启', '禁用'],
  ['支持', '反对'],
  ['需要', '不需要'],
  ['有用', '无用'],
  ['好用', '不好用'],
  ['能', '不能'],
  ['能', '无法'],
  ['会', '不会'],
  ['是', '不是'],
  ['继续', '停止'],
  ['正常', '异常'],
  ['正常', '故障'],
];

export function detectContradiction(existing: MemoryEntry, candidate: MemoryEntry): boolean {
  const A = existing.content.toLowerCase();
  const B = candidate.content.toLowerCase();
  let hit = false;
  for (const [x, y] of OPPOSITE_PAIRS) {
    if ((A.includes(x) && B.includes(y)) || (A.includes(y) && B.includes(x))) {
      hit = true;
      break;
    }
  }
  if (!hit) return false;
  const aToks = new Set(tokenize(A));
  const bToks = new Set(tokenize(B));
  let common = 0;
  for (const t of aToks) {
    if (bToks.has(t) && t.length >= 2) common++;
  }
  return common >= 2;
}

export async function decideMerge(entries: MemoryEntry[], candidate: MemoryEntry): Promise<MergeDecision> {
  const similar = await findSimilar(entries, candidate, 3);
  if (similar.length === 0) {
    return { action: 'ADD', note: '无相似条目' };
  }

  const best = similar[0];
  const j = best.jaccard;

  for (const { entry } of similar) {
    if (!detectContradiction(entry, candidate)) continue;
    if (entry.source === 'manual' && (candidate.confidence ?? 0) < 0.8) {
      return { action: 'NOOP', note: `矛盾候选置信度不足，保留 manual 条目 ${entry.title}` };
    }
    entry.supersededBy = candidate.id;
    entry.deleted = true;
    linkEntries(entries, entry.id, candidate.id);
    entry.validUntil = new Date().toISOString();
    entry.updatedAt = new Date().toISOString();
    return { action: 'ADD', note: `矛盾取代 ${entry.title}（语义反转，已标记 superseded）` };
  }

  const live = activeEntries(entries);
  const titleMatch = live.find((e) => e.title.toLowerCase() === candidate.title.toLowerCase());
  if (titleMatch) {
    return { action: 'UPDATE', targetId: titleMatch.id, note: `标题匹配: ${titleMatch.title}` };
  }

  if (j > 0.9 && candidate.confidence <= best.entry.confidence) {
    return { action: 'NOOP', note: '已有等价且更优条目' };
  }

  if (j > 0.7) {
    return { action: 'UPDATE', targetId: best.entry.id, note: `内容相似度 ${j.toFixed(2)}` };
  }

  const tagOverlap = candidate.tags.some((t) => best.entry.tags.some((bt) => bt.toLowerCase() === t.toLowerCase()));
  if (
    j < 0.3 &&
    best.entry.category === candidate.category &&
    tagOverlap &&
    candidate.confidence >= best.entry.confidence &&
    best.entry.source !== 'manual'
  ) {
    best.entry.supersededBy = candidate.id;
    best.entry.deleted = true;
    linkEntries(entries, best.entry.id, candidate.id);
    best.entry.validUntil = new Date().toISOString();
    best.entry.updatedAt = new Date().toISOString();
    return { action: 'ADD', note: `取代冲突条目 ${best.entry.title}（已标记 superseded）` };
  }

  return { action: 'ADD', note: '新信息' };
}

export async function mergeCandidates(
  entries: MemoryEntry[],
  candidates: MemoryEntry[],
): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const candidate of candidates) {
    const decision = await decideMerge(entries, candidate);
    if (decision.action === 'NOOP') {
      skipped.push(candidate.title);
      continue;
    }
    if (decision.action === 'ADD') {
      candidate.contentHash = computeContentHash(candidate.content);
      entries.push(candidate);
      applied.push(`ADD: ${candidate.title}`);
      continue;
    }
    if (decision.action === 'UPDATE' && decision.targetId) {
      const idx = entries.findIndex((e) => e.id === decision.targetId);
      if (idx !== -1) {
        const e = entries[idx];
        e.content = candidate.content.length > e.content.length ? candidate.content : e.content;
        e.contentHash = computeContentHash(e.content);
        e.tags = [...new Set([...e.tags, ...candidate.tags])];
        e.confidence = Math.max(e.confidence, candidate.confidence);
        e.recurrence += 1;
        e.updatedAt = candidate.updatedAt;
        e.accessedAt = candidate.accessedAt || e.accessedAt;
        e.observedAt = candidate.observedAt || e.observedAt;
        e.environments = mergeEnvironments(e.environments, candidate.environments);
        applied.push(`UPDATE: ${e.title}`);
      }
      continue;
    }
    if (decision.action === 'DELETE' && decision.targetId) {
      const idx = entries.findIndex((e) => e.id === decision.targetId);
      if (idx !== -1) {
        entries[idx].deleted = true;
        entries[idx].updatedAt = new Date().toISOString();
        applied.push(`DELETE: ${entries[idx].title}`);
      }
    }
  }
  saveEntries(entries);
  return { applied, skipped };
}

export { jaccardSimilarity };
export function similarity(a: string[], b: string[]): number {
  return jaccardSimilarity(a, b);
}

export async function resolveAndApply(
  entries: MemoryEntry[],
  candidate: MemoryEntry,
): Promise<MergeDecision & { applied: boolean }> {
  const decision = await decideMerge(entries, candidate);
  if (decision.action === 'ADD') {
    candidate.contentHash = computeContentHash(candidate.content);
    entries.push(candidate);
    autoLinkNewEntry(entries, candidate);
    saveEntries(entries);
    return { ...decision, applied: true };
  }
  // applyMem0Action 内部已写盘（UPDATE/DELETE），NOOP 无改动；此处不再重复 saveEntries。
  const { applied } = applyMem0Action(entries, decision.action, candidate, decision.targetId);
  return { ...decision, applied };
}
