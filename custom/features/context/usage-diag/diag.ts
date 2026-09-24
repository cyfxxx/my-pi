/**
 * Usage-Diag — 每轮 LLM 用量记录与汇总（诊断用途）
 *
 * 记录每次 LLM 调用的 input/cacheRead/output/reasoning 到
 * <memoryDir>/context/.usage-diag.jsonl，供诊断工具展示会话用量汇总。
 * 目标：量化每轮请求发送量（平台统计的核心），定位 token 消耗大头。
 *
 * 纯逻辑，零 Pi 依赖。
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { getMemoryDir } from "../../../core/config";

function defaultDiagFile(): string {
  return join(getMemoryDir(), 'context', '.usage-diag.jsonl');
}
function defaultToolEventsFile(): string {
  return join(getMemoryDir(), 'stats', 'tool-events.jsonl');
}
function defaultToolUsageFile(): string {
  return join(getMemoryDir(), 'stats', 'tool-usage.json');
}
function defaultToolEventsDir(): string {
  return join(getMemoryDir(), 'stats');
}

const MAX_LINES = 20_000;
let linesSinceCheck = 0;
const CHECK_EVERY = 500;

export interface UsageRecord {
  ts: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
  contextTokens: number;
}

export interface AutoCompactEvent {
  type: "auto-compact";
  ts: number;
  contextTokens: number;
  threshold: number;
}

export interface PruneEvent {
  type: "prune" | "prune-think";
  ts: number;
  prunedTokens: number;
  prunedChars: number;
  prunedCount: number;
}

export interface UsageMissingEvent {
  type: "usage-missing";
  ts: number;
}

export interface ThinkingMeterEvent {
  type: "thinking-meter";
  ts: number;
  tokens: number;
}

export interface LevelChangeEvent {
  type: "level-change";
  ts: number;
  from: string;
  to: string;
  reason: string;
  pressure: string;
  source?: "auto" | "model";
}

export interface ToolEnableEvent {
  type: "tool-enable";
  ts: number;
  group: string;
  via: "enable_tool" | "cmd";
}

export interface ToolCallRecordEvent {
  type: "tool-call";
  ts: number;
  tool: string;
  args: string;
  result: string;
  ok: boolean;
  durationMs: number;
}

const MAX_TOOL_ARGS_LEN = 200;
const MAX_TOOL_RESULT_LEN = 300;

export interface ToolUsage {
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  firstTs: number;
  lastTs: number;
  byDevice: Record<string, { calls: number; input: number; lastTs: number }>;
}

export interface ToolUseEvent {
  type: "tool-use";
  eid: string;
  device: string;
  ts: number;
  iso: string;
  tool: string;
  outputTokens: number;
  input?: number;
  cacheRead?: number;
}

export type DiagLine =
  | UsageRecord
  | AutoCompactEvent
  | PruneEvent
  | UsageMissingEvent
  | ThinkingMeterEvent
  | LevelChangeEvent
  | ToolEnableEvent
  | ToolCallRecordEvent
  | ToolUseEvent;

const TOOL_RETENTION_DAYS = 30;

export function getDiagFile(): string {
  return process.env.PI_USAGE_DIAG_FILE || defaultDiagFile();
}

/** 读取诊断文件为 JSONL 行（跳过损坏行；文件不存在时返回空） */
export function loadDiagLines(): DiagLine[] {
  const file = getDiagFile();
  try {
    if (!existsSync(file)) return [];
    const out: DiagLine[] = [];
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as DiagLine);
      } catch {
        /* 跳过损坏行 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function rotateIfNeeded(): void {
  linesSinceCheck++;
  if (linesSinceCheck < CHECK_EVERY) return;
  linesSinceCheck = 0;
  try {
    const content = readFileSync(getDiagFile(), "utf-8");
    const trimmed = trimDiagContent(content);
    if (trimmed !== null) {
      const tmp = getDiagFile() + ".tmp." + process.pid;
      writeFileSync(tmp, trimmed);
      renameSync(tmp, getDiagFile());
    }
  } catch {
    // 轮转失败不阻塞：下次检查再试
  }
}

export function trimDiagContent(content: string, maxLines: number = MAX_LINES): string | null {
  const lines = content.split("\n").filter(Boolean);
  if (lines.length <= maxLines) return null;
  return lines.slice(-maxLines).join("\n") + "\n";
}

export function recordUsage(record: UsageRecord): void {
  try {
    const f = getDiagFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(record) + "\n");
    rotateIfNeeded();
  } catch {
    // 诊断记录失败不阻塞会话
  }
}

let lastUsageMissingLog = 0;
const USAGE_MISSING_THROTTLE_MS = 10 * 60 * 1000;

export function recordUsageMissing(): void {
  const now = Date.now();
  if (now - lastUsageMissingLog < USAGE_MISSING_THROTTLE_MS) return;
  lastUsageMissingLog = now;
  try {
    const event: UsageMissingEvent = { type: "usage-missing", ts: now };
    const f = getDiagFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(event) + "\n");
  } catch {
    // 诊断记录失败不阻塞会话
  }
}

export function recordAutoCompact(contextTokens: number, threshold: number): void {
  try {
    const event: AutoCompactEvent = { type: "auto-compact", ts: Date.now(), contextTokens, threshold };
    const f = getDiagFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(event) + "\n");
  } catch {
    // ignore
  }
}

export function recordPrune(
  prunedTokens: number,
  prunedChars: number,
  prunedCount: number,
  kind: "tool" | "thinking" = "tool",
): void {
  try {
    const event: PruneEvent = {
      type: kind === "thinking" ? "prune-think" : "prune",
      ts: Date.now(),
      prunedTokens,
      prunedChars,
      prunedCount,
    };
    const f = getDiagFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(event) + "\n");
  } catch {
    // ignore
  }
}

export function recordThinkingMeter(tokens: number): void {
  try {
    const event: ThinkingMeterEvent = { type: "thinking-meter", ts: Date.now(), tokens };
    const f = getDiagFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(event) + "\n");
  } catch {
    // ignore
  }
}

export function recordLevelChange(e: Omit<LevelChangeEvent, "type" | "ts">): void {
  try {
    const event: LevelChangeEvent = { type: "level-change", ts: Date.now(), ...e };
    const f = getDiagFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(event) + "\n");
  } catch {
    // ignore
  }
}

export function getToolEventsFile(): string {
  return process.env.PI_TOOL_EVENTS_FILE || defaultToolEventsFile();
}

export function recordToolEnable(group: string, via: "enable_tool" | "cmd"): void {
  try {
    const ev: ToolEnableEvent = { type: "tool-enable", ts: Date.now(), group, via };
    const f = getToolEventsFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(ev) + "\n");
  } catch {
    // ignore（台账失败不影响工具启用功能）
  }
}

export function recordToolCallEvent(ev: {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  ok: boolean;
  durationMs: number;
}): void {
  try {
    const argsStr = JSON.stringify(ev.args ?? {}).slice(0, MAX_TOOL_ARGS_LEN);
    const resultStr = (ev.result ?? "").slice(0, MAX_TOOL_RESULT_LEN);
    const record: ToolCallRecordEvent = {
      type: "tool-call",
      ts: Date.now(),
      tool: ev.tool,
      args: argsStr,
      result: resultStr,
      ok: ev.ok,
      durationMs: ev.durationMs,
    };
    const f = getToolEventsFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(record) + "\n");
  } catch {
    // 记录失败静默
  }
}

export function loadToolCallRecords(max = 5000): ToolCallRecordEvent[] {
  try {
    const lines = readFileSync(getToolEventsFile(), "utf-8").trim().split("\n").filter(Boolean);
    const out: ToolCallRecordEvent[] = [];
    for (const line of lines.slice(-max)) {
      try {
        const e = JSON.parse(line);
        if (isToolCallRecordEvent(e)) out.push(e);
      } catch {
        // 损坏行跳过
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function loadToolEnableEvents(): ToolEnableEvent[] {
  try {
    return readFileSync(getToolEventsFile(), "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          const e = JSON.parse(l);
          return isToolEnableEvent(e) ? e : null;
        } catch {
          return null;
        }
      })
      .filter((e): e is ToolEnableEvent => e !== null);
  } catch {
    return [];
  }
}

export function getToolUsageFile(): string {
  return process.env.PI_TOOL_USAGE_FILE || defaultToolUsageFile();
}

export function loadToolUsage(): Record<string, ToolUsage> {
  try {
    const f = getToolUsageFile();
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf8")) as Record<string, ToolUsage>;
  } catch {
    return {};
  }
}

export function recordToolUsage(
  toolName: string,
  usage: { input?: number; cacheRead?: number; cacheWrite?: number },
): void {
  try {
    const all = loadToolUsage();
    const cur: ToolUsage = all[toolName] ?? { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, firstTs: Date.now(), lastTs: Date.now(), byDevice: {} };
    cur.calls += 1;
    cur.input += usage.input ?? 0;
    cur.cacheRead += usage.cacheRead ?? 0;
    cur.cacheWrite += usage.cacheWrite ?? 0;
    all[toolName] = cur;
    const f = getToolUsageFile();
    mkdirSync(dirname(f), { recursive: true });
    const tmp = f + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(all), "utf8");
    renameSync(tmp, f);
  } catch {
    /* 记录失败静默 */
  }
}

