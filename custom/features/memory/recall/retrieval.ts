/**
 * Memory Feature — 检索（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-memory/retrieval.ts`。
 * 混合检索：BM25 词法 + 质量分；MMR 多样性；跨会话 round-robin；bi-temporal 回溯。
 */

import type { MemoryEntry, MemoryCategory } from '../store/types';
import { activeEntries, tokenize, dataDir, jaccardSimilarity } from '../store/storage';
import { isEnvVisible, type RuntimeEnv } from '../env';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const K1 = 1.5;
const B = 0.75;
const FIELD_WEIGHT = { title: 3, tags: 2, content: 1 } as const;

interface DocTokens {
  title: string[];
  tags: string[];
  content: string[];
  all: Set<string>;
}

export function buildDoc(e: MemoryEntry): DocTokens {
  const title = tokenize(e.title);
  const tags = e.tags.flatMap((t) => tokenize(t));
  const content = tokenize(e.content);
  return { title, tags, content, all: new Set([...title, ...tags, ...content]) };
}

function docLength(d: DocTokens): number {
  return d.title.length * FIELD_WEIGHT.title + d.tags.length * FIELD_WEIGHT.tags + d.content.length * FIELD_WEIGHT.content;
}

export function bm25Score(
  queryTokens: string[],
  doc: DocTokens,
  df: Map<string, number>,
  n: number,
  avgLen: number,
): number {
  const len = docLength(doc);
  let score = 0;
  for (const q of queryTokens) {
    const tf =
      doc.title.filter((t) => t.includes(q) || q.includes(t)).length * FIELD_WEIGHT.title +
      doc.tags.filter((t) => t.includes(q) || q.includes(t)).length * FIELD_WEIGHT.tags +
      doc.content.filter((t) => t.includes(q) || q.includes(t)).length * FIELD_WEIGHT.content;
    if (tf === 0) continue;
    const docFreq = df.get(q) ?? 0;
    const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5));
    score += (idf * (tf * (K1 + 1))) / (tf + K1 * (1 - B + B * (len / (avgLen || 1))));
  }
  return score;
}

export function qualityScore(e: MemoryEntry): number {
  const now = Date.now();
  const ts = e.updatedAt || e.createdAt;
  const tsMs = new Date(ts).getTime();
  const daysOld = Number.isFinite(tsMs) ? (now - tsMs) / (1000 * 60 * 60 * 24) : 90;
  const recency = Math.exp(-daysOld / 90);
  const recurrence = Math.min(e.recurrence / 10, 1);
  return e.confidence * 0.5 + recency * 0.25 + recurrence * 0.25;
}

function tokenJaccard(a: DocTokens, b: DocTokens): number {
  const inter = new Set<string>();
  for (const t of a.all) if (b.all.has(t)) inter.add(t);
  const union = a.all.size + b.all.size - inter.size;
  return union === 0 ? 0 : inter.size / union;
}

interface Scored {
  e: MemoryEntry;
  score: number;
}

export function visibleAt(e: MemoryEntry, asOfTs: number): boolean {
  if (asOfTs < new Date(e.createdAt).getTime()) return false;
  if (e.supersededBy || e.deleted) {
    if (e.validUntil) return new Date(e.validUntil).getTime() > asOfTs;
    return false;
  }
  return true;
}

export function mmrDiversify(
  ranked: Scored[],
  limit: number,
  lambda = 0.7,
  docs: Map<string, DocTokens>,
  bandRatio = 0.15,
): Scored[] {
  if (ranked.length <= limit) return ranked;
  const topScore = ranked[0]?.score ?? 0;
  const anchorThreshold = topScore * (1 - bandRatio);
  const chosen: Scored[] = ranked.filter((r) => r.score >= anchorThreshold);
  if (chosen.length >= limit) return chosen.slice(0, limit);
  const pool = ranked.filter((r) => r.score < anchorThreshold);
  while (chosen.length < limit && pool.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const c of chosen) {
        const sim = tokenJaccard(docs.get(pool[i].e.id)!, docs.get(c.e.id)!);
        if (sim > maxSim) maxSim = sim;
      }
      const v = lambda * pool[i].score - (1 - lambda) * maxSim;
      if (v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }
    chosen.push(pool.splice(bestIdx, 1)[0]);
  }
  return chosen.slice(0, limit);
}

export function roundRobinBySession(ranked: Scored[], limit: number): Scored[] {
  const groups = new Map<string, Scored[]>();
  const order: string[] = [];
  for (const item of ranked) {
    const key = item.e.lastSessionId ?? '__none__';
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }
  const out: Scored[] = [];
  let idx = 0;
  let guard = 0;
  while (out.length < limit && guard < ranked.length * 2) {
    guard++;
    const key = order[idx % order.length];
    const group = groups.get(key)!;
    const item = group.shift();
    if (item) out.push(item);
    idx++;
    if (order.every((k) => groups.get(k)!.length === 0)) break;
  }
  return out.slice(0, limit);
}

