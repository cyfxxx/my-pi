/**
 * usage-stats 纯逻辑回归测试（度量基建 P1）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendUsage, readUsage, summarizeUsage, formatUsageSummary } from '../usage-stats';
import type { UsageEvent } from '../usage-stats';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-usage-'));
  process.env.PI_USAGE_FILE = join(dir, 'usage.jsonl');
});
afterEach(() => {
  delete process.env.PI_USAGE_FILE;
  rmSync(dir, { recursive: true, force: true });
});

function ev(over: Partial<UsageEvent> = {}): UsageEvent {
  return { ts: new Date().toISOString(), tool: 'bash', ok: true, ...over };
}

describe('usage-stats', () => {
  it('append/read 往返', () => {
    appendUsage(ev({ tool: 'read', input: 100, cacheRead: 50 }));
    appendUsage(ev({ tool: 'bash', outputTokens: 20, ok: false }));
    const events = readUsage();
    expect(events).toHaveLength(2);
    expect(events[0].tool).toBe('read');
    expect(events[1].ok).toBe(false);
  });

  it('summarize 统计今日/命中率/高频工具', () => {
    const now = Date.now();
    const events: UsageEvent[] = [
      ev({ ts: new Date(now).toISOString(), tool: 'read', input: 100, cacheRead: 100 }),
      ev({ ts: new Date(now).toISOString(), tool: 'read', input: 100, cacheRead: 0, output: 50 }),
      ev({ ts: new Date(now).toISOString(), tool: 'bash', outputTokens: 30, ok: false }),
    ];
    const s = summarizeUsage(events, now);
    expect(s.total).toBe(3);
    expect(s.failures).toBe(1);
    expect(s.cacheHitRate).toBeCloseTo(100 / 300, 3);
    expect(s.topTools[0].tool).toBe('read');
    expect(s.topTools[0].count).toBe(2);
    expect(s.todayCount).toBe(3);
  });

  it('非今日事件不计入 today', () => {
    const now = Date.now();
    const old = new Date(now - 48 * 3600_000).toISOString();
    const s = summarizeUsage([ev({ ts: old, input: 10 })], now);
    expect(s.total).toBe(1);
    expect(s.todayCount).toBe(0);
  });

  it('formatUsageSummary 含命中率', () => {
    const text = formatUsageSummary(summarizeUsage([ev({ input: 1, cacheRead: 1 })], Date.now()));
    expect(text).toContain('命中率');
  });
});
