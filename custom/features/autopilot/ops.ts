/**
 * Autopilot Feature — 运行策略与遥测（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/{telemetry,config,state,policy,failover,budget,watchdog}.ts`。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getAgentDir } from '../../core/config';
import { writeJSONSync } from '../../core/atomic-write';
import { readTasks, telemetryPath, withStoreLock } from './storage';
import type {
  AutopilotBudget,
  AutopilotPolicy,
  ErrorClass,
  FallbackModel,
  Task,
  TelemetryEntry,
} from './types';
import { TELEMETRY_LIMIT, defaultAutopilotConfig } from './types';

// ── settings / models ──

export interface Settings {
  [key: string]: unknown;
  defaultProvider?: string;
  defaultModel?: string;
}

export function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(path.join(getAgentDir(), 'settings.json'), 'utf-8')) as Settings;
  } catch {
    return {};
  }
}

export interface ProviderInfo {
  name: string;
  models: { id: string; pricePer1kIn?: number; pricePer1kOut?: number; [k: string]: unknown }[];
  [k: string]: unknown;
}

export function readModels(): { providers?: Record<string, ProviderInfo> } {
  try {
    return JSON.parse(fs.readFileSync(path.join(getAgentDir(), 'models.json'), 'utf-8')) as {
      providers?: Record<string, ProviderInfo>;
    };
  } catch {
    return {};
  }
}

// ── autopilot config (.pi-autopilot-config.json) ──

export function configPath(): string {
  return process.env.PI_AUTOPILOT_CONFIG || path.join(getAgentDir(), '.pi-autopilot-config.json');
}

export function readAutopilotConfig(): ReturnType<typeof defaultAutopilotConfig> {
  const base = defaultAutopilotConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as Partial<ReturnType<typeof defaultAutopilotConfig>>;
    return {
      ...base,
      ...raw,
      budget: { ...base.budget, ...(raw.budget ?? {}) },
      policy: { ...base.policy, ...(raw.policy ?? {}) },
      fallbackModels: raw.fallbackModels ?? base.fallbackModels,
    };
  } catch {
    return base;
  }
}

export function writeAutopilotConfig(cfg: ReturnType<typeof defaultAutopilotConfig>): void {
  writeJSONSync(configPath(), cfg);
}

// ── admin state ──

export interface AdminState {
  action: 'none' | 'restart' | 'switch_session' | 'set_model' | 'restart_hang';
  targetSession?: string;
  targetModel?: string;
  targetProvider?: string;
  reason?: string;
  timestamp: number;
  restartLog: Record<string, unknown> | null;
}

function stateFile(): string {
  return process.env.PI_ADMIN_STATE_FILE
    ? path.resolve(process.env.PI_ADMIN_STATE_FILE)
    : path.join(getAgentDir(), '.pi-admin-state.json');
}

function defaultState(): AdminState {
  return { action: 'none', timestamp: 0, restartLog: null };
}

export function readState(): AdminState {
  try {
    return { ...defaultState(), ...(JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as Partial<AdminState>) };
  } catch {
    return defaultState();
  }
}

export function writeState(state: Partial<AdminState>): void {
  writeJSONSync(stateFile(), { ...defaultState(), ...state });
}

export function writeRestartRequest(
  action: 'restart' | 'switch_session' | 'set_model' | 'restart_hang',
  opts: { targetSession?: string; targetModel?: string; targetProvider?: string; reason?: string } = {},
): void {
  const now = Date.now();
  writeState({
    action,
    ...opts,
    timestamp: now,
    restartLog: { action, ...opts, timestamp: now },
  });
}

export function consumeRestartLog(): Record<string, unknown> | null {
  const state = readState();
  if (state.restartLog) {
    writeState({ restartLog: null, action: 'none' });
    return state.restartLog;
  }
  return null;
}

// ── telemetry ──

export function readTelemetry(): TelemetryEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(telemetryPath(), 'utf-8')) as { runs?: TelemetryEntry[] };
    return Array.isArray(data.runs) ? data.runs : [];
  } catch {
    return [];
  }
}

export function appendRun(entry: TelemetryEntry): Promise<void> {
  return withStoreLock(() => {
    const runs = readTelemetry();
    runs.push(entry);
    writeJSONSync(telemetryPath(), { runs: runs.length > TELEMETRY_LIMIT ? runs.slice(-TELEMETRY_LIMIT) : runs });
  });
}

export interface ModelStats {
  provider: string;
  model: string;
  runs: number;
  failures: number;
  successRate: number;
  avgDurationMs: number;
  totalCost: number;
}

export function statsByModel(runs: TelemetryEntry[]): ModelStats[] {
  const map = new Map<string, TelemetryEntry[]>();
  for (const r of runs) {
    const key = `${r.provider}/${r.model}`;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  const out: ModelStats[] = [];
  for (const [key, arr] of map) {
    const [provider, model] = key.split('/');
    const failures = arr.filter((r) => r.result === 'failed').length;
    out.push({
      provider,
      model,
      runs: arr.length,
      failures,
      successRate: arr.length ? (arr.length - failures) / arr.length : 0,
      avgDurationMs: arr.reduce((s, r) => s + r.durationMs, 0) / arr.length,
      totalCost: arr.reduce((s, r) => s + (r.estCost || 0), 0),
    });
  }
  return out.sort((a, b) => b.successRate - a.successRate);
}

export function statsByTask(runs: TelemetryEntry[]): { taskId: string; taskName: string; runs: number; failures: number; successRate: number }[] {
  const map = new Map<string, TelemetryEntry[]>();
  for (const r of runs) map.set(r.taskId, [...(map.get(r.taskId) ?? []), r]);
  const out = [];
  for (const [taskId, arr] of map) {
    const failures = arr.filter((r) => r.result === 'failed').length;
    out.push({
      taskId,
      taskName: arr[0]?.taskName || taskId,
      runs: arr.length,
      failures,
      successRate: arr.length ? (arr.length - failures) / arr.length : 0,
    });
  }
  return out.sort((a, b) => b.runs - a.runs);
}

function localDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 10);
}

export function todayRuns(runs: TelemetryEntry[]): number {
  const today = localDay(new Date());
  return runs.filter((r) => localDay(r.ts) === today).length;
}
export function todayCost(runs: TelemetryEntry[]): number {
  const today = localDay(new Date());
  return runs.filter((r) => localDay(r.ts) === today).reduce((s, r) => s + (r.estCost || 0), 0);
}

export function estimateCost(provider: string, model: string, promptLen: number, outputLen: number): number {
  const models = readModels();
  const p = models.providers?.[provider];
  if (!p) return 0;
  const m = p.models?.find((x) => x.id === model);
  if (!m) return 0;
  const inPrice = typeof m.pricePer1kIn === 'number' ? m.pricePer1kIn : 0;
  const outPrice = typeof m.pricePer1kOut === 'number' ? m.pricePer1kOut : 0;
  return (promptLen / 1000) * inPrice + (outputLen / 1000) * outPrice;
}

export function errClassOf(stderr: string, exitCode: number): ErrorClass {
  if (exitCode === 124) return 'timeout';
  const s = (stderr || '').toLowerCase();
  if (/provider|api|connection|network|timeout|econnreset|econnrefused|unreachable|rate.?limit|429|503|502/.test(s)) {
    return 'provider_down';
  }
  if (/invalid|error:|failed|exception/.test(s)) return 'logic_error';
  return 'unknown';
}

// ── budget ──

export interface BudgetCheck {
  allowed: boolean;
  reason: string;
}

export function checkBudget(budget: AutopilotBudget, model: string): BudgetCheck {
  const runs = readTelemetry();
  const runsToday = todayRuns(runs);
  const maxRuns = budget.maxRunsPerDay ?? 50;
  if (runsToday >= maxRuns) return { allowed: false, reason: `今日运行次数已达上限 (${runsToday}/${maxRuns})` };
  const maxCost = budget.maxCostPerDay ?? 0;
  if (maxCost > 0) {
    const costToday = todayCost(runs);
    if (costToday >= maxCost) return { allowed: false, reason: `今日估算成本已达上限 ($${costToday.toFixed(4)}/$${maxCost})` };
  }
  if (Array.isArray(budget.allowedModels) && budget.allowedModels.length > 0) {
    const allowed = budget.allowedModels.some((m) => model === m || model.endsWith(`/${m}`));
    if (!allowed) return { allowed: false, reason: `模型 ${model} 不在允许列表中` };
  }
  return { allowed: true, reason: '' };
}

export function formatBudgetUsage(runs: TelemetryEntry[]): string {
  const today = localDay(new Date());
  const todays = runs.filter((r) => localDay(r.ts) === today);
  const cost = todays.reduce((s, r) => s + (r.estCost || 0), 0);
  return `今日: ${todays.length} 次运行, 估算成本 $${cost.toFixed(4)}`;
}

// ── failover ──

export function currentModelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function selectFailover(chain: FallbackModel[], currentProvider: string, currentModel: string): FallbackModel | null {
  if (!chain.length) return null;
  const current = currentModelKey(currentProvider, currentModel);
  const candidates = chain.filter((f) => currentModelKey(f.provider, f.model) !== current);
  if (!candidates.length) return null;
  const byModel = new Map(statsByModel(readTelemetry()).map((s) => [currentModelKey(s.provider, s.model), s]));
  const scored = candidates.map((f) => {
    const key = currentModelKey(f.provider, f.model);
    const stats = byModel.get(key);
    const sameProvider = f.provider === currentProvider ? 1 : 0;
    const score = stats ? stats.successRate * 100 + sameProvider * 10 : 50 + sameProvider * 30;
    return { f, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].f;
}

export interface FailoverPlan {
  target: FallbackModel | null;
  reason: string;
}

export function planFailover(chain: FallbackModel[], currentProvider: string, currentModel: string): FailoverPlan {
  if (!chain.length) return { target: null, reason: '未配置 fallbackModels' };
  const target = selectFailover(chain, currentProvider, currentModel);
  if (!target) return { target: null, reason: 'fallbackModels 中无可用备选（全部为当前模型）' };
  return { target, reason: `${currentProvider}/${currentModel} → ${target.provider}/${target.model}` };
}

export function executeFailover(target: FallbackModel, reason: string, dryRun: boolean): string {
  if (dryRun) return `[dry-run] 将执行: 切换模型 ${target.provider}/${target.model} 并重启\n原因: ${reason}`;
  writeRestartRequest('set_model', {
    targetProvider: target.provider,
    targetModel: target.model,
    reason: `failover: ${reason}`,
  });
  return `正在切换模型 ${target.provider}/${target.model} 并重启...`;
}

// ── policy ──

export type PolicyAction =
  | { type: 'retry'; note: string }
  | { type: 'failover'; target: FallbackModel; note: string }
  | { type: 'suspend_task'; note: string }
  | { type: 'fail'; note: string };

export interface FailureInfo {
  stderr: string;
  exitCode: number;
  promptLen: number;
  outputLen: number;
  durationMs: number;
}

export function classifyError(stderr: string, exitCode: number): ErrorClass {
  return errClassOf(stderr, exitCode);
}

export function decide(
  task: Task,
  errClass: ErrorClass,
  policy: AutopilotPolicy,
  fallbackModels: FallbackModel[],
  info: FailureInfo,
): PolicyAction {
  const failoverAfter = policy.failoverAfter ?? 2;
  const suspendAfter = policy.suspendAfter ?? 5;
  const maxFailovers = policy.maxFailovers ?? 1;
  const failoverBlocked = (task.failoverCount ?? 0) >= maxFailovers;
  const circuitBreak: PolicyAction = {
    type: 'suspend_task',
    note: `failover 熔断：连续切换模型已达上限 ${maxFailovers}`,
  };

  if (/401|403|unauthorized|invalid api key|authentication/i.test(info.stderr)) {
    return { type: 'fail', note: `鉴权错误（不重试，请检查 provider 凭证）: ${info.stderr.slice(0, 150)}` };
  }
  if (errClass === 'logic_error') return { type: 'fail', note: `逻辑错误: ${info.stderr.slice(0, 200)}` };

  if (errClass === 'timeout') {
    if (task.failCount < (task.retries || 0)) return { type: 'retry', note: `超时，按重试计划执行` };
    if (fallbackModels.length > 0) {
      if (failoverBlocked) return circuitBreak;
      return { type: 'failover', target: fallbackModels[0], note: '超时且重试耗尽，切换模型尝试' };
    }
    return { type: 'fail', note: `超时（${Math.round(info.durationMs / 1000)}s）` };
  }

  if (errClass === 'provider_down') {
    if (task.failCount >= failoverAfter) {
      if (fallbackModels.length > 0) {
        if (failoverBlocked) return circuitBreak;
        return { type: 'failover', target: fallbackModels[0], note: `连续 ${task.failCount} 次 provider 故障，切换模型` };
      }
      return { type: 'fail', note: 'provider 故障且未配置 fallbackModels' };
    }
    if (task.failCount < (task.retries || 0)) return { type: 'retry', note: `provider 故障第 ${task.failCount} 次，重试` };
    return { type: 'fail', note: `provider 故障，重试额度已用尽` };
  }

  if (task.failCount >= suspendAfter) {
    return { type: 'suspend_task', note: `连续失败 ${task.failCount} 次（>= suspendAfter ${suspendAfter}），暂停任务` };
  }
  if (fallbackModels.length > 0 && task.failCount >= failoverAfter) {
    if (failoverBlocked) return circuitBreak;
    return { type: 'failover', target: fallbackModels[0], note: `连续失败 ${task.failCount} 次，切换模型` };
  }
  return { type: 'fail', note: `未知错误: ${info.stderr.slice(0, 200)}` };
}

export function currentModel(): { provider: string; model: string } {
  const s = readSettings();
  return { provider: s.defaultProvider || 'unknown', model: s.defaultModel || 'unknown' };
}

const LOCAL_HINTS = /ollama|vllm|llamacpp|lmstudio|\blocal\b|本地|localhost|127\.0\.0\.1/i;
export function isLocalModel(): boolean {
  const { provider, model } = currentModel();
  return LOCAL_HINTS.test(provider) || LOCAL_HINTS.test(model);
}

/** 任务总数/启用数/暂停状态（供 /auto status） */
export function schedulerOverview(): { total: number; enabled: number; paused: boolean } {
  const store = readTasks();
  const tasks = store.tasks.filter((t) => !t.deleted);
  return { total: tasks.length, enabled: tasks.filter((t) => t.enabled).length, paused: store.settings.paused === true };
}
