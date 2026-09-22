/**
 * 离线任务执行报告（纯逻辑 + 本地状态）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/notifications.ts`，
 * 数据源由旧的每任务 .log 改为 my-pi 的 `results-<device>.jsonl`，
 * 用 `notifications-seen.json` 记录上次已报告时间戳。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resultsFilePath, schedulerDir } from './storage';

export interface ResultEntry {
  ts: number;
  taskName: string;
  result: string;
  output: string;
}

export function seenMarkerPath(): string {
  return process.env.PI_NOTIFY_SEEN || join(schedulerDir(), 'notifications-seen.json');
}

/** 解析 results jsonl，容忍损坏行 */
export function parseResults(raw: string): ResultEntry[] {
  const out: ResultEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { ts?: unknown; taskName?: unknown; result?: unknown; output?: unknown };
      const ts = typeof e.ts === 'number' ? e.ts : Date.parse(String(e.ts));
      if (!Number.isFinite(ts)) continue;
      out.push({
        ts,
        taskName: typeof e.taskName === 'string' ? e.taskName : '(未知任务)',
        result: typeof e.result === 'string' ? e.result : 'unknown',
        output: typeof e.output === 'string' ? e.output : '',
      });
    } catch {
      /* skip 损坏行 */
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export function formatSummary(entries: ResultEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((e) => {
    const icon = e.result === 'success' ? '✓' : '✗';
    const head = `  ${icon} ${e.taskName} — ${e.result}`;
    return e.output ? `${head}\n    ${e.output.replace(/\n/g, '\n    ')}` : head;
  });
  return ['━━━ 离线期间任务执行报告 ━━━', ...lines, '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'].join('\n');
}

export function readSeenTs(): number {
  try {
    const d = JSON.parse(readFileSync(seenMarkerPath(), 'utf-8')) as { ts?: number };
    return typeof d.ts === 'number' ? d.ts : 0;
  } catch {
    return 0;
  }
}

export function writeSeenTs(ts: number): void {
  try {
    writeFileSync(seenMarkerPath(), JSON.stringify({ ts }), 'utf-8');
  } catch {
    /* 标记失败不阻塞 */
  }
}

/** 收集本机未报告过的任务结果（ts > 上次已报告时间） */
export function collectUnread(limit = 20): ResultEntry[] {
  try {
    const f = resultsFilePath();
    if (!existsSync(f)) return [];
    const since = readSeenTs();
    return parseResults(readFileSync(f, 'utf-8')).filter((e) => e.ts > since).slice(-limit);
  } catch {
    return [];
  }
}