export interface SearchOptions {
  category?: MemoryCategory;
  tags?: string[];
  limit?: number;
  env?: RuntimeEnv | 'all';
}

export function searchEntriesWithScores(
  entries: MemoryEntry[],
  query?: string,
  category?: MemoryCategory,
  tags?: string[],
  limit = 5,
  env?: RuntimeEnv | 'all',
  asOf?: string,
): Array<{ entry: MemoryEntry; score: number }> {
  let live: MemoryEntry[];
  if (asOf) {
    const asOfTs = new Date(asOf).getTime();
    if (Number.isNaN(asOfTs)) return [];
    live = entries.filter((e) => visibleAt(e, asOfTs));
  } else {
    live = activeEntries(entries);
  }
  if (!live.length) return [];
  if (env && env !== 'all') {
    live = live.filter((e) => isEnvVisible(e.environments, env));
  }
  if (category) live = live.filter((e) => e.category === category);
  if (tags && tags.length > 0) {
    const lowerTags = tags.map((t) => t.toLowerCase());
    live = live.filter((e) => lowerTags.some((t) => e.tags.some((et) => et.toLowerCase() === t)));
  }
  if (!live.length) return [];

  const queryTokens = query ? tokenize(query) : [];

  if (queryTokens.length === 0) {
    const ranked = live.map((e) => ({ e, score: qualityScore(e) })).sort((a, b) => b.score - a.score);
    return roundRobinBySession(ranked, limit).map((x) => ({ entry: x.e, score: x.score }));
  }

  const docs = live.map((e) => buildDoc(e));
  const n = live.length;
  const avgLen = docs.reduce((s, d) => s + docLength(d), 0) / n;

  const df = new Map<string, number>();
  for (const q of queryTokens) {
    let count = 0;
    for (const d of docs) {
      if ([...d.all].some((t) => t.includes(q) || q.includes(t))) count++;
    }
    df.set(q, count);
  }

  const ranked = live
    .map((e, i) => ({ e, score: 0.7 * bm25Score(queryTokens, docs[i], df, n, avgLen) + 0.3 * qualityScore(e) }))
    .sort((a, b) => b.score - a.score);

  const docMap = new Map(live.map((e, i) => [e.id, docs[i]]));
  const diversified = mmrDiversify(ranked, limit, 0.7, docMap);
  const final = roundRobinBySession(diversified, limit);
  return final.map((x) => ({ entry: x.e, score: x.score }));
}

export function searchEntries(
  entries: MemoryEntry[],
  query?: string,
  category?: MemoryCategory,
  tags?: string[],
  limit = 5,
  env?: RuntimeEnv | 'all',
  asOf?: string,
): MemoryEntry[] {
  return searchEntriesWithScores(entries, query, category, tags, limit, env, asOf).map((x) => x.entry);
}

export interface SearchTraceInput {
  caller: 'memory_search' | 'memory_recall';
  query?: string;
  category?: string;
  tags?: string[];
  limit: number;
  hits: { id: string; title: string; score: number }[];
  tookMs: number;
}

/** 台账文件：portable/memory/memory-search.jsonl（PI_MEMORY_TRACE_FILE 覆盖） */
export function traceFile(): string {
  return process.env.PI_MEMORY_TRACE_FILE || join(dataDir(), 'memory-search.jsonl');
}

export function logSearchTrace(t: SearchTraceInput): void {
  try {
    const file = traceFile();
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > 4_000_000) {
      try {
        renameSync(file, file + '.1');
      } catch {
        /* 并发写可容忍 */
      }
    }
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...t }) + '\n');
  } catch {
    /* fail-open */
  }
}

export function findSimilar(
  entries: MemoryEntry[],
  candidate: MemoryEntry,
  topK = 3,
): Array<{ entry: MemoryEntry; jaccard: number; lexical: number }> {
  const live = activeEntries(entries);
  const cTokens = tokenize(candidate.content);
  const cTitle = tokenize(candidate.title);
  const docs = live.map((e) => buildDoc(e));
  const n = live.length || 1;
  const avgLen = docs.reduce((s, d) => s + docLength(d), 0) / n;
  const query = [...cTitle, ...cTokens.slice(0, 8)];
  const df = dfFor(docs, query);

  const scored = live.map((e, i) => ({
    entry: e,
    jaccard: jaccardSimilarity(cTokens, docs[i].content),
    lexical: bm25Score(query, docs[i], df, n, avgLen),
  }));
  return scored.sort((a, b) => b.jaccard - a.jaccard || b.lexical - a.lexical).slice(0, topK);
}

function dfFor(docs: DocTokens[], tokens: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const q of tokens) {
    let count = 0;
    for (const d of docs) {
      if ([...d.all].some((t) => t.includes(q) || q.includes(t))) count++;
    }
    df.set(q, count);
  }
  return df;
}
