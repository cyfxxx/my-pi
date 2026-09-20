/**
 * Context Budget — 上下文预算 + token 估算 + 输出裁剪 + 缓存统计 统一模块
 *
 * 迁移自 pi-tools services/token-budget/context-budget.ts。
 *
 * - 统一 token 估算（中文 bigram 感知，emoji 按 1 token 保守校准）
 * - 预算源支持真实 contextWindow 校准（不再硬编码 128K）
 * - 压力提示档位化（high/critical 才注入固定文案，保证 system prompt 字节级稳定 → 缓存命中）
 * - 输出裁剪预算按 token 计
 * - 缓存命中统计聚合（仅记录，供调试）
 *
 * 状态挂载在 globalThis + Symbol.for 单例：跨扩展/跨模块实例共享。
 *
 * 纯逻辑，零 Pi 依赖。
 */

import { archivedStub } from './output-archive';

export interface BudgetReport {
  used: number;
  total: number;
  remaining: number;
  ratio: number;
  pressure: 'low' | 'medium' | 'high' | 'critical';
  topConsumers: { tool: string; tokens: number }[];
}

const DEFAULT_TOTAL = 128_000;
const MEDIUM_THRESHOLD = 0.7;
const HIGH_THRESHOLD = 0.85;
const CRITICAL_THRESHOLD = 0.95;
const MAX_LOG = 50;

interface UsageEntry {
  tool: string;
  tokens: number;
  timestamp: number;
}

interface OutputEntry {
  tool: string;
  tokens: number;
  ts: number;
}

interface SharedBudgetState {
  tokenUsageLog: UsageEntry[];
  usedTotal: number;
  totalBudget: number;
  compactThreshold: number | null;
  justCompacted: boolean;
  outputEntries: OutputEntry[];
  outputTotalTokens: number;
  cacheReadTotal: number;
  cacheWriteTotal: number;
  cacheCalls: number;
}

const STATE_KEY = Symbol.for('my-pi.context-budget.state');

function getState(): SharedBudgetState {
  const g = globalThis as Record<symbol, SharedBudgetState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    s = {
      tokenUsageLog: [],
      usedTotal: 0,
      totalBudget: DEFAULT_TOTAL,
      compactThreshold: null,
      justCompacted: false,
      outputEntries: [],
      outputTotalTokens: 0,
      cacheReadTotal: 0,
      cacheWriteTotal: 0,
      cacheCalls: 0,
    };
    g[STATE_KEY] = s;
  }
  return s;
}

// 档位化提示文案（固定文本，保证 system prompt 稳定 → 缓存前缀稳定）
const HIGH_PRESSURE_HINT = '🟡 上下文已占窗口 85%。';
const CRITICAL_PRESSURE_HINT = '🔴 上下文已占窗口 95%，即将达到上限。';

export function setTotalBudget(budget: number): void {
  getState().totalBudget = budget;
}

// 用真实 contextWindow 校准总预算
export function setContextWindow(contextWindow: number): void {
  if (Number.isFinite(contextWindow) && contextWindow > 0) {
    getState().totalBudget = contextWindow;
  }
}

/** @deprecated pressure 分母回归真实窗口，本设置仅保留 API 兼容 */
export function setCompactThreshold(t: number): void {
  if (Number.isFinite(t) && t > 0) getState().compactThreshold = t;
}

// 压缩已发生标记：下一轮 setUsedTokens 直接覆盖为新基线（允许 usedTotal 回落）
export function markCompacted(): void {
  getState().justCompacted = true;
}

// 真实用量校准
export function setUsedTokens(used: number): void {
  const s = getState();
  if (Number.isFinite(used) && used >= 0) {
    if (s.justCompacted) {
      s.usedTotal = used;
      s.justCompacted = false;
    } else {
      s.usedTotal = Math.max(s.usedTotal, used);
    }
  }
}

export function recordToolUsage(tool: string, tokens: number): void {
  const s = getState();
  s.tokenUsageLog.push({ tool, tokens, timestamp: Date.now() });
  if (s.tokenUsageLog.length > MAX_LOG) {
    s.tokenUsageLog = s.tokenUsageLog.slice(-MAX_LOG);
  }
  s.usedTotal += tokens;
}