export function getDeviceId(): string {
  return process.env.PI_DEVICE_ID || hostname() || "host";
}

export function getToolEventsDir(): string {
  return process.env.PI_TOOL_EVENTS_DIR || defaultToolEventsDir();
}

export function toolUseFile(device = getDeviceId()): string {
  return join(getToolEventsDir(), `tool-use-${device.replace(/[^A-Za-z0-9._-]/g, "_")}.jsonl`);
}

let toolCallSeq = 0;

export function recordToolCall(ev: {
  tool: string;
  outputTokens: number;
  input?: number;
  cacheRead?: number;
}): void {
  try {
    const device = getDeviceId();
    toolCallSeq += 1;
    const ts = Date.now();
    const record: ToolUseEvent = {
      type: "tool-use",
      eid: `${device}:${process.pid}:${toolCallSeq}`,
      device,
      ts,
      iso: new Date(ts).toISOString(),
      tool: ev.tool,
      outputTokens: ev.outputTokens,
      ...(ev.input !== undefined ? { input: ev.input } : {}),
      ...(ev.cacheRead !== undefined ? { cacheRead: ev.cacheRead } : {}),
    };
    const f = toolUseFile(device);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // 记录失败静默
  }
}

export function loadToolUseEvents(allDevices = true, maxDays = TOOL_RETENTION_DAYS): ToolUseEvent[] {
  const dir = getToolEventsDir();
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  const out: ToolUseEvent[] = [];
  try {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith("tool-use-") || !name.endsWith(".jsonl")) continue;
      if (!allDevices && !name.includes(getDeviceId().replace(/[^A-Za-z0-9._-]/g, "_"))) continue;
      for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          if (isToolUseEvent(e) && e.ts >= cutoff) out.push(e);
        } catch {
          /* 损坏行跳过 */
        }
      }
    }
    out.sort((a, b) => a.ts - b.ts);
  } catch {
    /* 静默 */
  }
  return out;
}

