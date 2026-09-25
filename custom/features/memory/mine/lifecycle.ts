/**
 * Memory Feature — 生命周期只读报告（纯逻辑，零 Pi 依赖）
 * 实现 VISION §5 治理规则：淘汰候选 / 升格候选 / 冲突嫌疑 / 垃圾嫌疑 / 聚合候选 / 规模陈旧度。
 * 只读幂等：不修改记忆数据；任何写操作须由用户确认（报告仅列出）。
 *
 * 迁移自 pi-tools `agent/extensions/pi-memory/scripts/memory-lifecycle.mjs`（2026-09-25）：
 * 该脚本未随迁移落地，导致「垃圾嫌疑」「聚合候选」两类治理信号丢失（噪声条目会混进升格候选）；
 * 现补齐为纯逻辑，命令 `/memory lifecycle` 与 headless 脚本 `scripts/memory-lifecycle.mjs` 共用。
 * 未迁移 pi-tools 的「空壳心跳」与「环境标签冲突」两类：my-pi 的 `MemoryEntry` 无 `tools`/`hit` 字段，
 * 且环境以 `environments: string[]`（默认 `['all']`）表达，不存在 termux/wsl2 标签混用形态。
 */

import type { MemoryEntry } from '../store/types';
import { activeEntries } from '../store/storage';

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
  /** 聚合：组内最少条数 */
  aggregateMinMembers?: number;
  /** 聚合：组内 Σrecurrence 门槛 */
  aggregateMinSumRecurrence?: number;
  /** 聚合：标题 bigram-jaccard 相似度阈值（中文 bigram 稀疏，故低于冲突阈值） */
  aggregateSimilarity?: number;
}

/** 垃圾嫌疑：content 无实义（归一化后过短）或标题为测试噪声词 */
export interface JunkSuspect extends LifecycleItem {
  category: string;
  recurrence: number;
}

/** 聚合候选：同主题经验 ≥N 条且 Σrecurrence ≥M，建议归纳为单条规则（ExpeL 归纳升级） */
export interface AggregationGroup {
  size: number;
  sumRecurrence: number;
  members: Array<{ id: string; title: string; category: string; recurrence: number; confidence: number }>;
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
  junkSuspects: JunkSuspect[];
  aggregationCandidates: AggregationGroup[];
}

const JUNK_MIN_CONTENT = 30;
const NOISE_TITLE_RE = /^(test|testing|测试|hello|hi|aaa|foo|bar|demo|tmp|temp)$/i;

/** 垃圾嫌疑判定：返回原因，非垃圾返回 null */
export function junkReason(e: Pick<MemoryEntry, 'title' | 'content'>): string | null {
  const content = String(e.content ?? '').replace(/\s+/gu, '');
  if (content.length < JUNK_MIN_CONTENT) return `content 无实义（归一化后 <${JUNK_MIN_CONTENT} 字符）`;
  if (NOISE_TITLE_RE.test(String(e.title ?? '').trim())) return '标题为测试噪声词';
  return null;
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
  const aggregateMinMembers = opts.aggregateMinMembers ?? 3;
  const aggregateMinSumRecurrence = opts.aggregateMinSumRecurrence ?? 8;
  const aggregateSimilarity = opts.aggregateSimilarity ?? 0.34;

  const live = activeEntries(entries);
  const dayMs = 24 * 3600 * 1000;

  const evictionCandidates: LifecycleItem[] = [];
  const promotionCandidates: LifecycleReport['promotionCandidates'] = [];
  const junkSuspects: JunkSuspect[] = [];
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

    const junk = junkReason(e);
    if (junk) junkSuspects.push({ id: e.id, title: e.title, reason: junk, category: e.category, recurrence: e.recurrence });

    if (e.recurrence <= 1 && daysOld > evictDays && e.confidence < evictConfidence) {
      evictionCandidates.push({ id: e.id, title: e.title, reason: `${Math.round(daysOld)} 天未访问且引用 ${e.recurrence} 次、置信度 ${e.confidence}` });
    }
    // 垃圾嫌疑不进升格候选（2026-08-29 修复：噪声条目 "test" rec=34 曾混入）
    if (!junk && (e.category === 'solutions' || e.category === 'fact') && e.recurrence >= promoteRecurrence) {
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

  // 聚合候选：solutions/procedure 标题 bigram-jaccard 聚类（并查集），组内 ≥N 条且 Σrecurrence ≥M
  const expEntries = live.filter((e) => (e.category === 'solutions' || e.category === 'procedure') && !junkReason(e));
  const parent = expEntries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < expEntries.length; i++) {
    for (let j = i + 1; j < expEntries.length; j++) {
      if (titleSim(expEntries[i].title, expEntries[j].title) >= aggregateSimilarity) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, MemoryEntry[]>();
  expEntries.forEach((e, i) => {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(e);
    else groups.set(root, [e]);
  });
  const aggregationCandidates: AggregationGroup[] = [...groups.values()]
    .map((members) => ({
      size: members.length,
      sumRecurrence: members.reduce((a, e) => a + e.recurrence, 0),
      members: members.map((e) => ({ id: e.id, title: e.title, category: e.category, recurrence: e.recurrence, confidence: e.confidence })),
    }))
    .filter((g) => g.size >= aggregateMinMembers && g.sumRecurrence >= aggregateMinSumRecurrence)
    .sort((a, b) => b.sumRecurrence - a.sumRecurrence);

  return {
    total: entries.length,
    active: live.length,
    cold,
    oldest,
    newest,
    evictionCandidates,
    promotionCandidates: promotionCandidates.sort((a, b) => b.recurrence - a.recurrence),
    conflictSuspects,
    junkSuspects,
    aggregationCandidates,
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
    `  垃圾嫌疑 (${r.junkSuspects.length}):`,
    ...(r.junkSuspects.length ? r.junkSuspects.slice(0, 20).map((c) => `    - [${c.category}] ${c.title}：${c.reason}`) : ['    (无)']),
    `  聚合候选 (${r.aggregationCandidates.length}):`,
    ...(r.aggregationCandidates.length
      ? r.aggregationCandidates.slice(0, 20).map((g) => `    - 组（${g.size} 条/Σ引用 ${g.sumRecurrence}）：${g.members.slice(0, 3).map((m) => m.title).join(' / ')}${g.members.length > 3 ? ' …' : ''}`)
      : ['    (无)']),
    '  提示: 淘汰/合并/归纳为写操作，需用户确认后执行。',
  ];
  return lines.join('\n');
}
