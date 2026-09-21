/**
 * Prune — 工具输出分层擦除（纯逻辑，零 Pi 依赖）
 *
 * 迁移自 pi-tools `agent/services/token-budget/prune.ts`（借鉴 opencode SessionCompaction.prune）。
 * 背景：写入时截断（tool_result 5KB）后，输出仍随轮次逐条保留；长会话中旧工具
 * 输出是上下文主要消耗。本模块在 `context` 事件阶段做确定性"事后擦除"：
 * 保留最近 N 轮 + 保护带 token，更早的已完成 toolResult 输出替换为占位。
 *
 * 缓存纪律：判定只依赖消息内容本身；擦除改变消息序列会断裂前缀缓存，故
 * 保护带/最低回收阈值调高（120K/80K），普通会话不触发，清理职责优先交给
 * auto-compact（一次性断裂 + 摘要）。
 */

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { estimateTokens } from './budget';

export const PRUNE_PROTECT_TOKENS = 120_000;
export const PRUNE_MINIMUM_TOKENS = 80_000;
export const KEEP_RECENT_TURNS = 2;
export const PRUNE_SENTINEL = '[pruned:';
export const NON_TEXT_BLOCK_TOKENS = 1000;
export const DEFAULT_KEEP_THINKING_TOKENS = 64_000;

export const PRUNE_MARKER = (chars: number): string => `[pruned: ${chars} chars]`;
export const PRUNE_MARKER_REF = (chars: number, ref: string): string =>
  `[pruned: ${chars} chars → ${ref}]`;

export interface PruneMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface PruneOptions {
  protectTokens?: number;
  minimumTokens?: number;
  keepRecentTurns?: number;
  dumpRef?: (text: string, meta: { index: number; chars: number }) => string | null;
}

export interface PruneResult {
  messages: PruneMessage[];
  modified: boolean;
  prunedCount: number;
  prunedTokens: number;
  prunedChars: number;
}

/** 从消息 content（blocks 数组）中提取全部文本 */
export function messageText(m: PruneMessage): string {
  if (!Array.isArray(m.content)) return '';
  const parts: string[] = [];
  for (const block of m.content as { type?: string; text?: string }[]) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

export function nonTextBlockCount(m: PruneMessage): number {
  if (!Array.isArray(m.content)) return 0;
  let n = 0;
  for (const block of m.content as { type?: string; text?: string }[]) {
    if (!block || typeof block !== 'object') continue;
    if (block.type !== 'text' || typeof block.text !== 'string') n++;
  }
  return n;
}

/** 已擦除判定：仅 toolResult 且文本 trimStart 后以 sentinel 开头（避免正文含字面量误判） */
export function isPrunedMessage(m: PruneMessage): boolean {
  if (m.role !== 'toolResult') return false;
  return messageText(m).trimStart().startsWith(PRUNE_SENTINEL);
}

/** 将消息 content 中全部块替换为占位文本（text 块与非 text 块一律擦除） */
export function pruneMessageText(m: PruneMessage, chars: number, marker?: string): unknown {
  const text = marker ?? PRUNE_MARKER(chars);
  if (!Array.isArray(m.content)) return m.content;
  return (m.content as { type?: string; text?: string }[]).map((block) => {
    if (!block || typeof block !== 'object') return block;
    if (block.type === 'text' && typeof block.text === 'string') {
      return { ...block, text };
    }
    return { type: 'text', text };
  });
}

export function pruneToolResults(input: PruneMessage[], opts: PruneOptions = {}): PruneResult {
  const protectTokens = opts.protectTokens ?? PRUNE_PROTECT_TOKENS;
  const minimumTokens = opts.minimumTokens ?? PRUNE_MINIMUM_TOKENS;
  const keepRecentTurns = opts.keepRecentTurns ?? KEEP_RECENT_TURNS;

  const messages = input;
  const n = messages.length;
  if (n === 0) return { messages, modified: false, prunedCount: 0, prunedTokens: 0, prunedChars: 0 };

  let userSeen = 0;
  let protectedStart = n;
  for (let i = n - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    userSeen++;
    if (userSeen === keepRecentTurns) {
      protectedStart = i;
      break;
    }
  }

  const sizes: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const m = messages[i];
    if (m.role !== 'toolResult') continue;
    sizes[i] = estimateTokens(messageText(m)) + NON_TEXT_BLOCK_TOKENS * nonTextBlockCount(m);
  }

  let budgetLeft = protectTokens;
  const toPrune: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    if (sizes[i] === 0) continue;
    if (i >= protectedStart) continue;
    if (budgetLeft > 0) {
      budgetLeft = Math.max(0, budgetLeft - sizes[i]);
      continue;
    }
    if (isPrunedMessage(messages[i])) continue;
    toPrune.push(i);
  }

  if (toPrune.length === 0) {
    return { messages, modified: false, prunedCount: 0, prunedTokens: 0, prunedChars: 0 };
  }

  let prunedTokens = 0;
  let prunedChars = 0;
  for (const idx of toPrune) {
    prunedTokens += sizes[idx];
    prunedChars += messageText(messages[idx]).length;
  }

  if (prunedTokens < minimumTokens) {
    return { messages, modified: false, prunedCount: 0, prunedTokens, prunedChars };
  }

  const next = messages.map((m, i) => {
    if (!toPrune.includes(i)) return m;
    const text = messageText(m);
    const chars = text.length;
    let marker: string | undefined;
    if (opts.dumpRef) {
      try {
        const ref = opts.dumpRef(text, { index: i, chars });
        if (ref) marker = PRUNE_MARKER_REF(chars, ref);
      } catch {
        /* 落盘失败降级为纯 chars marker */
      }
    }
    return { ...m, content: pruneMessageText(m, chars, marker) };
  });

  return { messages: next, modified: true, prunedCount: toPrune.length, prunedTokens, prunedChars };
}