export function pruneToolEvents(maxDays = TOOL_RETENTION_DAYS, device = getDeviceId()): number {
  const f = toolUseFile(device);
  try {
    if (!existsSync(f)) return 0;
    const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
    const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
    const kept = lines.filter((l) => {
      try {
        const e = JSON.parse(l);
        return isToolUseEvent(e) ? e.ts >= cutoff : true;
      } catch {
        return true;
      }
    });
    const removed = lines.length - kept.length;
    if (removed > 0) {
      const tmp = f + ".tmp." + process.pid;
      writeFileSync(tmp, kept.join("\n") + (kept.length ? "\n" : ""), "utf8");
      renameSync(tmp, f);
    }
    return removed;
  } catch {
    return 0;
  }
}

export function recomputeToolUsage(maxDays = TOOL_RETENTION_DAYS): Record<string, ToolUsage> {
  const events = loadToolUseEvents(true, maxDays);
  const acc = new Map<string, ToolUsage>();
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.eid)) continue;
    seen.add(e.eid);
    let cur = acc.get(e.tool);
    if (!cur) {
      cur = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, firstTs: e.ts, lastTs: e.ts, byDevice: {} };
      acc.set(e.tool, cur);
    }
    cur.calls += 1;
    cur.input += e.input ?? 0;
    cur.cacheRead += e.cacheRead ?? 0;
    cur.firstTs = Math.min(cur.firstTs, e.ts);
    cur.lastTs = Math.max(cur.lastTs, e.ts);
    const d = cur.byDevice[e.device] ?? { calls: 0, input: 0, lastTs: e.ts };
    d.calls += 1;
    d.input += e.input ?? 0;
    d.lastTs = Math.max(d.lastTs, e.ts);
    cur.byDevice[e.device] = d;
  }
  const all = Object.fromEntries(acc);
  try {
    const f = getToolUsageFile();
    mkdirSync(dirname(f), { recursive: true });
    const tmp = f + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
    renameSync(tmp, f);
  } catch {
    /* 静默 */
  }
  return all;
}

