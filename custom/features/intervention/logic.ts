/**
 * Intervention Feature — 纯逻辑层（零 Pi 依赖）
 *
 * 迁移自 pi-tools `agent/extensions/pi-intervention/{types,helpers}.ts`。
 * 职责：abort 快照的结构化构造、JSONL 落盘、corrective prompt 关联。
 *
 * 数据落点：`<memoryDir>/interventions.jsonl`（my-pi = portable/memory/）。
 * 缓存纪律：本模块不注入 system prompt、不写入时间戳到提示词。
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { getMemoryDir } from '../../core/config';
import { writeTextSync } from '../../core/atomic-write';
import { readJSONL } from '../../core/fs-json';
import { oneLine, truncateChars } from '../../core/text';

export const MAX_RECORDS = 2000;
export const PROMPT_TRUNC = 800;
export const TAIL_TRUNC = 400;
export const STEERING_MAX = 3;
export const STEERING_TRUNC = 300;
export const TOOLS_TRACK_MAX = 20;
export const TOOL_BRIEF_TRUNC = 120;
export const CORRECTIVE_WINDOW_MS = 15 * 60_000;

export interface ToolTouch {
  name: string;
  brief: string;
}

export interface InterventionRecord {
  id: string;
  ts: string;
  type: 'abort';
  prompt: string;
  tools: string[];
  lastTool: ToolTouch | null;
  tail: string;
  steering: string[];
  correctivePrompt: string | null;
  correctedAt: string | null;
  env: { platform: string; termux: boolean };
  cwd: string;
}

export interface RunState {
  prompt: string;
  startedAt: number;
  tools: ToolTouch[];
}

/** 解析 interventions.jsonl 路径（显式参数 > PI_INTERVENTIONS_FILE > PI_MEMORY_DIR > portable/memory） */
export function resolveInterventionsFile(memoryDir?: string): string {
  const override = process.env.PI_INTERVENTIONS_FILE;
  if (override) return override;
  const base = memoryDir ?? process.env.PI_MEMORY_DIR ?? getMemoryDir();
  return path.join(base, 'interventions.jsonl');
}

export function trunc(text: string, max: number): string {
  if (!text) return '';
  return truncateChars(text, max);
}

export { oneLine };

/** 从 agent_end 的 messages 中提取最后一条 assistant 文本尾部 */
export function extractAssistantTail(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== 'assistant') continue;
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .map((c) => (c && typeof c === 'object' && (c as { type?: string }).type === 'text' ? String((c as { text?: string }).text ?? '') : ''))
        .filter(Boolean)
        .join('\n');
    }
    return trunc(text.trim(), TAIL_TRUNC);
  }
  return '';
}

/** 判定 agent_end 是否为用户中断 */
export function isAbortedEnd(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; stopReason?: string };
    if (m?.role === 'assistant') return m.stopReason === 'aborted';
  }
  return false;
}

export function buildRecord(input: {
  prompt: string;
  tools: ToolTouch[];
  tail: string;
  steering: string[];
  now?: Date;
}): InterventionRecord {
  const now = input.now ?? new Date();
  return {
    id: `iv_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: now.toISOString(),
    type: 'abort',
    prompt: trunc(input.prompt, PROMPT_TRUNC),
    tools: input.tools.slice(-10).map((t) => t.name),
    lastTool: input.tools.length ? input.tools[input.tools.length - 1] : null,
    tail: input.tail,
    steering: input.steering.slice(-STEERING_MAX),
    correctivePrompt: null,
    correctedAt: null,
    env: { platform: os.platform(), termux: process.env.TERMUX_VERSION !== undefined },
    cwd: process.cwd(),
  };
}

export function readLines(file: string): InterventionRecord[] {
  return readJSONL<InterventionRecord>(file);
}

export function writeLines(file: string, records: InterventionRecord[]): void {
  // 原子写 + 随机 tmp 后缀：并发写同一 JSONL 不再互相覆盖。
  writeTextSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

export function appendRecord(file: string, record: InterventionRecord): void {
  const records = readLines(file);
  records.push(record);
  writeLines(file, records.slice(-MAX_RECORDS));
}

/** 把 corrective prompt 回填到指定 abort 记录（调用方负责关联窗判定） */
export function linkCorrective(file: string, id: string, correctivePrompt: string, now?: Date): boolean {
  // 空纠正视为无效：否则会写入空串，且下一轮因真值判断再次命中并重写整份 JSONL。
  if (!correctivePrompt || !correctivePrompt.trim()) return false;
  const records = readLines(file);
  const idx = records.findIndex((r) => r.id === id);
  if (idx < 0 || records[idx].correctivePrompt) return false;
  records[idx].correctivePrompt = trunc(correctivePrompt, PROMPT_TRUNC);
  records[idx].correctedAt = (now ?? new Date()).toISOString();
  writeLines(file, records);
  return true;
}

/** 汇总统计（供 /intervention stats 使用） */
export function summarize(records: InterventionRecord[], now: number = Date.now()): {
  total: number;
  corrected: number;
  withSteering: number;
  lastWeek: number;
} {
  const weekAgo = now - 7 * 24 * 3600_000;
  return {
    total: records.length,
    corrected: records.filter((r) => r.correctivePrompt).length,
    withSteering: records.filter((r) => r.steering.length).length,
    lastWeek: records.filter((r) => new Date(r.ts).getTime() >= weekAgo).length,
  };
}
