/**
 * 记忆检索：BM25（标题加权）+ 质量分 + MMR 去重（对齐原项目 `recall/retrieval.ts` 的口径）。
 *
 * 为什么不用"命中计数"：条目一多，短条目会靠"词多"占便宜，长条目被稀释；
 * BM25 的 idf 与长度归一化能压住这两点，标题加权把"标题即索引"的原项目约定带回来。
 */
import { isEnvVisible, tokenize, type MemoryEntry, type MemoryStore } from './store';

export interface ScoredEntry {
  readonly entry: MemoryEntry;
  readonly score: number;
}

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 2;
const DEFAULT_LAMBDA = 0.7;
const DAY_MS = 86_400_000;

interface Doc {
  readonly entry: MemoryEntry;
  readonly body: readonly string[];
  readonly title: readonly string[];
  readonly length: number;
}

function buildDoc(entry: MemoryEntry): Doc {
  const body = tokenize(`${entry.content} ${entry.tags.join(' ')}`);
  const title = tokenize(entry.title);
  return { entry, body, title, length: body.length + TITLE_WEIGHT * title.length };
}

/** idf：log(1 + (N - df + 0.5)/(df + 0.5))。 */
function idf(docs: readonly Doc[], term: string): number {
  let df = 0;
  for (const doc of docs) if (doc.body.includes(term) || doc.title.includes(term)) df += 1;
  return Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
}

function termFrequency(doc: Doc, term: string): number {
  let tf = 0;
  for (const token of doc.body) if (token === term) tf += 1;
  for (const token of doc.title) if (token === term) tf += TITLE_WEIGHT;
  return tf;
}

function bm25(queryTokens: readonly string[], docs: readonly Doc[]): number[] {
  const avgLength = docs.reduce((total, doc) => total + doc.length, 0) / Math.max(1, docs.length);
  const idfs = new Map<string, number>();
  for (const term of new Set(queryTokens)) idfs.set(term, idf(docs, term));
  return docs.map((doc) => {
    let score = 0;
    for (const [term, idfValue] of idfs) {
      const tf = termFrequency(doc, term);
      if (tf === 0) continue;
      const norm = 1 - B + (B * doc.length) / Math.max(1, avgLength);
      score += idfValue * ((tf * (K1 + 1)) / (tf + K1 * norm));
    }
    return score;
  });
}

/** 质量分：置信度 + 复现次数 + 时间新鲜度（30 天半衰期）。 */
export function qualityScore(entry: MemoryEntry, now = Date.now()): number {
  const confidence = 0.5 + Math.max(0, Math.min(1, entry.confidence ?? 0.7));
  const recurrence = 1 + 0.1 * Math.min(entry.recurrence ?? 1, 5);
  const ageDays = Math.max(0, (now - Date.parse(entry.updatedAt || entry.createdAt || new Date(0).toISOString())) / DAY_MS);
  const recency = 1 / (1 + ageDays / 30);
  return confidence * recurrence * (0.5 + 0.5 * recency);
}

/** MMR：在"相关"与"不重复"之间折中，避免注入几条几乎一样的记忆。 */
function mmrSelect(candidates: readonly ScoredEntry[], docs: ReadonlyMap<string, Doc>, limit: number, lambda: number): ScoredEntry[] {
  const selected: ScoredEntry[] = [];
  const pool = [...candidates];
  const maxScore = Math.max(...candidates.map((c) => c.score), 1e-9);
  while (selected.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      const doc = docs.get(candidate.entry.id);
      let overlap = 0;
      if (doc !== undefined) {
        for (const chosen of selected) {
          const other = docs.get(chosen.entry.id);
          if (other === undefined) continue;
          const a = new Set([...doc.body, ...doc.title]);
          const b = new Set([...other.body, ...other.title]);
          let inter = 0;
          for (const token of a) if (b.has(token)) inter += 1;
          const union = a.size + b.size - inter;
          overlap = Math.max(overlap, union === 0 ? 0 : inter / union);
        }
      }
      const value = lambda * (candidate.score / maxScore) - (1 - lambda) * overlap;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    selected.push(pool[bestIndex]);
    pool.splice(bestIndex, 1);
  }
  return selected;
}

/** 按来源（source）轮转：避免同一会话/同一知识源把整页占满（原项目的"会话轮转"）。 */
function roundRobinBySource(scored: readonly ScoredEntry[], limit: number): ScoredEntry[] {
  const buckets = new Map<string, ScoredEntry[]>();
  for (const candidate of scored) {
    const key = candidate.entry.source || 'unknown';
    const list = buckets.get(key);
    if (list === undefined) buckets.set(key, [candidate]);
    else list.push(candidate);
  }
  const ordered = [...buckets.entries()].sort((a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0));
  const out: ScoredEntry[] = [];
  let progressed = true;
  while (progressed && out.length < limit) {
    progressed = false;
    for (const [, list] of ordered) {
      const next = list.shift();
      if (next === undefined) continue;
      out.push(next);
      progressed = true;
      if (out.length >= limit) break;
    }
  }
  return out;
}

export interface SearchOptions {
  readonly limit?: number;
  readonly env?: string;
  readonly lambda?: number;
  readonly now?: number;
}

/** 检索主入口：环境过滤 → BM25 × 质量分 → MMR。 */
export function searchWithScores(store: MemoryStore, query: string, options: SearchOptions = {}): ScoredEntry[] {
  const limit = options.limit ?? 5;
  const now = options.now ?? Date.now();
  const env = options.env;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const live = store.entries.filter((entry) => isEnvVisible(entry, env));
  const docs = live.map(buildDoc);
  if (docs.length === 0) return [];
  const raw = bm25(queryTokens, docs);
  const scored: ScoredEntry[] = docs
    .map((doc, index) => ({ entry: doc.entry, score: raw[index] * qualityScore(doc.entry, now) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  const docsById = new Map(docs.map((doc) => [doc.entry.id, doc]));
  // 先 MMR 去重（内容不重复），再按来源轮转（广度），最后截到 limit。
  const deduped = mmrSelect(scored, docsById, Math.max(limit * 3, limit), options.lambda ?? DEFAULT_LAMBDA);
  return roundRobinBySource(deduped, limit);
}
