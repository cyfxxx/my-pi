/**
 * 用量记录（记录闭环的最小版）：把工具调用写成本地 JSONL，供后续治理/优化使用。
 *
 * 只记"谁、什么时候、多久、成没成"，**不记参数与输出**（参数里可能有密钥/隐私）。
 * 落点：`<assistant>/.run/stats/tool-events.jsonl`（gitignored）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ToolEvent {
  readonly ts: string;
  readonly session: string;
  readonly tool: string;
  readonly durationMs: number;
  readonly ok: boolean;
}

export function statsFile(baseDir: string): string {
  return join(baseDir, '.run', 'stats', 'tool-events.jsonl');
}

function append(file: string, event: ToolEvent): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
}

export function readEvents(file: string): ToolEvent[] {
  if (!existsSync(file)) return [];
  const out: ToolEvent[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const event = JSON.parse(line) as Partial<ToolEvent>;
      if (typeof event.tool === 'string') {
        out.push({
          ts: event.ts ?? '',
          session: event.session ?? '',
          tool: event.tool,
          durationMs: typeof event.durationMs === 'number' ? event.durationMs : 0,
          ok: event.ok !== false,
        });
      }
    } catch {
      /* 跳过坏行 */
    }
  }
  return out;
}

/** 按工具聚合：次数、失败数、总耗时。 */
export function summarize(events: readonly ToolEvent[]): Array<{ tool: string; count: number; failures: number; totalMs: number }> {
  const byTool = new Map<string, { count: number; failures: number; totalMs: number }>();
  for (const event of events) {
    const bucket = byTool.get(event.tool) ?? { count: 0, failures: 0, totalMs: 0 };
    bucket.count += 1;
    if (!event.ok) bucket.failures += 1;
    bucket.totalMs += event.durationMs;
    byTool.set(event.tool, bucket);
  }
  return [...byTool.entries()]
    .map(([tool, bucket]) => ({ tool, ...bucket }))
    .sort((a, b) => b.count - a.count);
}

export interface ToolTracker {
  readonly onCall: (session: string, callId: string, name: string) => void;
  readonly onResult: (session: string, callId: string, ok: boolean) => void;
}

/** 把 tool/call 与 tool/result 配对成一条事件（用 callId 关联）。 */
export function createToolTracker(file: string, now: () => number = Date.now): ToolTracker {
  const open = new Map<string, { name: string; startedAt: number }>();
  return {
    onCall(session, callId, name) {
      open.set(callId, { name, startedAt: now() });
    },
    onResult(session, callId, ok) {
      const started = open.get(callId);
      if (started === undefined) return;
      open.delete(callId);
      append(file, {
        ts: new Date().toISOString(),
        session,
        tool: started.name,
        durationMs: Math.max(0, now() - started.startedAt),
        ok,
      });
    },
  };
}
