/**
 * 记忆功能的对外门面：把 store 的读写/检索/注入包成插件要用的形状。
 * 真正的语义（去重合并、脱敏、环境可见性）在 `../memory/store.ts`。
 */
import { join } from 'node:path';
import {
  currentEnv,
  loadStore,
  renderInjection as renderInjectionBlock,
  saveStore,
  searchEntries,
  stats as storeStats,
  storeEntry,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryStore,
} from '../memory/store';

export const CATEGORIES: readonly MemoryCategory[] = ['fact', 'preference', 'habit', 'procedure', 'reference', 'solutions'];

export interface MemoryConfig {
  readonly file: string;
  readonly maxInjectEntries: number;
  readonly injectBudgetTokens: number;
  readonly env: string;
}

/** 默认落点：`<assistant>/memory/entries.json`（**入库**，随仓库便携；与原项目同 schema）。 */
export function resolveMemoryConfig(assistantRoot: string): MemoryConfig {
  return {
    file: process.env.MYPI_MEMORY_FILE ?? join(assistantRoot, 'memory', 'entries.json'),
    maxInjectEntries: Number(process.env.MYPI_MEMORY_MAX_ENTRIES ?? '12'),
    injectBudgetTokens: Number(process.env.MYPI_MEMORY_INJECT_TOKENS ?? '600'),
    env: currentEnv(),
  };
}

export function readStore(config: MemoryConfig): MemoryStore {
  return loadStore(config.file);
}

export function writeStore(config: MemoryConfig, store: MemoryStore): void {
  saveStore(config.file, store);
}

export interface StoreArgs {
  readonly category: string;
  readonly title: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly environment?: string;
}

/** 写一条记忆：自动脱敏 + 三级去重合并；返回给模型看的一句话。 */
export function remember(config: MemoryConfig, args: StoreArgs): string {
  const category = (CATEGORIES.includes(args.category as MemoryCategory) ? args.category : 'fact') as MemoryCategory;
  const store = readStore(config);
  const { action, entry } = storeEntry(store, {
    category,
    title: args.title,
    content: args.content,
    tags: args.tags ?? [],
    confidence: args.confidence,
    environments: args.environment ? [args.environment] : ['all'],
    source: 'manual',
  });
  writeStore(config, store);
  const label = { created: '新存入', merged: '合并到已有条目', updated: '更新已有条目' }[action];
  return `已${label}记忆：「${entry.title}」（${entry.category}，recurrence ${entry.recurrence}）`;
}

export function recall(config: MemoryConfig, query: string, limit = 5): MemoryEntry[] {
  return searchEntries(readStore(config), query, limit, config.env);
}

export function formatHit(entry: MemoryEntry): string {
  const tags = entry.tags.length ? `（${entry.tags.join('/')}）` : '';
  return `- ${entry.title}${tags}：${entry.content.slice(0, 300)}`;
}

export function formatStats(config: MemoryConfig): string {
  const s = storeStats(readStore(config));
  const cats = Object.entries(s.byCategory).map(([k, v]) => `${k} ${v}`).join(' / ') || '空';
  const envs = Object.entries(s.byEnv).map(([k, v]) => `${k} ${v}`).join(' / ') || '空';
  return `记忆 ${s.live} 条（含归档 ${s.total}）；类别：${cats}；环境：${envs}；文件：${config.file}`;
}

/** 注入块（append-only 由调用方保证）。 */
export function renderInjection(config: MemoryConfig): string {
  return renderInjectionBlock(readStore(config), {
    budgetTokens: config.injectBudgetTokens,
    maxEntries: config.maxInjectEntries,
    env: config.env,
  });
}
