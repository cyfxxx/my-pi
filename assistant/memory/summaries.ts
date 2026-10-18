/**
 * 会话摘要存储（与原项目 `summaries.json` 同 schema，便于后续接 LLM 精炼）。
 *
 * 当前实现是**确定性摘要**（不花模型调用）：标题取首个有信息量的意图，
 * fullText 取意图账本 + 最后一条助手回复的摘录；decisions/facts/prefs/lessons 留空，
 * 等后续"LLM 精炼"再填（schema 已经给它们留好位置）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scrubSecrets, tokenize } from './store';

export const SUMMARY_VERSION = 1;
export const MAX_SUMMARIES = 50;

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

export interface SummaryStore {
  version: number;
  summaries: SummaryEntry[];
}

export function loadSummaries(file: string): SummaryStore {
  if (!existsSync(file)) return { version: SUMMARY_VERSION, summaries: [] };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<SummaryStore>;
    const summaries = Array.isArray(raw.summaries)
      ? raw.summaries.filter((s): s is SummaryEntry => typeof s?.fullText === 'string')
      : [];
    return { version: typeof raw.version === 'number' ? raw.version : SUMMARY_VERSION, summaries };
  } catch {
    return { version: SUMMARY_VERSION, summaries: [] };
  }
}

export function saveSummaries(file: string, store: SummaryStore): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

export interface SummaryInput {
  readonly sessionId: string;
  readonly intents: readonly string[];
  readonly lastAssistant: string;
  readonly now?: string;
}

/** 确定性摘要：同 sessionId 覆盖，保留最近 MAX_SUMMARIES 条。 */
export function upsertSummary(store: SummaryStore, input: SummaryInput): SummaryEntry {
  const now = input.now ?? new Date().toISOString();
  const title = scrubSecrets((input.intents[0] ?? '（无用户意图）').slice(0, 80));
  const body = [
    input.intents.length > 0 ? `用户意图：\n${input.intents.map((t) => `- ${t}`).join('\n')}` : '',
    input.lastAssistant.trim() !== '' ? `最近回复摘录：\n${input.lastAssistant.trim().slice(0, 400)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const entry: SummaryEntry = {
    id: `sum-${now}`,
    sessionId: input.sessionId,
    ts: now,
    title,
    decisions: [],
    facts: [],
    prefs: [],
    lessons: [],
    fullText: scrubSecrets(body),
  };
  store.summaries = store.summaries.filter((summary) => summary.sessionId !== input.sessionId);
  store.summaries.push(entry);
  if (store.summaries.length > MAX_SUMMARIES) {
    store.summaries = store.summaries.slice(-MAX_SUMMARIES);
  }
  return entry;
}

/** 摘要检索：与记忆同一套 token 口径（中日韩双字 + 拉丁词）。 */
export function searchSummaries(store: SummaryStore, query: string, limit = 3): SummaryEntry[] {
  const q = new Set(tokenize(query));
  if (q.size === 0) return [];
  return store.summaries
    .map((summary) => {
      const tokens = tokenize(`${summary.title} ${summary.fullText}`);
      let hits = 0;
      for (const token of tokens) if (q.has(token)) hits += 1;
      return { summary, score: hits / Math.sqrt(tokens.length + 1) };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.summary);
}