export function getBudgetReport(): BudgetReport {
  const s = getState();
  const used = s.usedTotal;
  const base = s.totalBudget;
  const ratio = base > 0 ? Math.min(1, used / base) : 0;

  let pressure: BudgetReport['pressure'] = 'low';
  if (ratio >= CRITICAL_THRESHOLD) pressure = 'critical';
  else if (ratio >= HIGH_THRESHOLD) pressure = 'high';
  else if (ratio >= MEDIUM_THRESHOLD) pressure = 'medium';

  const consumerMap = new Map<string, number>();
  for (const e of s.tokenUsageLog) {
    consumerMap.set(e.tool, (consumerMap.get(e.tool) || 0) + e.tokens);
  }
  const topConsumers = Array.from(consumerMap.entries())
    .map(([tool, tokens]) => ({ tool, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);

  return {
    used,
    total: s.totalBudget,
    remaining: Math.max(0, s.totalBudget - used),
    ratio,
    pressure,
    topConsumers,
  };
}

export function getTokenPressureTag(): string | null {
  const r = getBudgetReport();
  if (r.pressure === 'high') return HIGH_PRESSURE_HINT;
  if (r.pressure === 'critical') return CRITICAL_PRESSURE_HINT;
  return null;
}

export function resetBudget(): void {
  const s = getState();
  s.tokenUsageLog = [];
  s.usedTotal = 0;
}

export function getUrgencyHint(): string | null {
  const r = getBudgetReport();
  if (r.pressure === 'critical') {
    return '🔴 上下文即将达到窗口上限；压缩会自动触发并生成摘要（关键决策与待办保留在摘要中），需精确保真的细节可先存 ctx_note。';
  }
  if (r.pressure === 'high') {
    return '🟠 上下文已占窗口 85%。';
  }
  return null;
}

// ── 统一 token 估算（中文感知，emoji 保守校准） ──

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const digits = (text.match(/[0-9]/g) || []).length;
  const astral = (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length;
  const other = text.length - cjk - digits - astral * 2;
  return Math.ceil(cjk / 2 + digits / 3.5 + astral + other / 4);
}

const TRUNC_BREAKS = '。；;！!？?…\n，,、 ()：“”';
const TRUNC_MARK_TOKEN_BUDGET = 6;

export function truncateByTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const contentCap = Math.max(1, maxTokens - TRUNC_MARK_TOKEN_BUDGET);
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, mid)) <= contentCap) low = mid;
    else high = mid - 1;
  }
  const floor = Math.floor(low / 2);
  let cut = low;
  for (let i = low - 1; i >= floor; i--) {
    if (TRUNC_BREAKS.includes(text[i])) {
      cut = i + 1;
      break;
    }
  }
  const truncated = text.slice(0, cut);
  return `${truncated}\n\n[截断]`;
}

// ── 输出预算（按 token） ──

const OUTPUT_BUDGET_TOKENS = 20_000;
const PER_TOOL_TOKENS = 5_000;

export function recordOutput(tool: string, outputLength: number): void {
  const tokens = Math.ceil(outputLength / 3.5);
  const s = getState();
  s.outputEntries.push({ tool, tokens, ts: Date.now() });
  s.outputTotalTokens += tokens;
}

export function pruneToolOutput(text: string, toolName: string): string {
  const s = getState();
  const textTokens = estimateTokens(text);
  const maxLenTokens = Math.min(PER_TOOL_TOKENS, Math.max(500, OUTPUT_BUDGET_TOKENS - s.outputTotalTokens));
  if (textTokens <= maxLenTokens && s.outputTotalTokens + textTokens <= OUTPUT_BUDGET_TOKENS) {
    return text;
  }
  const allowed = Math.min(maxLenTokens, Math.max(300, OUTPUT_BUDGET_TOKENS - s.outputTotalTokens));
  if (allowed <= 0) {
    return archivedStub(text, `[${toolName} 输出已裁剪：累计输出已达预算上限]`);
  }
  const ratio = Math.round((allowed / textTokens) * 100);
  const truncated = truncateByTokens(text, allowed);
  const truncatedText = truncated.replace(/\n\n\[截断\]$/, '');
  return archivedStub(
    text,
    `${truncatedText}\n\n[${toolName} 输出已截断：约 ${textTokens} token → ${allowed} token (${ratio}%)]`,
  );
}

export function getOutputReport(): string {
  const s = getState();
  if (s.outputEntries.length === 0) return '';
  const byTool = new Map<string, number>();
  for (const e of s.outputEntries) {
    byTool.set(e.tool, (byTool.get(e.tool) || 0) + e.tokens);
  }
  const lines = [
    `工具输出预算: ${s.outputTotalTokens.toLocaleString()}/${OUTPUT_BUDGET_TOKENS.toLocaleString()} token`,
  ];
  for (const [tool, tokens] of byTool) {
    lines.push(`  ${tool}: ${tokens.toLocaleString()} token`);
  }
  lines.push(`  剩余: ${Math.max(0, OUTPUT_BUDGET_TOKENS - s.outputTotalTokens).toLocaleString()} token`);
  return lines.join('\n');
}

export function resetOutputBudget(): void {
  const s = getState();
  s.outputEntries = [];
  s.outputTotalTokens = 0;
}

// ── 缓存命中统计 ──

export interface CacheStats {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

export function recordCacheUsage(cacheReadTokens?: number, cacheWriteTokens?: number): void {
  if (!cacheReadTokens && !cacheWriteTokens) return;
  const s = getState();
  s.cacheReadTotal += cacheReadTokens || 0;
  s.cacheWriteTotal += cacheWriteTokens || 0;
  s.cacheCalls++;
}

export function getCacheStats(): CacheStats {
  const s = getState();
  return {
    cacheReadTokens: s.cacheReadTotal,
    cacheWriteTokens: s.cacheWriteTotal,
    calls: s.cacheCalls,
  };
}

export function resetCacheStats(): void {
  const s = getState();
  s.cacheReadTotal = 0;
  s.cacheWriteTotal = 0;
  s.cacheCalls = 0;
}

// ── 会话级重置 ──

export function resetAllBudgets(): void {
  resetBudget();
  resetOutputBudget();
  resetCacheStats();
  getState().totalBudget = DEFAULT_TOTAL;
}
