/**
 * usage-stats 纯逻辑回归测试（度量基建 P1）
 *
 * 2026-10-01（P4 第三批 B-3）：工具级台账的 TS 侧读/汇总（`readUsage`/`summarizeUsage`/
 * `formatUsageSummary`）已删除——生产侧由 `scripts/daily-health.mjs` 与
 * `scripts/tool-stats-sync.mjs` 直接读文件，`/usage-diag` 走 usage-diag 自己的口径。
 * 这里只锁"写入契约"（其它消费方依赖它）与 bash 命令形态字段。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendUsage, usageFilePath } from '../usage-stats';
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

function lines(): UsageEvent[] {
  return readFileSync(usageFilePath(), 'utf-8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as UsageEvent);
}

describe('usage-stats', () => {
  it('appendUsage 追加 JSONL（含失败标记与 token 字段）', () => {
    appendUsage(ev({ tool: 'read', input: 100, cacheRead: 50 }));
    appendUsage(ev({ tool: 'bash', outputTokens: 20, ok: false }));
    const events = lines();
    expect(events).toHaveLength(2);
    expect(events[0].tool).toBe('read');
    expect(events[0].cacheRead).toBe(50);
    expect(events[1].ok).toBe(false);
  });

  it('usageFilePath 受 PI_USAGE_FILE 覆盖（脚本与 TS 侧读同一份）', () => {
    expect(usageFilePath()).toBe(join(dir, 'usage.jsonl'));
  });

  it('bash 命令形态字段（merged/segments）随事件落盘', () => {
    appendUsage(ev({ tool: 'bash', merged: true, segments: 3 }));
    expect(lines()[0]).toMatchObject({ merged: true, segments: 3 });
  });
});