export interface UsageSummary {
  requests: number;
  inputTotal: number;
  inputAvg: number;
  inputMax: number;
  cacheReadTotal: number;
  cacheHitRatio: number;
  outputTotal: number;
  reasoningTotal: number;
  recentTrend: number[];
}

export function summarizeRecords(records: UsageRecord[]): UsageSummary | null {
  if (records.length === 0) return null;
  const inputTotal = records.reduce((s, r) => s + r.input, 0);
  const cacheReadTotal = records.reduce((s, r) => s + r.cacheRead, 0);
  return {
    requests: records.length,
    inputTotal,
    inputAvg: Math.round(inputTotal / records.length),
    inputMax: Math.max(...records.map((r) => r.input)),
    cacheReadTotal,
    cacheHitRatio: inputTotal + cacheReadTotal > 0 ? Math.round((cacheReadTotal / (inputTotal + cacheReadTotal)) * 100) : 0,
    outputTotal: records.reduce((s, r) => s + r.output, 0),
    reasoningTotal: records.reduce((s, r) => s + r.reasoning, 0),
    recentTrend: records.slice(-20).map((r) => r.contextTokens),
  };
}

export function formatUsageSummary(lines: DiagLine[]): string {
  const records = lines.filter((l): l is UsageRecord => !("type" in l)) as UsageRecord[];
  const summary = summarizeRecords(records);
  if (!summary) return "暂无用量记录（/usage-diag 需要先运行过至少一轮对话）。";

  const fmt = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(1)}K` : `${n}`);
  const trend = summary.recentTrend.length > 0
    ? summary.recentTrend.map((n, i) => (i > 0 && i % 4 === 3 ? `${fmt(n)}\n  ` : `${fmt(n)} → `)).join("")
    : "-";

  const compactEvents = lines.filter((l) => "type" in l && l.type === "auto-compact") as AutoCompactEvent[];
  const compactLines = compactEvents.length > 0
    ? `  自动压缩触发: ${compactEvents.length} 次（最近: ${fmt(compactEvents[compactEvents.length - 1].contextTokens)} @ 阈值 ${fmt(compactEvents[compactEvents.length - 1].threshold)}）`
    : "  自动压缩触发: 0 次";

  const pruneEvents = lines.filter((l) => "type" in l && (l.type === "prune" || l.type === "prune-think")) as PruneEvent[];
  const prunedTotal = pruneEvents.reduce((s, e) => s + e.prunedTokens, 0);
  const pruneLine = pruneEvents.length > 0
    ? `  分层擦除: ${pruneEvents.length} 次 · 累计回收 ${fmt(prunedTotal)} token · 最近 ${fmt(pruneEvents[pruneEvents.length - 1].prunedTokens)}`
    : "  分层擦除: 0 次（上下文未超过保护带）";

  return [
    "=== 会话用量诊断 ===",
    `请求数: ${summary.requests}`,
    `输入(未命中): 合计 ${fmt(summary.inputTotal)} · 平均 ${fmt(summary.inputAvg)}/轮 · 峰值 ${fmt(summary.inputMax)}`,
    `缓存命中: ${fmt(summary.cacheReadTotal)} (${summary.cacheHitRatio}%)`,
    `输出: ${fmt(summary.outputTotal)}（其中 reasoning ${fmt(summary.reasoningTotal)}）`,
    compactLines,
    pruneLine,
    `最近 ${Math.min(20, summary.recentTrend.length)} 轮总输入(contextTokens):`,
    `  ${trend.trim()}`,
    "注: 平台统计量 = 输入未命中 + 缓存命中 + 输出；缓存命中按低价计费。",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolCallRecordEvent(value: unknown): value is ToolCallRecordEvent {
  return isRecord(value) && value.type === "tool-call";
}

function isToolEnableEvent(value: unknown): value is ToolEnableEvent {
  return isRecord(value) && value.type === "tool-enable";
}

function isToolUseEvent(value: unknown): value is ToolUseEvent {
  return isRecord(value) && value.type === "tool-use";
}
