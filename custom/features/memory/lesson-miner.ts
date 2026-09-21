/**
 * Memory Feature — 教训挖掘（纯逻辑，零 Pi 依赖）
 *
 * 打通 VISION §6 P3「教训挖掘 → 入库」：从干预快照（interventions.jsonl，含用户纠正
 * 意图）挖掘可沉淀的教训候选；默认只读，`--ingest` 时经 storeEntry 写入记忆库。
 * 数据级读取 interventions.jsonl（不与 intervention feature 代码耦合）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir } from '../../core/config';
import { computeContentHash } from './storage';
import type { MemoryEntry, MemoryCategory } from './types';

export interface InterventionRecordLike {
  id?: string;
  ts?: string;
  prompt?: string;
  correctivePrompt?: string | null;
  tools?: string[];
  lastTool?: { name?: string } | null;
  steering?: string[];
}

export function interventionsFile(): string {
  return process.env.PI_INTERVENTIONS_FILE || join(process.env.PI_MEMORY_DIR || getMemoryDir(), 'interventions.jsonl');
}

export function readInterventionRecords(file = interventionsFile()): InterventionRecordLike[] {
  if (!existsSync(file)) return [];
  const out: InterventionRecordLike[] = [];
  try {
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as InterventionRecordLike);
      } catch {
        /* skip 损坏行 */
      }
    }
  } catch {
    return [];
  }
  return out;
}

export interface LessonCandidate {
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  sourceId: string;
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

export interface MineOptions {
  max?: number;
  minCorrectiveLength?: number;
}

/**
 * 从纠正意图挖掘教训候选。跳过无 correctivePrompt 的记录；按内容哈希对既有记忆去重。
 * 纯函数，便于单测。
 */
export function mineLessons(
  records: InterventionRecordLike[],
  existing: MemoryEntry[] = [],
  opts: MineOptions = {},
): LessonCandidate[] {
  const max = opts.max ?? 20;
  const minLen = opts.minCorrectiveLength ?? 4;
  const seen = new Set(existing.map((e) => e.contentHash).filter(Boolean) as string[]);
  const seenTitles = new Set(existing.map((e) => e.title.toLowerCase()));
  const out: LessonCandidate[] = [];

  for (const r of records) {
    const corrective = (r.correctivePrompt ?? '').trim();
    if (corrective.length < minLen) continue;
    const intent = (r.prompt ?? '').trim();
    const content = `用户纠正意图: ${corrective}` + (intent ? `\n原任务: ${trunc(intent, 120)}` : '');
    const hash = computeContentHash(content);
    if (seen.has(hash)) continue;
    const title = `纠正: ${trunc(corrective, 40)}`;
    if (seenTitles.has(title.toLowerCase())) continue;
    seen.add(hash);
    seenTitles.add(title.toLowerCase());
    out.push({
      category: 'preference',
      title,
      content,
      tags: ['lesson', 'corrective'],
      confidence: 0.6,
      sourceId: r.id ?? 'unknown',
    });
    if (out.length >= max) break;
  }
  return out;
}

export function candidateToEntry(c: LessonCandidate, now: Date = new Date()): MemoryEntry {
  const iso = now.toISOString();
  return {
    id: cryptoRandomId(),
    category: c.category,
    title: c.title,
    content: c.content,
    tags: c.tags,
    confidence: c.confidence,
    source: 'extract',
    recurrence: 1,
    createdAt: iso,
    updatedAt: iso,
    accessedAt: iso,
    environments: ['all'],
  };
}

function cryptoRandomId(): string {
  // 复用 node crypto 的 randomUUID（避免引入额外依赖）
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatLessonReport(candidates: LessonCandidate[]): string {
  if (candidates.length === 0) return '未发现新的教训候选（无纠正意图或均已入库）。';
  return [
    `教训候选 (${candidates.length}):`,
    ...candidates.slice(0, 20).map((c) => `  - [${c.category}] ${c.title}`),
    '提示: /memory mine --ingest 写入记忆库（会自动去重）。',
  ].join('\n');
}
