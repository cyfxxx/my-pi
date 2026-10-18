/**
 * 意图账本：把用户消息里"有信息量"的部分逐字留下来，供压缩后仍能恢复完整意图。
 *
 * 背景：DSH 的压缩会把旧 user 消息一并 shadow 进摘要（`compaction-basic` 不给 user 特殊待遇），
 * 意图只靠摘要指令"要求"保留，不是机器保证。所以我们在**会话级**维护一份 append-only 账本：
 *   - 只记"有信息量"的用户输入（纯推进语过滤掉）；
 *   - 重复意图折叠（保留最新措辞，记次数）；
 *   - 逐字渲染，预算内截断（默认 1000 tokens）；
 * 账本本身也走 append-only 注入（与记忆注入同一通道），因此任何压缩都压不掉它。
 *
 * 数据落在 `<assistant>/.run/intents/<sessionId>.jsonl`（会话级、gitignored）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { estimateTokens, jaccard, tokenize } from './store';

export interface IntentRecord {
  readonly ts: string;
  readonly text: string;
  readonly count: number;
}

/** 纯推进语：不承载新意图，不记账本。 */
const FILLER = [
  /^\s*(继续|继续吧|接着|往下|go on|continue|proceed|resume)[\s。.!！]*$/i,
  /^\s*(好|好的|行|可以|嗯|ok|okay|yes|y)[\s。.!！]*$/i,
  /^\s*(再试一次|重试|retry|try again)[\s。.!！]*$/i,
  /^\s*(谢谢|thanks|thx)[\s。.!！]*$/i,
];

export function isFiller(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return FILLER.some((re) => re.test(trimmed));
}

/** 只留内容块里的文本（工具调用/图片等不算"用户意图"）。 */
export function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.join('\n');
}

/** 折叠：同一意图（jaccard>0.6）只留最新措辞，次数+1；否则追加。 */
export function foldIntent(records: readonly IntentRecord[], text: string, ts = new Date().toISOString()): IntentRecord[] {
  const next = [...records];
  const tokens = tokenize(text);
  for (let index = 0; index < next.length; index += 1) {
    if (jaccard(tokens, tokenize(next[index].text)) > 0.6) {
      next[index] = { ts, text, count: next[index].count + 1 };
      return next;
    }
  }
  next.push({ ts, text, count: 1 });
  return next;
}

export function ledgerFile(baseDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '-');
  return join(baseDir, '.run', 'intents', `${safe}.jsonl`);
}

export function readLedger(file: string): IntentRecord[] {
  if (!existsSync(file)) return [];
  const records: IntentRecord[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const record = JSON.parse(line) as Partial<IntentRecord>;
      if (typeof record.text === 'string' && record.text.trim() !== '') {
        records.push({ ts: record.ts ?? '', text: record.text, count: typeof record.count === 'number' ? record.count : 1 });
      }
    } catch {
      /* 跳过坏行 */
    }
  }
  return records;
}

/** 记录一条意图：先折叠（同义意图只留最新措辞、次数+1），整表原子重写。 */
export function recordIntent(file: string, text: string): IntentRecord[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (isFiller(normalized)) return readLedger(file);
  const next = foldIntent(readLedger(file), normalized.slice(0, 2000));
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, next.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  renameSync(tmp, file);
  return next;
}

/** 渲染账本：逐字、带次数；超预算时从更早的条目开始丢。 */
export function renderIntentLedger(records: readonly IntentRecord[], budgetTokens = 1000): string {
  if (records.length === 0) return '';
  const header = '[mypi-intent] 用户意图账本（逐字摘录，按时间顺序；括号内是该意图出现的次数）：';
  const lines: string[] = [];
  let used = estimateTokens(header);
  for (const record of [...records].reverse()) {
    const line = `- ${record.text}${record.count > 1 ? `（×${record.count}）` : ''}`;
    const cost = estimateTokens(line);
    if (used + cost > budgetTokens) break;
    lines.unshift(line);
    used += cost;
  }
  if (lines.length === 0) return '';
  return `${header}\n${lines.join('\n')}`;
}
