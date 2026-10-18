/**
 * 长期记忆的存储与检索（与原项目 `portable/memory/entries.json` **同 schema**）。
 *
 * 为什么要同 schema 而不是自创 JSONL：原项目的记忆是**自我优化闭环**的一环
 * （knowledge-ingest / memory-store 脚本自动入库 → 去重合并 → 注入 → 生命周期治理），
 * schema 一变，128 条历史记忆与后续脚本就都接不上了。见 `docs/design/SELF-OPTIMIZATION.md`。
 *
 * 关键语义（照抄原项目 `store/storage.ts`）：
 *   - 写入先脱敏（`scrubSecrets`），再做**标题匹配 → 内容 hash → 近似内容（jaccard>0.7）**三级去重合并；
 *   - 合并时 confidence 取最大、recurrence+1、tags/environments 取并集；
 *   - 新建条目按标题 bigram 相似度（≥0.34）自动互链；
 *   - 环境可见性过滤（`environments` 含 'all' 或当前环境）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const STORE_VERSION = 2;
export const LINK_SIM = 0.34;
export const MERGE_SIM = 0.7;

export type MemoryCategory = 'fact' | 'preference' | 'habit' | 'procedure' | 'reference' | 'solutions';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  source: string;
  recurrence: number;
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  environments: string[];
  contentHash?: string;
  links?: string[];
  deleted?: boolean;
  supersededBy?: string;
  deletedAt?: string;
}

export interface MemoryStore {
  version: number;
  entries: MemoryEntry[];
}

// ── 脱敏（与原项目 core/secrets.ts 同模式）──────────────────────────────
export const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bsk-[A-Za-z0-9_-]{15,}\b/g, '[REDACTED:api-key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED:jwt]'],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, '[REDACTED:bearer-token]'],
  [/\b(password|passwd|secret|api[_-]?key|token|access[_-]?key)(\s*[=:]\s*)['"]?[^\s'",;]{8,}/gi, '$1$2[REDACTED]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED:google-key]'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, '[REDACTED:slack-token]'],
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

// ── 读写（原子写：临时文件 + rename）────────────────────────────────────
export function loadStore(file: string): MemoryStore {
  if (!existsSync(file)) return { version: STORE_VERSION, entries: [] };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<MemoryStore>;
    const entries = Array.isArray(raw.entries) ? raw.entries.filter((e): e is MemoryEntry => typeof e?.title === 'string') : [];
    return { version: typeof raw.version === 'number' ? raw.version : STORE_VERSION, entries };
  } catch {
    return { version: STORE_VERSION, entries: [] };
  }
}

export function saveStore(file: string, store: MemoryStore): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

// ── 相似度 ─────────────────────────────────────────────────────────────
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  const grams: string[] = [];
  for (const run of cjk) for (let i = 0; i < run.length - 1; i += 1) grams.push(run.slice(i, i + 2));
  return [...latin, ...grams];
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function titleBigrams(title: string): Set<string> {
  const clean = title.toLowerCase().replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i += 1) out.add(clean.slice(i, i + 2));
  return out;
}

export function titleSimilarity(a: string, b: string): number {
  const A = titleBigrams(a);
  const B = titleBigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ── 环境可见性 ─────────────────────────────────────────────────────────
export function currentEnv(): string {
  if (process.env.MYPI_MEMORY_ENV) return process.env.MYPI_MEMORY_ENV;
  if (process.platform === 'win32') return 'windows';
  if (process.env.PREFIX?.includes('com.termux')) return 'termux';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

export function isEnvVisible(entry: MemoryEntry, env = currentEnv()): boolean {
  if (entry.deleted) return false;
  const envs = entry.environments ?? ['all'];
  return envs.includes('all') || envs.includes(env);
}

function mergeEnvironments(a: readonly string[], b: readonly string[]): string[] {
  const merged = new Set([...(a ?? []), ...(b ?? [])]);
  if (merged.has('all') || merged.size === 0) return ['all'];
  return [...merged];
}

// ── 写入（三级去重合并 + 自动互链）──────────────────────────────────────
export interface StoreInput {
  readonly category: MemoryCategory;
  readonly title: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly environments?: readonly string[];
  readonly source?: string;
  readonly now?: string;
}

export type StoreAction = 'created' | 'merged' | 'updated';

export function storeEntry(store: MemoryStore, input: StoreInput): { store: MemoryStore; action: StoreAction; entry: MemoryEntry } {
  const now = input.now ?? new Date().toISOString();
  const title = scrubSecrets(input.title.trim());
  const content = scrubSecrets(input.content.trim());
  const tags = (input.tags ?? []).map((t) => scrubSecrets(t)).filter(Boolean);
  const environments = [...(input.environments ?? ['all'])];
  const confidence = typeof input.confidence === 'number' ? input.confidence : 0.7;
  const live = store.entries.filter((e) => !e.deleted);
  const hash = computeContentHash(content);

  const titleMatch = live.find((e) => e.title.toLowerCase() === title.toLowerCase());
  if (titleMatch) {
    titleMatch.content = content;
    titleMatch.contentHash = hash;
    titleMatch.tags = [...new Set([...titleMatch.tags, ...tags])];
    titleMatch.environments = mergeEnvironments(titleMatch.environments, environments);
    titleMatch.confidence = Math.max(titleMatch.confidence, confidence);
    titleMatch.recurrence += 1;
    titleMatch.updatedAt = now;
    titleMatch.accessedAt = now;
    return { store, action: 'updated', entry: titleMatch };
  }

  const hashMatch = live.find((e) => e.contentHash === hash);
  if (hashMatch) {
    hashMatch.tags = [...new Set([...hashMatch.tags, ...tags])];
    hashMatch.environments = mergeEnvironments(hashMatch.environments, environments);
    hashMatch.confidence = Math.max(hashMatch.confidence, confidence);
    hashMatch.recurrence += 1;
    hashMatch.updatedAt = now;
    hashMatch.accessedAt = now;
    return { store, action: 'merged', entry: hashMatch };
  }

  const tokens = tokenize(content);
  const nearMatch = live.find((e) => jaccard(tokens, tokenize(e.content)) > MERGE_SIM);
  if (nearMatch) {
    if (tokens.length > tokenize(nearMatch.content).length) {
      nearMatch.content = content;
      nearMatch.contentHash = hash;
    }
    nearMatch.tags = [...new Set([...nearMatch.tags, ...tags])];
    nearMatch.environments = mergeEnvironments(nearMatch.environments, environments);
    nearMatch.confidence = Math.max(nearMatch.confidence, confidence);
    nearMatch.recurrence += 1;
    nearMatch.updatedAt = now;
    nearMatch.accessedAt = now;
    return { store, action: 'merged', entry: nearMatch };
  }

  const entry: MemoryEntry = {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    category: input.category,
    title,
    content,
    tags,
    confidence,
    source: input.source ?? 'manual',
    recurrence: 1,
    createdAt: now,
    updatedAt: now,
    accessedAt: now,
    environments,
    contentHash: hash,
  };
  // 自动互链：与最相似的已有条目互链（阈值与原项目一致）
  let best: MemoryEntry | undefined;
  let bestSim = 0;
  for (const e of live) {
    const sim = titleSimilarity(e.title, entry.title);
    if (sim > bestSim) {
      bestSim = sim;
      best = e;
    }
  }
  if (best && bestSim >= LINK_SIM) {
    entry.links = [best.id];
    best.links = [...new Set([...(best.links ?? []), entry.id])];
  }
  store.entries.push(entry);
  return { store, action: 'created', entry };
}

// ── 检索与注入 ─────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;

export function scoreEntry(entry: MemoryEntry, queryTokens: ReadonlySet<string>, now = Date.now()): number {
  const tokens = tokenize(`${entry.title} ${entry.content} ${entry.tags.join(' ')}`);
  let hits = 0;
  for (const token of tokens) if (queryTokens.has(token)) hits += 1;
  if (hits === 0) return 0;
  const ageDays = Math.max(0, (now - Date.parse(entry.updatedAt || entry.createdAt)) / DAY_MS);
  const recency = 1 / (1 + ageDays / 30);
  return (hits / Math.sqrt(tokens.length + 1)) * (0.5 + entry.confidence) * (1 + 0.1 * Math.min(entry.recurrence, 5)) * (0.5 + recency);
}

export function searchEntries(store: MemoryStore, query: string, limit = 5, env = currentEnv()): MemoryEntry[] {
  const q = new Set(tokenize(query));
  if (q.size === 0) return [];
  return store.entries
    .filter((e) => isEnvVisible(e, env))
    .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.entry);
}

/** 粗估 token：CJK 约 1 字/token，拉丁约 4 字符/token。 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

export interface InjectionOptions {
  readonly budgetTokens?: number;
  readonly maxEntries?: number;
  readonly env?: string;
}

/** 注入块：按分数取前 N 条，在 token 预算内截断；块首声明"以本条为准"。 */
export function renderInjection(store: MemoryStore, options: InjectionOptions = {}): string {
  const budget = options.budgetTokens ?? Number(process.env.MYPI_MEMORY_INJECT_TOKENS ?? '600');
  const maxEntries = options.maxEntries ?? Number(process.env.MYPI_MEMORY_MAX_ENTRIES ?? '12');
  const env = options.env ?? currentEnv();
  const ranked = store.entries
    .filter((e) => isEnvVisible(e, env))
    .sort((a, b) => scoreEntry(b, new Set(tokenize(`${b.title} ${b.content}`))) - scoreEntry(a, new Set(tokenize(`${a.title} ${a.content}`))) || b.recurrence - a.recurrence)
    .slice(0, maxEntries);
  if (ranked.length === 0) return '';
  const header = '[mypi-memory] 以下是长期记忆的最新快照（若与历史中的旧快照冲突，以本条为准）：';
  const lines: string[] = [];
  let used = estimateTokens(header);
  for (const entry of ranked) {
    const line = `- ${entry.title}：${entry.content.replace(/\s+/g, ' ').slice(0, 200)}`;
    const cost = estimateTokens(line);
    if (used + cost > budget) break;
    lines.push(line);
    used += cost;
  }
  if (lines.length === 0) return '';
  return `${header}\n${lines.join('\n')}`;
}

export function stats(store: MemoryStore): { total: number; live: number; byCategory: Record<string, number>; byEnv: Record<string, number> } {
  const live = store.entries.filter((e) => !e.deleted);
  const byCategory: Record<string, number> = {};
  const byEnv: Record<string, number> = {};
  for (const entry of live) {
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
    for (const env of entry.environments.length ? entry.environments : ['all']) byEnv[env] = (byEnv[env] ?? 0) + 1;
  }
  return { total: store.entries.length, live: live.length, byCategory, byEnv };
}
