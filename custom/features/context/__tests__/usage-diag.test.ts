/**
 * usage-diag 纯逻辑回归测试
 * 覆盖追加/汇总/截断/清理与跨设备事件
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
  recordThinkingMeter,
  recordLevelChange,
  getToolEventsFile,
  recordToolEnable,
  recordToolCallEvent,
  loadToolCallRecords,
  loadToolEnableEvents,
  getToolUsageFile,
  recordToolUsage,
  loadToolUsage,
  getDeviceId,
  getToolEventsDir,
  toolUseFile,
  recordToolCall,
  loadToolUseEvents,
  pruneToolEvents,
  recomputeToolUsage,
  summarizeRecords,
  formatUsageSummary,
  UsageRecord,
  AutoCompactEvent,
  PruneEvent,
  UsageMissingEvent,
  ThinkingMeterEvent,
  LevelChangeEvent,
  ToolUseEvent,
} from '../usage-diag/diag';

let memDir: string;
let diagFile: string;
let toolEventsFile: string;

beforeEach(() => {
  memDir = mkdtempSync(join(tmpdir(), 'my-pi-usage-diag-'));
  process.env.PI_MEMORY_DIR = memDir;
  diagFile = join(memDir, 'context', '.usage-diag.jsonl');
  toolEventsFile = join(memDir, 'stats', 'tool-events.jsonl');
  mkdirSync(dirname(diagFile), { recursive: true });
  mkdirSync(dirname(toolEventsFile), { recursive: true });
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_USAGE_DIAG_FILE;
  delete process.env.PI_TOOL_EVENTS_FILE;
  delete process.env.PI_TOOL_USAGE_FILE;
  delete process.env.PI_DEVICE_ID;
  delete process.env.PI_TOOL_EVENTS_DIR;
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

  it('recordThinkingMeter 记录思考量', () => {
    recordThinkingMeter(150);
    const lines = readFileSync(diagFile, 'utf-8').trim().split('\n');
    const ev = JSON.parse(lines[0]) as ThinkingMeterEvent;
    expect(ev.type).toBe('thinking-meter');
    expect(ev.tokens).toBe(150);
  });

  it('recordLevelChange 记录档位切换', () => {
    recordLevelChange({ from: 'low', to: 'high', reason: '任务复杂', pressure: 'high', source: 'auto' });
    const lines = readFileSync(diagFile, 'utf-8').trim().split('\n');
    const ev = JSON.parse(lines[0]) as LevelChangeEvent;
    expect(ev.type).toBe('level-change');
    expect(ev.from).toBe('low');
    expect(ev.source).toBe('auto');
  });

  it('工具启用与调用事件追加与读取', () => {
    recordToolEnable('web-search', 'enable_tool');
    recordToolEnable('plan-mode', 'cmd');
    recordToolCallEvent({ tool: 'bash', args: { cmd: 'ls' }, result: 'ok', ok: true, durationMs: 123 });

    const lines = readFileSync(toolEventsFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);

    const enables = loadToolEnableEvents();
    expect(enables).toHaveLength(2);
    expect(enables[0].group).toBe('web-search');
    expect(enables[0].via).toBe('enable_tool');

    const calls = loadToolCallRecords();
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe('bash');
    expect(calls[0].ok).toBe(true);
  });

  it('工具用量账单追加与重算', () => {
    recordToolUsage('read', { input: 100, cacheRead: 50 });
    recordToolUsage('read', { input: 200 });
    recordToolUsage('bash', { cacheWrite: 30 });

    const usage = loadToolUsage();
    expect(usage.read.calls).toBe(2);
    expect(usage.read.input).toBe(300);
    expect(usage.read.cacheRead).toBe(50);
    expect(usage.bash.calls).toBe(1);

    // recomputeToolUsage 以 tool-use 事件流为唯一真源（不是 usage.json 聚合）：
    // 写入一条事件后重算，账本应只含事件流的量
    recordToolCall({ tool: 'read', outputTokens: 10, input: 100, cacheRead: 50 });
    const recomputed = recomputeToolUsage(30);
    expect(recomputed.read.input).toBe(100);
  });

  it('设备标识与工具事件文件路径', () => {
    expect(getDeviceId()).toBeTruthy();
    process.env.PI_DEVICE_ID = 'node1';
    expect(getDeviceId()).toBe('node1');

    const f = toolUseFile('node2');
    expect(f).toContain('tool-use-node2.jsonl');
    expect(f).toContain(memDir);
  });

  it('recordToolCall 追加跨设备事件', () => {
    recordToolCall({ tool: 'web-search', outputTokens: 200, input: 150, cacheRead: 50 });
    const f = toolUseFile();
    const lines = readFileSync(f, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]) as ToolUseEvent;
    expect(ev.type).toBe('tool-use');
    expect(ev.device).toBe(getDeviceId());
    expect(ev.input).toBe(150);
    expect(ev.cacheRead).toBe(50);
  });

  it('loadToolUseEvents 加载本机与全部设备事件', () => {
    // 设置固定的设备ID以确保测试的确定性
    process.env.PI_DEVICE_ID = 'test-device';
    // 写两个设备文件：一个匹配当前设备，一个不匹配
    const f1 = toolUseFile('test-device'); // 当前设备
    const f2 = toolUseFile('other-device'); // 其他设备
    const old = Date.now() - 40 * 24 * 3600_000;
    const recent = Date.now() - 10 * 24 * 3600_000;
    writeFileSync(f1, JSON.stringify({ type: 'tool-use', eid: 'test-device:1:1', device: 'test-device', ts: recent, iso: new Date(recent).toISOString(), tool: 'recent', outputTokens: 200 }) + '\n', 'utf8');
    writeFileSync(f2, JSON.stringify({ type: 'tool-use', eid: 'other-device:1:1', device: 'other-device', ts: old, iso: new Date(old).toISOString(), tool: 'old', outputTokens: 100 }) + '\n', 'utf8');

    // 默认保留窗口 30 天：40 天前的 other-device 事件被过滤
    const all = loadToolUseEvents(true);
    expect(all).toHaveLength(1);
    // 放宽窗口到 60 天：两个设备的事件都在
    expect(loadToolUseEvents(true, 60)).toHaveLength(2);
    const local = loadToolUseEvents(false);
    expect(local).toHaveLength(1);
    expect(local[0].device).toBe(getDeviceId());
    expect(local[0].tool).toBe('recent'); // 应该是未过期的事件
  });

  it('pruneToolEvents 清理超期事件', () => {
    const f = toolUseFile();
    const old = Date.now() - 40 * 24 * 3600_000;
    const recent = Date.now() - 10 * 24 * 3600_000;
    writeFileSync(f, [
      JSON.stringify({ type: 'tool-use', eid: 'x:1:1', device: getDeviceId(), ts: old, iso: new Date(old).toISOString(), tool: 'old', outputTokens: 100 }),
      JSON.stringify({ type: 'tool-use', eid: 'x:1:2', device: getDeviceId(), ts: recent, iso: new Date(recent).toISOString(), tool: 'recent', outputTokens: 200 }),
    ].join('\n') + '\n', 'utf8');

    const removed = pruneToolEvents(30);
    expect(removed).toBe(1);
    const lines = readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]) as ToolUseEvent;
    expect(ev.tool).toBe('recent');
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

  it('环境变量覆盖路径', () => {
    process.env.PI_USAGE_DIAG_FILE = '/custom/diag.jsonl';
    process.env.PI_TOOL_EVENTS_FILE = '/custom/events.jsonl';
    process.env.PI_TOOL_USAGE_FILE = '/custom/usage.json';
    process.env.PI_TOOL_EVENTS_DIR = '/custom/stats';

    expect(getDiagFile()).toBe('/custom/diag.jsonl');
    expect(getToolEventsFile()).toBe('/custom/events.jsonl');
    expect(getToolUsageFile()).toBe('/custom/usage.json');
    expect(getToolEventsDir()).toBe('/custom/stats');
  });
});
