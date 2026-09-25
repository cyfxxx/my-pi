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
} from '../store/storage';
import type { MemoryEntry } from '../store/types';
import { searchEntriesWithScores, visibleAt, qualityScore } from '../recall/retrieval';
import { detectContradiction, decideMerge } from '../store/merge';
import { buildInjectionBlock, filterInjectedMessages, shouldInjectMemory, INJECT_TAG } from '../recall/inject';

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

  it('shouldInjectMemory：内容变化才注入，未变则跳过（保持前缀缓存稳定）', () => {
    expect(shouldInjectMemory('block-A', null)).toBe(true); // 首次
    expect(shouldInjectMemory('block-A', 'block-A')).toBe(false); // 未变 → 跳过
    expect(shouldInjectMemory('block-B', 'block-A')).toBe(true); // 变化 → 注入
    expect(shouldInjectMemory('', null)).toBe(false); // 空块不注入
  });
});

describe('lifecycle 生命周期报告', () => {
  const LONG = '这是一条内容足够长的记忆条目，用于避开垃圾嫌疑判定（归一化后需不少于三十个字符）。';

  it('识别淘汰/升格/冲突候选', async () => {
    const { analyzeLifecycle } = await import('../mine/lifecycle');
    const now = Date.now();
    const old = new Date(now - 200 * 24 * 3600_000).toISOString();
    const entries: MemoryEntry[] = [
      entry({ id: 'e1', title: '旧的低置信记忆', content: LONG, recurrence: 1, confidence: 0.3, accessedAt: old }),
      entry({ id: 'e2', title: '常用解决方案', content: LONG, category: 'solutions', recurrence: 6, confidence: 0.9 }),
      entry({ id: 'e3', title: '用户偏好深色主题', content: LONG, category: 'preference' }),
      entry({ id: 'e4', title: '用户偏好浅色主题', content: LONG, category: 'preference' }),
    ];
    const r = analyzeLifecycle(entries, { now });
    expect(r.evictionCandidates.map((x) => x.id)).toContain('e1');
    expect(r.promotionCandidates.map((x) => x.id)).toContain('e2');
    // e3/e4 同类别标题相似 → 冲突嫌疑
    expect(r.conflictSuspects.length).toBeGreaterThan(0);
    expect(r.active).toBe(4);
  });

  it('垃圾嫌疑：content 无实义与噪声标题，且不进升格候选', async () => {
    const { analyzeLifecycle, junkReason } = await import('../mine/lifecycle');
    expect(junkReason({ title: '正常标题', content: LONG })).toBeNull();
    expect(junkReason({ title: '正常标题', content: '太短' })).toContain('无实义');
    expect(junkReason({ title: 'test', content: LONG })).toContain('噪声');

    const entries: MemoryEntry[] = [
      entry({ id: 'j1', title: 'test', content: LONG, category: 'solutions', recurrence: 34 }),
      entry({ id: 'j2', title: '空壳记录', content: '短', category: 'solutions', recurrence: 9 }),
      entry({ id: 'ok', title: '真实高频方案', content: LONG, category: 'solutions', recurrence: 6 }),
    ];
    const r = analyzeLifecycle(entries);
    expect(r.junkSuspects.map((x) => x.id).sort()).toEqual(['j1', 'j2']);
    expect(r.promotionCandidates.map((x) => x.id)).toEqual(['ok']);
  });

  it('聚合候选：同主题 solutions 组内 ≥3 条且 Σrecurrence ≥8', async () => {
    const { analyzeLifecycle } = await import('../mine/lifecycle');
    const title = 'entries.json 合并冲突处理';
    const entries: MemoryEntry[] = [
      entry({ id: 'a1', title: `${title}：跨分支`, content: LONG, category: 'solutions', recurrence: 3 }),
      entry({ id: 'a2', title: `${title}：三方比对`, content: LONG, category: 'solutions', recurrence: 3 }),
      entry({ id: 'a3', title: `${title}：损坏恢复`, content: LONG, category: 'solutions', recurrence: 3 }),
      entry({ id: 'b1', title: '完全无关的偏好设置记录', content: LONG, category: 'solutions', recurrence: 1 }),
    ];
    const r = analyzeLifecycle(entries);
    expect(r.aggregationCandidates).toHaveLength(1);
    expect(r.aggregationCandidates[0].size).toBe(3);
    expect(r.aggregationCandidates[0].sumRecurrence).toBe(9);
    expect(r.aggregationCandidates[0].members.map((m) => m.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('formatLifecycleReport 含六段', async () => {
    const { analyzeLifecycle, formatLifecycleReport } = await import('../mine/lifecycle');
    const text = formatLifecycleReport(analyzeLifecycle([]));
    expect(text).toContain('淘汰候选');
    expect(text).toContain('升格候选');
    expect(text).toContain('冲突嫌疑');
    expect(text).toContain('垃圾嫌疑');
    expect(text).toContain('聚合候选');
    expect(text).toContain('规模');
  });
});

describe('lesson-miner 教训挖掘', () => {
  it('mineLessons 跳过无纠正、按既有内容哈希去重', async () => {
    const { mineLessons, candidateToEntry, formatLessonReport } = await import('../mine/lesson-miner');
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
    const { readInterventionRecords } = await import('../mine/lesson-miner');
    const { writeFileSync } = await import('node:fs');
    const file = join(dir, 'interventions.jsonl');
    writeFileSync(file, JSON.stringify({ id: 'x', correctivePrompt: '改用 pg' }) + '\nnot-json\n');
    const recs = readInterventionRecords(file);
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe('x');
  });
});

describe('memory: 会话摘要（summary.ts）', () => {
  it('buildSummaryEntry 抽取决策/事实/偏好/教训并保留全文', async () => {
    const { buildSummaryEntry } = await import('../store/summary');
    const text = [
      '# 会话摘要',
      '决策: 采用 JWT 鉴权',
      '事实: 服务端口 8080',
      '偏好: 中文注释',
      '- 教训: 不要用 session',
      '其他普通描述文字',
    ].join('\n');
    const s = buildSummaryEntry({ sessionId: 'sess-1', text });
    expect(s.title).toBe('会话摘要');
    expect(s.decisions).toEqual(['采用 JWT 鉴权']);
    expect(s.facts).toEqual(['服务端口 8080']);
    expect(s.prefs).toEqual(['中文注释']);
    expect(s.lessons).toEqual(['不要用 session']);
    expect(s.fullText).toContain('其他普通描述文字');
  });

  it('appendSummary 按 sessionId 去重且 loadSummaries 可读回', async () => {
    const { appendSummary, loadSummaries } = await import('../store/storage');
    const { buildSummaryEntry } = await import('../store/summary');
    appendSummary(buildSummaryEntry({ sessionId: 's1', text: '决策: A' }));
    appendSummary(buildSummaryEntry({ sessionId: 's1', text: '决策: B' }));
    const all = loadSummaries();
    expect(all).toHaveLength(1);
    expect(all[0].fullText).toContain('B');
  });

  it('loadSummaries 对缺失字段的损坏数据不抛异常', async () => {
    const { writeFileSync } = await import('node:fs');
    const { loadSummaries, getStats } = await import('../store/storage');
    writeFileSync(join(dir, 'summaries.json'), JSON.stringify({ version: 1, summaries: [{ id: 'x', title: 't' }] }));
    expect(() => loadSummaries()).not.toThrow();
    expect(() => getStats([])).not.toThrow();
  });
});

describe('memory: purgeExpiredNotes 真正落盘', () => {
  it('删除过期 TTL 笔记，保留未到期与非法 TTL', async () => {
    const { writeFileSync, readFileSync } = await import('node:fs');
    const { purgeExpiredNotes } = await import('../store/storage');
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    writeFileSync(
      join(dir, 'notes.json'),
      JSON.stringify({ keep: 'v', __ttl_keep: future, old: 'v', __ttl_old: past, bad: 'v', __ttl_bad: 'not-a-date' }),
    );
    expect(purgeExpiredNotes()).toBe(1);
    const saved = JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf-8'));
    expect(saved.old).toBeUndefined();
    expect(saved.__ttl_old).toBeUndefined();
    expect(saved.keep).toBe('v');
    expect(saved.bad).toBe('v');
  });
});

describe('memory: merge 写入 contentHash', () => {
  it('mergeCandidates ADD 后带 contentHash，可被哈希去重', async () => {
    const { mergeCandidates } = await import('../store/merge');
    const entries: MemoryEntry[] = [];
    const c = entry({ title: 'M', content: '独特内容-unique-token' });
    await mergeCandidates(entries, [c]);
    expect(entries[0].contentHash).toBe(computeContentHash(entries[0].content));
  });
});
