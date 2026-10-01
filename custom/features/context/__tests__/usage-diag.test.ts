/**
 * usage-diag 纯逻辑回归测试
 * 覆盖追加/汇总/截断/清理与跨设备事件
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getDiagFile,
  trimDiagContent,
  recordUsage,
  recordUsageMissing,
  recordAutoCompact,
  recordPrune,
  recordLevelChange,
  summarizeRecords,
  formatUsageSummary,
  type UsageRecord,
  type AutoCompactEvent,
  type PruneEvent,
  type UsageMissingEvent,
  type LevelChangeEvent,
} from '../usage-diag/diag';

let memDir: string;
let diagFile: string;

beforeEach(() => {
  memDir = mkdtempSync(join(tmpdir(), 'my-pi-usage-diag-'));
  process.env.PI_MEMORY_DIR = memDir;
  diagFile = join(memDir, 'context', '.usage-diag.jsonl');
  mkdirSync(dirname(diagFile), { recursive: true });
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_USAGE_DIAG_FILE;
  rmSync(memDir, { recursive: true, force: true });
});

describe('usage-diag 核心功能', () => {
  it('getDiagFile 返回 PI_MEMORY_DIR 下的路径', () => {
    expect(getDiagFile()).toBe(diagFile);
    process.env.PI_USAGE_DIAG_FILE = '/env/override.jsonl';
    expect(getDiagFile()).toBe('/env/override.jsonl');
  });

  it('trimDiagContent 截断超上限内容', () => {
    const big = Array.from({ length: 25000 }, (_, i) => ({ ts: i, input: 1 })).map((o) => JSON.stringify(o)).join('\n') + '\n';
    expect(trimDiagContent(big, 20000)).not.toBeNull();
    expect(trimDiagContent(big, 20000)!.split('\n').filter(Boolean).length).toBe(20000);
    expect(trimDiagContent('a\nb\nc', 2)).toBe('b\nc\n');
    expect(trimDiagContent('x', 10)).toBeNull();
  });

  it('recordUsage 追加并 rotate', () => {
    const rec: UsageRecord = { ts: Date.now(), input: 100, cacheRead: 50, cacheWrite: 20, output: 80, reasoning: 30, total: 280, contextTokens: 280 };
    recordUsage(rec);
    const lines = readFileSync(diagFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.input).toBe(100);
    expect(parsed.cacheRead).toBe(50);
  });

  it('recordUsageMissing 记录探针', () => {
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ['Date'] });
    recordUsageMissing();
    let lines = readFileSync(diagFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const ev1 = JSON.parse(lines[0]) as UsageMissingEvent;
    expect(ev1.type).toBe('usage-missing');

    // throttle
    recordUsageMissing();
    lines = readFileSync(diagFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);

    vi.useRealTimers();
  });

  it('recordAutoCompact 记录压缩事件', () => {
    recordAutoCompact(1200, 1000);
    const lines = readFileSync(diagFile, 'utf-8').trim().split('\n');
    const ev = JSON.parse(lines[0]) as AutoCompactEvent;
    expect(ev.type).toBe('auto-compact');
    expect(ev.contextTokens).toBe(1200);
    expect(ev.threshold).toBe(1000);
  });

  it('recordPrune 记录擦除事件', () => {
    recordPrune(500, 1200, 8, 'tool');
    recordPrune(300, 800, 5, 'thinking');
    const lines = readFileSync(diagFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const ev1 = JSON.parse(lines[0]) as PruneEvent;
    expect(ev1.type).toBe('prune');
    const ev2 = JSON.parse(lines[1]) as PruneEvent;
    expect(ev2.type).toBe('prune-think');
  });

  it('recordLevelChange 记录档位切换', () => {
    recordLevelChange({ from: 'low', to: 'high', reason: '任务复杂', pressure: 'high', source: 'auto' });
    const lines = readFileSync(diagFile, 'utf-8').trim().split('\n');
    const ev = JSON.parse(lines[0]) as LevelChangeEvent;
    expect(ev.type).toBe('level-change');
    expect(ev.from).toBe('low');
    expect(ev.source).toBe('auto');
  });

  it('summarizeRecords 与 formatUsageSummary', () => {
    const now = Date.now();
    const recs: UsageRecord[] = [
      { ts: now, input: 100, cacheRead: 50, cacheWrite: 0, output: 80, reasoning: 20, total: 250, contextTokens: 250 },
      { ts: now + 1, input: 200, cacheRead: 0, cacheWrite: 0, output: 120, reasoning: 30, total: 350, contextTokens: 350 },
    ];
    recs.forEach(r => recordUsage(r));

    const summary = summarizeRecords(recs);
    expect(summary).not.toBeNull();
    expect(summary!.requests).toBe(2);
    expect(summary!.inputTotal).toBe(300);
    expect(summary!.cacheHitRatio).toBe(14);

    const lines = readFileSync(diagFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    const text = formatUsageSummary(lines);
    expect(text).toContain('请求数: 2');
    expect(text).toContain('缓存命中:');
  });

  it('formatUsageSummary 渲染 auto-compact/prune/usage-missing（/usage-diag 的可观测面）', () => {
    // 背景（P4 第三批）：这三类事件的生产者曾与消费者断开（auto-compact/prune 自 2026-09-24
    // 起没人写，摘要恒显示 0 次）。生产者已在 context/index.ts 接线，这里锁住消费者一侧的渲染，
    // 确保"事件写进来了就看得见"。
    const now = Date.now();
    recordUsage({ ts: now, input: 100, cacheRead: 50, cacheWrite: 0, output: 80, reasoning: 20, total: 250, contextTokens: 250 });
    recordAutoCompact(320000, 300000);
    recordPrune(1200, 4800, 3, 'tool');
    recordPrune(800, 3200, 2, 'thinking');

    // usage-missing 有节流（同进程内只记一次），这里直接补一条事件锁"消费侧渲染"，
    // 生产侧的接线由 recordUsageMissing 被 index.ts 引用（死导出守门）保证。
    const lines = readFileSync(diagFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    lines.push({ type: 'usage-missing', ts: now });
    const text = formatUsageSummary(lines);
    expect(text).toContain('自动压缩触发: 1 次');
    expect(text).toContain('阈值 300.0K');
    expect(text).toContain('分层擦除: 2 次');
    expect(text).toContain('累计回收 2000 token');
    expect(text).toContain('无用量记录: 1 轮');
  });

  it('环境变量覆盖路径', () => {
    process.env.PI_USAGE_DIAG_FILE = '/custom/diag.jsonl';
    expect(getDiagFile()).toBe('/custom/diag.jsonl');
  });
});
