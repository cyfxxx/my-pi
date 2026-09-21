/**
 * memory 纯逻辑回归测试
 * 迁移自 pi-tools pi-memory/tests 的核心语义（storage 去重 / retrieval / merge / inject）。
 * 使用临时 PI_MEMORY_DIR，不触碰真实数据。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  storeEntry,
  deleteEntry,
  activeEntries,
  getStats,
  computeContentHash,
  tokenize,
  jaccardSimilarity,
} from '../storage';
import type { MemoryEntry } from '../types';
import { searchEntriesWithScores, visibleAt, qualityScore } from '../retrieval';
import { detectContradiction, decideMerge } from '../merge';
import { buildInjectionBlock, filterInjectedMessages, INJECT_TAG } from '../inject';

function entry(over: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    category: 'fact',
    title: 'title',
    content: 'content',
    tags: [],
    confidence: 0.8,
    source: 'manual',
    recurrence: 1,
    createdAt: now,
    updatedAt: now,
    accessedAt: now,
    environments: ['all'],
    ...over,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-memory-'));
  process.env.PI_MEMORY_DIR = dir;
});
afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('storage: 写入与去重', () => {
  it('同标题 → updated 并递增 recurrence', () => {
    const entries: MemoryEntry[] = [];
    storeEntry(entries, entry({ title: 'A', content: 'v1' }));
    const r = storeEntry(entries, entry({ title: 'a', content: 'v2' }));
    expect(r.action).toBe('updated');
    const live = activeEntries(entries);
    expect(live).toHaveLength(1);
    expect(live[0].content).toBe('v2');
    expect(live[0].recurrence).toBe(2);
  });

  it('相同内容哈希 → merged', () => {
    const entries: MemoryEntry[] = [];
    storeEntry(entries, entry({ title: 'A', content: 'same content here' }));
    const r = storeEntry(entries, entry({ title: 'B', content: 'same content here' }));
    expect(r.action).toBe('merged');
    expect(activeEntries(entries)).toHaveLength(1);
  });

  it('不同内容 → created', () => {
    const entries: MemoryEntry[] = [];
    expect(storeEntry(entries, entry({ title: 'A', content: 'aaa' })).action).toBe('created');
    expect(storeEntry(entries, entry({ title: 'B', content: 'bbb' })).action).toBe('created');
    expect(activeEntries(entries)).toHaveLength(2);
  });

  it('deleteEntry 软删除，activeEntries 过滤', () => {
    const entries: MemoryEntry[] = [];
    const e = entry({ title: 'A', content: 'aaa' });
    storeEntry(entries, e);
    expect(deleteEntry(entries, e.id)).toBe(true);
    expect(activeEntries(entries)).toHaveLength(0);
    expect(getStats(entries).totalEntries).toBe(1);
  });

  it('computeContentHash 稳定且 16 位', () => {
    expect(computeContentHash('x')).toBe(computeContentHash('x'));
    expect(computeContentHash('x')).toHaveLength(16);
  });

  it('tokenize/jaccard 基本行为', () => {
    expect(tokenize('hello world')).toContain('hello');
    expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccardSimilarity(['a'], ['b'])).toBe(0);
  });
});

describe('retrieval: 检索与回溯', () => {
  it('query 命中相关条目', () => {
    const entries = [
      entry({ title: '深色主题偏好', content: '用户喜欢深色主题' }),
      entry({ title: '部署流程', content: '使用 docker 部署' }),
    ];
    const res = searchEntriesWithScores(entries, '深色主题', undefined, undefined, 5, 'all');
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].entry.title).toContain('深色');
  });

  it('env 过滤：非当前环境的专属条目不可见', () => {
    const entries = [
      entry({ title: 'A', content: '通用', environments: ['all'] }),
      entry({ title: 'B', content: '安卓专属', environments: ['termux'] }),
    ];
    const res = searchEntriesWithScores(entries, '专属', undefined, undefined, 5, 'linux');
    expect(res.map((r) => r.entry.title)).not.toContain('B');
  });

  it('visibleAt：取代条目的 validUntil 决定回溯可见性', () => {
    const now = Date.now();
    const e = entry({
      createdAt: new Date(now - 1000).toISOString(),
      deleted: true,
      supersededBy: 'x',
      validUntil: new Date(now - 500).toISOString(),
    });
    expect(visibleAt(e, now)).toBe(false);
    expect(visibleAt(e, now - 700)).toBe(true);
  });

  it('qualityScore 置信度高者更高', () => {
    expect(qualityScore(entry({ confidence: 1 }))).toBeGreaterThan(qualityScore(entry({ confidence: 0.1 })));
  });
});

describe('merge: 矛盾与消解', () => {
  it('detectContradiction 识别同主体语义反转', () => {
    const a = entry({ title: '偏好', content: '用户喜欢深色主题' });
    const b = entry({ title: '偏好', content: '用户不喜欢深色主题' });
    expect(detectContradiction(a, b)).toBe(true);
    const c = entry({ title: 'x', content: '使用 docker 部署生产环境' });
    expect(detectContradiction(a, c)).toBe(false);
  });

  it('decideMerge：无相似 → ADD；同标题 → UPDATE', async () => {
    const entries = [entry({ title: 'A', content: 'docker deploy production server' })];
    const added = await decideMerge(entries, entry({ title: 'B', content: 'deep dark color theme preference' }));
    expect(added.action).toBe('ADD');

    const updated = await decideMerge(entries, entry({ title: 'A', content: 'docker deploy staging server now' }));
    expect(updated.action).toBe('UPDATE');
  });

  it('decideMerge：手动条目不被低置信度矛盾候选取代', async () => {
    const entries = [entry({ title: '偏好', content: '用户喜欢深色主题', source: 'manual', confidence: 1 })];
    const decision = await decideMerge(entries, entry({ title: '偏好', content: '用户不喜欢深色主题', confidence: 0.5 }));
    expect(decision.action).toBe('NOOP');
  });
});

describe('inject: 注入块', () => {
  it('包含高价值条目与标记行，无时间戳', () => {
    const entries = [entry({ title: '重要事实', content: '内容内容', confidence: 1, recurrence: 10 })];
    const { block, entries: n } = buildInjectionBlock(entries, [], 500, 'all');
    expect(n).toBe(1);
    expect(block).toContain('重要事实');
    expect(block).toContain(`> ${INJECT_TAG}`);
    expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('filterInjectedMessages 只保留最新注入', () => {
    const msgs = [
      { customType: INJECT_TAG, content: 'old' },
      { customType: 'other', content: 'keep' },
      { customType: INJECT_TAG, content: 'new' },
    ];
    const out = filterInjectedMessages(msgs);
    expect(out).toHaveLength(2);
    expect((out[1] as { content: string }).content).toBe('new');
  });
});

describe('lifecycle 生命周期报告', () => {
  it('识别淘汰/升格/冲突候选', async () => {
    const { analyzeLifecycle } = await import('../lifecycle');
    const now = Date.now();
    const old = new Date(now - 200 * 24 * 3600_000).toISOString();
    const entries: MemoryEntry[] = [
      entry({ id: 'e1', title: '旧的低置信记忆', recurrence: 1, confidence: 0.3, accessedAt: old }),
      entry({ id: 'e2', title: '常用解决方案', category: 'solutions', recurrence: 6, confidence: 0.9 }),
      entry({ id: 'e3', title: '用户偏好深色主题', category: 'preference' }),
      entry({ id: 'e4', title: '用户偏好浅色主题', category: 'preference' }),
    ];
    const r = analyzeLifecycle(entries, { now });
    expect(r.evictionCandidates.map((x) => x.id)).toContain('e1');
    expect(r.promotionCandidates.map((x) => x.id)).toContain('e2');
    // e3/e4 同类别标题相似 → 冲突嫌疑
    expect(r.conflictSuspects.length).toBeGreaterThan(0);
    expect(r.active).toBe(4);
  });

  it('formatLifecycleReport 含四段', async () => {
    const { analyzeLifecycle, formatLifecycleReport } = await import('../lifecycle');
    const text = formatLifecycleReport(analyzeLifecycle([]));
    expect(text).toContain('淘汰候选');
    expect(text).toContain('升格候选');
    expect(text).toContain('冲突嫌疑');
    expect(text).toContain('规模');
  });
});

describe('lesson-miner 教训挖掘', () => {
  it('mineLessons 跳过无纠正、按既有内容哈希去重', async () => {
    const { mineLessons, candidateToEntry, formatLessonReport } = await import('../lesson-miner');
    const records = [
      { id: 'a', prompt: '实现登录', correctivePrompt: '不要用 session，用 JWT' },
      { id: 'b', prompt: '无纠正', correctivePrompt: null },
      { id: 'c', prompt: '部署', correctivePrompt: '' },
    ];
    const first = mineLessons(records);
    expect(first).toHaveLength(1);
    expect(first[0].category).toBe('preference');
    expect(first[0].content).toContain('JWT');

    // 已入库同内容 → 去重
    const existing = [candidateToEntry(first[0])];
    expect(mineLessons(records, existing)).toHaveLength(0);
    expect(formatLessonReport([])).toContain('未发现');
  });

  it('readInterventionRecords 读取 JSONL', async () => {
    const { readInterventionRecords } = await import('../lesson-miner');
    const { writeFileSync } = await import('node:fs');
    const file = join(dir, 'interventions.jsonl');
    writeFileSync(file, JSON.stringify({ id: 'x', correctivePrompt: '改用 pg' }) + '\nnot-json\n');
    const recs = readInterventionRecords(file);
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe('x');
  });
});
