/**
 * Memory Feature — 生命周期只读报告（纯逻辑，零 Pi 依赖）
 * 实现 VISION §5 治理规则：淘汰候选 / 升格候选 / 冲突嫌疑 / 规模陈旧度。
 * 只读幂等：不修改记忆数据；任何写操作须由用户确认（报告仅列出）。
 */

import type { MemoryEntry } from './types';
import { activeEntries } from './storage';

export interface LifecycleOptions {
  now?: number;
  /** 淘汰：accessedAt 距今超过天数 */
  evictDays?: number;
  /** 淘汰：confidence 低于阈值 */
  evictConfidence?: number;
  /** 升格：recurrence 达到次数 */
  promoteRecurrence?: number;
  /** 冲突：标题 bigram-jaccard 相似度阈值 */
  conflictSimilarity?: number;
}

export interface LifecycleItem {
  id: string;
  title: string;
  reason: string;
}

export interface ConflictSuspect {
  aId: string;
  aTitle: string;
  bId: string;
  bTitle: string;
  similarity: number;
}

export interface LifecycleReport {
  total: number;
  active: number;
  cold: number;
  oldest: string | null;
  newest: string | null;
  evictionCandidates: LifecycleItem[];
  promotionCandidates: Array<LifecycleItem & { recurrence: number; category: string }>;
  conflictSuspects: ConflictSuspect[];
}

function titleBigrams(s: string): Set<string> {
  const t = String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function titleSim(a: string, b: string): number {
  const A = titleBigrams(a);
  const B = titleBigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function analyzeLifecycle(entries: MemoryEntry[], opts: LifecycleOptions = {}): LifecycleReport {
  const now = opts.now ?? Date.now();
  const evictDays = opts.evictDays ?? 180;
  const evictConfidence = opts.evictConfidence ?? 0.7;
  const promoteRecurrence = opts.promoteRecurrence ?? 5;
  const conflictSimilarity = opts.conflictSimilarity ?? 0.5;

  const live = activeEntries(entries);
  const dayMs = 24 * 3600 * 1000;

  const evictionCandidates: LifecycleItem[] = [];
  const promotionCandidates: LifecycleReport['promotionCandidates'] = [];
  let oldest: string | null = null;
  let newest: string | null = null;
  let cold = 0;

  for (const e of live) {
    const created = e.createdAt;
    if (!oldest || created < oldest) oldest = created;
    if (!newest || created > newest) newest = created;
    const accessed = new Date(e.accessedAt).getTime();
    const daysOld = Number.isFinite(accessed) ? (now - accessed) / dayMs : 0;
    if (daysOld > 30) cold++;

    if (e.recurrence <= 1 && daysOld > evictDays && e.confidence < evictConfidence) {
      evictionCandidates.push({ id: e.id, title: e.title, reason: `${Math.round(daysOld)} 天未访问且引用 ${e.recurrence} 次、置信度 ${e.confidence}` });
    }
    if ((e.category === 'solutions' || e.category === 'fact') && e.recurrence >= promoteRecurrence) {
      promotionCandidates.push({ id: e.id, title: e.title, reason: `引用 ${e.recurrence} 次`, recurrence: e.recurrence, category: e.category });
    }
  }

  // 冲突嫌疑：同类别 + 标题相似（O(n²)，n 受 activeEntries 规模约束）
  const conflictSuspects: ConflictSuspect[] = [];
  const CAP = 300;
  const pool = live.slice(0, CAP);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (pool[i].category !== pool[j].category) continue;
      const sim = titleSim(pool[i].title, pool[j].title);
      if (sim >= conflictSimilarity) {
        conflictSuspects.push({ aId: pool[i].id, aTitle: pool[i].title, bId: pool[j].id, bTitle: pool[j].title, similarity: sim });
        if (conflictSuspects.length >= 50) break;
      }
    }
    if (conflictSuspects.length >= 50) break;
  }
  conflictSuspects.sort((a, b) => b.similarity - a.similarity);

  return {
    total: entries.length,
    active: live.length,
    cold,
    oldest,
    newest,
    evictionCandidates,
    promotionCandidates: promotionCandidates.sort((a, b) => b.recurrence - a.recurrence),
    conflictSuspects,
  };
}

export function formatLifecycleReport(r: LifecycleReport): string {
  const lines = [
    '记忆生命周期报告（只读）:',
    `  规模: 总 ${r.total} / 活跃 ${r.active} / 冷数据(>30天) ${r.cold}`,
    `  最早: ${r.oldest?.slice(0, 10) ?? '-'}   最新: ${r.newest?.slice(0, 10) ?? '-'}`,
    `  淘汰候选 (${r.evictionCandidates.length}):`,
    ...(r.evictionCandidates.length ? r.evictionCandidates.slice(0, 20).map((c) => `    - ${c.title}：${c.reason}`) : ['    (无)']),
    `  升格候选 (${r.promotionCandidates.length}):`,
    ...(r.promotionCandidates.length ? r.promotionCandidates.slice(0, 20).map((c) => `    - [${c.category}] ${c.title}：${c.reason}`) : ['    (无)']),
    `  冲突嫌疑 (${r.conflictSuspects.length}):`,
    ...(r.conflictSuspects.length ? r.conflictSuspects.slice(0, 20).map((c) => `    - "${c.aTitle}" ↔ "${c.bTitle}"（相似度 ${(c.similarity * 100).toFixed(0)}%）`) : ['    (无)']),
    '  提示: 淘汰/合并为写操作，需用户确认后执行。',
  ];
  return lines.join('\n');
}
