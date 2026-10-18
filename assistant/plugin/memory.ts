/**
 * 长期记忆（最小版）：JSONL 存储 + 三个工具 + **append-only** 注入。
 *
 * 注入规则（见 docs/design/ASSISTANT-PLAN.md「记忆注入会不会打穿前缀缓存」）：
 *   1. 只在**回合第一步**注入，作为请求消息列表的**末尾追加**（绝不改写历史、绝不进 system prompt）；
 *   2. 内容与上次注入相同则不注入（去重）；
 *   3. 有上限（条数/字符），旧快照随压缩折叠。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface MemoryEntry {
  readonly id: string;
  readonly ts: string;
  readonly text: string;
  readonly tags: readonly string[];
}

export interface MemoryConfig {
  readonly file: string;
  readonly maxInjectEntries: number;
  readonly maxInjectChars: number;
}

export function resolveMemoryConfig(baseDir: string): MemoryConfig {
  return {
    file: process.env.MYPI_MEMORY_FILE ?? join(baseDir, '.run', 'memory.jsonl'),
    maxInjectEntries: Number(process.env.MYPI_MEMORY_MAX_ENTRIES ?? '12'),
    maxInjectChars: Number(process.env.MYPI_MEMORY_MAX_CHARS ?? '800'),
  };
}

export function readMemories(file: string): MemoryEntry[] {
  if (!existsSync(file)) return [];
  const out: MemoryEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const item = JSON.parse(line) as Partial<MemoryEntry>;
      if (typeof item.text === 'string' && item.text.trim() !== '') {
        out.push({
          id: typeof item.id === 'string' ? item.id : '',
          ts: typeof item.ts === 'string' ? item.ts : '',
          text: item.text,
          tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : [],
        });
      }
    } catch {
      /* 跳过坏行（不因一行坏了丢整个库） */
    }
  }
  return out;
}

export function appendMemory(file: string, text: string, tags: readonly string[]): MemoryEntry {
  const entry: MemoryEntry = {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    text: text.trim(),
    tags,
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

/** 中日韩按双字切片，拉丁按词切片——对中文更稳的粗排。 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_]+/g) ?? [];
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  const grams: string[] = [];
  for (const run of cjk) {
    for (let i = 0; i < run.length - 1; i += 1) grams.push(run.slice(i, i + 2));
    if (run.length === 1) grams.push(run);
  }
  return [...latin, ...grams];
}

export function searchMemories(entries: readonly MemoryEntry[], query: string, limit = 5): MemoryEntry[] {
  const q = new Set(tokenize(query));
  if (q.size === 0) return [];
  const scored = entries.map((entry, index) => {
    const tokens = tokenize(`${entry.text} ${entry.tags.join(' ')}`);
    let score = 0;
    for (const token of tokens) if (q.has(token)) score += 1;
    // 时间越新越靠前（同分时的稳定 tie-break）
    return { entry, score, index };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .map((row) => row.entry);
}

/** 注入块：取最近 N 条、截断到字符上限，并明确"以本条为准"。 */
export function renderInjection(entries: readonly MemoryEntry[], config: MemoryConfig): string {
  if (entries.length === 0) return '';
  const picked = entries.slice(-config.maxInjectEntries);
  const lines = picked.map((entry) => `- ${entry.text}`);
  let body = lines.join('\n');
  if (body.length > config.maxInjectChars) body = `${body.slice(0, config.maxInjectChars)}…`;
  return [
    '[mypi-memory] 以下是长期记忆的最新快照（若与历史中的旧快照冲突，以本条为准）：',
    body,
  ].join('\n');
}
