/**
 * Context Feature — 用量/缓存统计（纯逻辑，零 Pi 依赖）
 *
 * 度量基建（VISION §6 P1）：把工具调用的 token 与缓存命中写入 append-only JSONL，
 * 产出「缓存命中率 / token 成本」可对比数字。落盘 `portable/memory/context/usage.jsonl`。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getMemoryDir } from '../../core/config';

export interface UsageEvent {
  ts: string;
  tool: string;
  ok: boolean;
  /** 输入 token（若 provider 返回 usage） */
  input?: number;
  /** 输出 token */
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** 输出内容估算 token（无 usage 时的兜底） */
  outputTokens?: number;
  durationMs?: number;
}

const MAX_SIZE = 4 * 1024 * 1024;

export function usageFilePath(): string {
  return process.env.PI_USAGE_FILE || join(getMemoryDir(), 'context', 'usage.jsonl');
}

export function appendUsage(event: UsageEvent): void {
  try {
    const f = usageFilePath();
    if (existsSync(f) && statSync(f).size > MAX_SIZE) {
      try {
        renameSync(f, `${f}.old`);
      } catch {
        /* 轮转失败忽略 */
      }
    }
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(event) + '\n', 'utf8');
  } catch {
    /* fail-open：度量不阻塞主流程 */
  }
}

export function readUsage(): UsageEvent[] {
  try {
    const raw = readFileSync(usageFilePath(), 'utf-8');
    const out: UsageEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as UsageEvent);
      } catch {
        /* skip 损坏行 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export interface UsageSummary {
  total: number;
  failures: number;
  todayCount: number;
  todayInput: number;
  todayOutput: number;
  todayCacheRead: number;
  todayCacheWrite: number;
  /** 缓存命中率 = cacheRead / (input + cacheRead) */
  cacheHitRate: number;
  topTools: Array<{ tool: string; count: number; tokens: number }>;
}

function localDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 10);
}

export function summarizeUsage(events: UsageEvent[], now: number = Date.now()): UsageSummary {
  const today = localDay(new Date(now));
  const todays = events.filter((e) => localDay(e.ts) === today);
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const e of todays) {
    input += e.input ?? 0;
    output += e.output ?? e.outputTokens ?? 0;
    cacheRead += e.cacheRead ?? 0;
    cacheWrite += e.cacheWrite ?? 0;
  }
  const byTool = new Map<string, { count: number; tokens: number }>();
  for (const e of events) {
    const entry = byTool.get(e.tool) ?? { count: 0, tokens: 0 };
    entry.count++;
    entry.tokens += (e.input ?? 0) + (e.output ?? e.outputTokens ?? 0);
    byTool.set(e.tool, entry);
  }
  const topTools = [...byTool.entries()]
    .map(([tool, v]) => ({ tool, count: v.count, tokens: v.tokens }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    total: events.length,
    failures: events.filter((e) => !e.ok).length,
    todayCount: todays.length,
    todayInput: input,
    todayOutput: output,
    todayCacheRead: cacheRead,
    todayCacheWrite: cacheWrite,
    cacheHitRate: input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0,
    topTools,
  };
}

export function formatUsageSummary(s: UsageSummary): string {
  const lines = [
    '用量/缓存统计:',
    `  累计工具调用: ${s.total}（失败 ${s.failures}）`,
    `  今日: ${s.todayCount} 次, 输入 ${s.todayInput.toLocaleString()} tok, 输出 ${s.todayOutput.toLocaleString()} tok`,
    `  缓存: 读 ${s.todayCacheRead.toLocaleString()} / 写 ${s.todayCacheWrite.toLocaleString()}, 命中率 ${(s.cacheHitRate * 100).toFixed(1)}%`,
  ];
  if (s.topTools.length) {
    lines.push('  高频工具:');
    for (const t of s.topTools) lines.push(`    ${t.tool}: ${t.count} 次 / ${t.tokens.toLocaleString()} tok`);
  }
  return lines.join('\n');
}