export interface SweepRefsOptions {
  retentionDays?: number;
  maxTotalBytes?: number;
}

export interface SweepRefsStats {
  scanned: number;
  deletedByAge: number;
  deletedBySize: number;
  freedBytes: number;
}

/** 清理擦除溯源 refs 目录：过期文件删除 + 总量超限从最旧删起 */
export async function sweepPruneRefs(dir: string, opts: SweepRefsOptions = {}): Promise<SweepRefsStats> {
  const retentionDays = opts.retentionDays ?? 14;
  const maxTotalBytes = opts.maxTotalBytes ?? 50 * 1024 * 1024;
  const stats: SweepRefsStats = { scanned: 0, deletedByAge: 0, deletedBySize: 0, freedBytes: 0 };
  const files: { path: string; mtime: number; size: number }[] = [];
  try {
    for (const name of await readdir(dir)) {
      const p = join(dir, name);
      const st = await stat(p).catch(() => null);
      if (!st?.isFile()) continue;
      files.push({ path: p, mtime: st.mtimeMs, size: st.size });
    }
  } catch {
    return stats;
  }
  stats.scanned = files.length;
  if (retentionDays >= 0) {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    for (const f of files) {
      if (f.mtime >= cutoff) continue;
      try {
        await unlink(f.path);
        stats.deletedByAge++;
        stats.freedBytes += f.size;
        f.size = 0;
      } catch {
        /* 单文件失败忽略 */
      }
    }
  }
  let remaining = files.reduce((s, f) => s + f.size, 0);
  if (remaining > maxTotalBytes) {
    for (const f of [...files].sort((a, b) => a.mtime - b.mtime)) {
      if (remaining <= maxTotalBytes) break;
      if (f.size === 0) continue;
      try {
        await unlink(f.path);
        stats.deletedBySize++;
        stats.freedBytes += f.size;
        remaining -= f.size;
        f.size = 0;
      } catch {
        /* 单文件失败忽略 */
      }
    }
  }
  return stats;
}

/** Thinking 保留预算：从后往前累计，预算耗尽处及更早的 thinking 块删除（保留其余内容） */
export function pruneThinkingBudget(input: PruneMessage[], budgetTokens = DEFAULT_KEEP_THINKING_TOKENS): PruneResult {
  const n = input.length;
  let thinkingBudget = budgetTokens;
  let cutoff = -1;
  for (let i = n - 1; i >= 0; i--) {
    const m = input[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const thinkingText = (m.content as { type?: string; thinking?: string }[])
      .filter((b) => b && b.type === 'thinking' && typeof b.thinking === 'string')
      .map((b) => b.thinking as string)
      .join('\n');
    const t = estimateTokens(thinkingText);
    if (t === 0) continue;
    if (thinkingBudget - t < 0) {
      cutoff = i;
      break;
    }
    thinkingBudget -= t;
  }
  if (cutoff < 0) {
    return { messages: input, modified: false, prunedCount: 0, prunedTokens: 0, prunedChars: 0 };
  }

  let removedChars = 0;
  let modifiedCount = 0;
  const next = input.map((m, i) => {
    if (i > cutoff || m.role !== 'assistant' || !Array.isArray(m.content)) return m;
    let touched = false;
    const filtered = (m.content as { type?: string; thinking?: string }[]).filter((b) => {
      if (b && b.type === 'thinking') {
        removedChars += typeof b.thinking === 'string' ? b.thinking.length : 0;
        touched = true;
        return false;
      }
      return true;
    });
    if (touched) modifiedCount++;
    return { ...m, content: filtered };
  });

  return {
    messages: next,
    modified: true,
    prunedCount: modifiedCount,
    prunedTokens: Math.ceil(removedChars / 4),
    prunedChars: removedChars,
  };
}
