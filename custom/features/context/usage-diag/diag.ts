/**
 * Usage-Diag — 每轮 LLM 用量记录与汇总（诊断用途）
 *
 * 记录每次 LLM 调用的 input/cacheRead/output/reasoning 到
 * <memoryDir>/context/.usage-diag.jsonl，供诊断工具展示会话用量汇总。
 * 目标：量化每轮请求发送量（平台统计的核心），定位 token 消耗大头。
 *
 * 纯逻辑，零 Pi 依赖。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getMemoryDir } from "../../../core/config";

function defaultDiagFile(): string {
  return join(getMemoryDir(), 'context', '.usage-diag.jsonl');
}
// 2026-10-01（P4 第三批 B-3）：删除 legacy 跨设备工具台账（tool-events-/tool-use-*.jsonl 与
// tool-usage.json 的读写、类型与私有 helper）。消费方确认完毕：`scripts/tool-stats-sync.mjs`
// 只读 `context/usage.jsonl` 与 `stats/tool-count-*.json`；磁盘上这些事件最后一笔在 2026-09-24。

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

export interface LevelChangeEvent {
  type: "level-change";
  ts: number;
  from: string;
  to: string;
  reason: string;
  pressure: string;
  source?: "auto" | "model";
}

export type DiagLine =
  | UsageRecord
  | AutoCompactEvent
  | PruneEvent
  | UsageMissingEvent
  | LevelChangeEvent;

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

  const usageMissing = lines.filter((l) => "type" in l && l.type === "usage-missing").length;
  const missingLine =
    usageMissing > 0
      ? `  无用量记录: ${usageMissing} 轮（provider 未返回 usage，命中率与成本为估算口径）`
      : null;

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
    ...(missingLine ? [missingLine] : []),
    `最近 ${Math.min(20, summary.recentTrend.length)} 轮总输入(contextTokens):`,
    `  ${trend.trim()}`,
    "注: 平台统计量 = 输入未命中 + 缓存命中 + 输出；缓存命中按低价计费。",
  ].join("\n");
}

