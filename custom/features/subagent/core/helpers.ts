/**
 * Subagent Feature — 辅助纯函数（零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/subagent/helpers.ts`（去掉 pi-ai/pi-coding-agent 依赖）。
 */

import { formatTokens } from '../../../core/text';
import type { RiskLevel, SingleResult } from './types';

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const LOCAL_CONCURRENCY = 1;
export const TERMUX_MAX_PARALLEL = 2;
export const TERMUX_CONCURRENCY = 2;
export const COLLAPSED_ITEM_COUNT = 10;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;
export const PREVIOUS_OUTPUT_CAP_BYTES = 96 * 1024;

export const READONLY_ALLOWED_TOOLS = new Set(['read', 'grep', 'find', 'ls']);

export const READONLY_AGENT_HINT = `

---
[强制只读模式] 本代理以只读模式运行：禁止创建、修改、删除任何文件，禁止执行写入性命令与网络上传操作。仅允许使用读取类工具（read/grep/find/ls 等）探索与验证。
`;

export function isTermuxEnv(): boolean {
  return process.platform === 'android' || Boolean(process.env.TERMUX_VERSION);
}

export function getMaxParallelTasks(): number {
  return isTermuxEnv() ? TERMUX_MAX_PARALLEL : MAX_PARALLEL_TASKS;
}

export function getMaxConcurrency(localProvider: boolean): number {
  if (localProvider) return LOCAL_CONCURRENCY;
  return isTermuxEnv() ? TERMUX_CONCURRENCY : MAX_CONCURRENCY;
}

export function resolveAgentTools(agent: { readonly?: boolean; tools?: string[] }): string[] | undefined {
  if (!agent.readonly) return agent.tools;
  const filtered = (agent.tools ?? []).filter((t) => READONLY_ALLOWED_TOOLS.has(t));
  return filtered.length > 0 ? filtered : ['read', 'ls'];
}

export function buildAgentPrompt(agent: { readonly?: boolean; systemPrompt: string }): string {
  return agent.readonly ? READONLY_AGENT_HINT + agent.systemPrompt : agent.systemPrompt;
}

export function isLocalProvider(provider?: string): boolean {
  if (!provider) return false;
  const p = provider.toLowerCase();
  return /ollama|localhost|127\.0\.0\.1|\blocal\b|lmstudio|lm\.studio|llama\.cpp|vllm|exo|koboldcpp|text-gen|llamacpp/i.test(p);
}

export function scheduleKillChain(
  proc: { kill: (signal?: NodeJS.Signals | number) => boolean; once?: (ev: string, fn: () => void) => void },
  killDelayMs = 5000,
): () => void {
  try {
    proc.kill('SIGTERM');
  } catch {
    return () => {};
  }
  const killTimer = setTimeout(() => {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already exited */
    }
  }, killDelayMs);
  killTimer.unref?.();
  const clear = (): void => clearTimeout(killTimer);
  proc.once?.('close', clear);
  return clear;
}

export { formatTokens };

export function calculateContextTokens(usage: {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): number {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

export function formatUsageStats(
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextTokens?: number;
    turns?: number;
  },
  model?: string,
): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? 's' : ''}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens && usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(' ');
}

export function getFinalOutput(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content as { type?: string; text?: string }[]) {
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
      }
    }
  }
  return '';
}

export function isFailedResult(result: SingleResult): boolean {
  return result.exitCode !== 0 || result.stopReason === 'error' || result.stopReason === 'aborted';
}

export function getResultOutput(result: SingleResult): string {
  if (isFailedResult(result)) {
    return result.errorMessage || result.stderr || getFinalOutput(result.messages) || '(no output)';
  }
  return getFinalOutput(result.messages) || '(no output)';
}

export function capPreviousOutput(output: string, maxBytes: number = PREVIOUS_OUTPUT_CAP_BYTES): string {
  if (Buffer.byteLength(output, 'utf8') <= maxBytes) return output;
  let sliced = Buffer.from(output, 'utf8').subarray(0, maxBytes).toString('utf8');
  if (sliced.endsWith('\uFFFD')) sliced = sliced.slice(0, -1);
  return `${sliced}\n[truncated]`;
}

export function applyPreviousPlaceholder(task: string, previousOutput: string): string {
  return task.replace(/\{previous\}/g, () => capPreviousOutput(previousOutput));
}

export function taskPreview(task: string | undefined, maxLen = 40): string {
  const cleanTask = (task ?? '').replace(/\{previous\}/g, '').trim();
  return cleanTask.length > maxLen ? `${cleanTask.slice(0, maxLen)}...` : cleanTask;
}

export function agentLabel(agent: string | undefined): string {
  return agent ?? '?';
}

export function truncateBytesKeepHead(output: string, maxBytes: number): { content: string; truncated: boolean; totalBytes: number; outputBytes: number } {
  const totalBytes = Buffer.byteLength(output, 'utf8');
  if (totalBytes <= maxBytes) return { content: output, truncated: false, totalBytes, outputBytes: totalBytes };
  let sliced = Buffer.from(output, 'utf8').subarray(0, maxBytes).toString('utf8');
  if (sliced.endsWith('\uFFFD')) sliced = sliced.slice(0, -1);
  return { content: sliced, truncated: true, totalBytes, outputBytes: Buffer.byteLength(sliced, 'utf8') };
}

export function truncateParallelOutput(output: string): string {
  const result = truncateBytesKeepHead(output, PER_TASK_OUTPUT_CAP);
  if (!result.truncated) return output;
  return `${result.content}\n\n[Output truncated: ${result.totalBytes - result.outputBytes} bytes omitted. Full output preserved in tool details.]`;
}

const HIGH_RISK_RE = /\brm\s+-[rRf]|DROP\s+TABLE|DROP\s+DATABASE|\bmigrate\b|\bbackup\b.*\bdelet|production|prod\b|\bdeploy\b.*\brollback/i;
const MED_RISK_RE = /\bwrite\b|\bedit\b|\bbash\b.*\binstall\b|\bnpm\s+i\b|\bpip\s+install\b|\bchmod\b|\bchown\b|\bsystemctl\b/i;

export function classifyTaskRisk(task: string): RiskLevel {
  if (HIGH_RISK_RE.test(task)) return '3σ';
  if (MED_RISK_RE.test(task)) return '2σ';
  return '1σ';
}

export function riskToolRestrictions(level: RiskLevel): string[] | null {
  if (level === '3σ') return ['read', 'grep', 'find', 'ls'];
  return null;
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number, signal?: AbortSignal) => Promise<TOut>,
  externalSignal?: AbortSignal,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  let aborted = false;
  const internal = new AbortController();
  const stop = (): void => {
    if (aborted) return;
    aborted = true;
    internal.abort(new Error('Subagent dispatch aborted'));
  };
  const onExternalAbort = (): void => stop();
  if (externalSignal) {
    if (externalSignal.aborted) stop();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const workers = new Array(limit).fill(null).map(async () => {
      while (!aborted) {
        const current = nextIndex++;
        if (current >= items.length) return;
        try {
          results[current] = await fn(items[current], current, internal.signal);
        } catch (err) {
          stop();
          throw err;
        }
      }
    });
    await Promise.all(workers);
  } finally {
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
  return results;
}
