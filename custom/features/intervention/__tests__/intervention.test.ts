/**
 * intervention 纯逻辑回归测试
 *
 * 迁移自 pi-tools `agent/extensions/pi-intervention/tests/smoke.test.ts`，
 * 覆盖核心纯函数（trunc/extractAssistantTail/isAbortedEnd/buildRecord/summarize）
 * 与 appendRecord/linkCorrective 的落盘语义。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CORRECTIVE_WINDOW_MS,
  trunc,
  extractAssistantTail,
  isAbortedEnd,
  buildRecord,
  appendRecord,
  linkCorrective,
  summarize,
  MAX_RECORDS,
} from '../logic';

describe('intervention 纯逻辑', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'my-pi-intervention-'));
    file = join(dir, 'interventions.jsonl');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('CORRECTIVE_WINDOW_MS 为 15 分钟', () => {
    expect(CORRECTIVE_WINDOW_MS).toBe(15 * 60_000);
  });

  it('trunc 截断并保留上限长度', () => {
    expect(trunc('hello', 10)).toBe('hello');
    expect(trunc('x'.repeat(50), 10).length).toBeLessThanOrEqual(13);
    expect(trunc(undefined as unknown as string, 5)).toBe('');
  });

  it('extractAssistantTail 提取最后一条 assistant 文本；isAbortedEnd 识别 aborted', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'partial work…' }] },
    ];
    expect(extractAssistantTail(messages)).toContain('partial work');
    expect(
      isAbortedEnd(messages.map((m) => ({ ...m, stopReason: m.role === 'assistant' ? 'aborted' : undefined }))),
    ).toBe(true);
    expect(isAbortedEnd(messages)).toBe(false);
    expect(isAbortedEnd([])).toBe(false);
  });

  it('buildRecord + appendRecord + linkCorrective 全链路落盘', () => {
    const rec = buildRecord({
      prompt: 'do task',
      tools: [{ name: 'bash', brief: 'ls' }],
      tail: 'partial',
      steering: ['先查一下'],
    });
    expect(rec.type).toBe('abort');
    expect(rec.steering).toEqual(['先查一下']);
    expect(rec.correctivePrompt).toBeNull();
    appendRecord(file, rec);
    expect(existsSync(file)).toBe(true);

    const ok = linkCorrective(file, rec.id, '不要那样做，改用 x', new Date());
    expect(ok).toBe(true);
    const line = JSON.parse(readFileSync(file, 'utf-8').trim().split('\n')[0]);
    expect(line.correctivePrompt).toBe('不要那样做，改用 x');

    // 已关联的记录不重复回填
    expect(linkCorrective(file, rec.id, 'late', new Date())).toBe(false);
  });

  it('appendRecord 高频追加：超过上限+余量自动压缩且保留最新记录（M13-b）', () => {
    const target = MAX_RECORDS + 250;
    for (let i = 0; i < target; i++) {
      appendRecord(file, buildRecord({ prompt: `p${i}`, tools: [], tail: '', steering: [] }));
    }
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    // 压缩阈值 = MAX_RECORDS + 200 余量，未触发压缩时文件行数可略高于 MAX_RECORDS
    expect(lines.length).toBeLessThanOrEqual(MAX_RECORDS + 300);
    expect(lines.length).toBeGreaterThan(MAX_RECORDS - 300);
    expect(JSON.parse(lines[lines.length - 1]).prompt).toBe(`p${target - 1}`);
  });

  it('summarize 产出总数/关联/steering/近7天', () => {
    const now = Date.now();
    const old = buildRecord({ prompt: 'a', tools: [], tail: '', steering: [] });
    const recent = buildRecord({ prompt: 'b', tools: [], tail: '', steering: ['x'] });
    appendRecord(file, recent);
    linkCorrective(file, recent.id, 'fix');
    // 手工把旧记录时间推到 8 天前
    old.ts = new Date(now - 8 * 24 * 3600_000).toISOString();
    appendRecord(file, old);

    const s = summarize(readFileSync(file, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), now);
    expect(s.total).toBe(2);
    expect(s.corrected).toBe(1);
    expect(s.withSteering).toBe(1);
    expect(s.lastWeek).toBe(1);
  });
});
