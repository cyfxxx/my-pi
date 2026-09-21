/**
 * Autopilot Feature — 类型与默认配置（纯类型，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/types.ts`（核心子集）。
 */

export type TaskType = 'interval' | 'cron' | 'once';
export type TaskResult = 'success' | 'failed' | null;
export type ErrorClass = 'timeout' | 'provider_down' | 'logic_error' | 'unknown';

export interface ExecHistoryEntry {
  time: string;
  result: 'success' | 'failed';
  output: string;
  durationMs?: number;
}

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  schedule: string;
  prompt: string;
  enabled: boolean;
  lastRun: string | null;
  lastResult: TaskResult;
  lastOutput: string;
  nextRun: string | null;
  useSubagent: boolean;
  notifyOnCompletion: boolean;
  notifyMain?: boolean;
  waitForUserOnLocal?: boolean;
  maxRunTime: number;
  runCount: number;
  history: ExecHistoryEntry[];
  tags: string[];
  retries: number;
  failCount: number;
  failoverCount?: number;
  pendingInject: boolean;
  recoveryCount?: number;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerSettings {
  mailTo?: string;
  webhookUrl?: string;
  defaultMaxRunTime?: number;
  paused?: boolean;
}

export interface TaskStore {
  version: number;
  settings: SchedulerSettings;
  tasks: Task[];
}

export interface FallbackModel {
  provider: string;
  model: string;
}

export interface AutopilotBudget {
  maxRunsPerDay?: number;
  maxCostPerDay?: number;
  allowedModels?: string[];
}

export interface AutopilotPolicy {
  failoverAfter?: number;
  suspendAfter?: number;
  timeoutFactor?: number;
  maxFailovers?: number;
  verifyAfter?: number;
}

export interface AutopilotConfig {
  enabled: boolean;
  fallbackModels: FallbackModel[];
  maxIdleMinutes: number;
  requeueOnRestart: boolean;
  budget: AutopilotBudget;
  policy: AutopilotPolicy;
}

export interface TelemetryEntry {
  ts: string;
  taskId: string;
  taskName: string;
  model: string;
  provider: string;
  result: 'success' | 'failed';
  durationMs: number;
  outputLen: number;
  estCost: number;
  errClass: ErrorClass | null;
}

export interface VerifierConfig {
  enabled: boolean;
  nCandidates: number;
  verifyAfter: number;
  threshold: number;
  maxCostPerVerify: number;
  logLevel: 'none' | 'summary' | 'full';
  judgePrompt?: string;
}

export function defaultVerifierConfig(): VerifierConfig {
  return { enabled: false, nCandidates: 3, verifyAfter: 1, threshold: 0.6, maxCostPerVerify: 0.01, logLevel: 'summary' };
}

export const STORE_VERSION = 3;
export const DEFAULT_MAX_RUN_TIME = 300;
export const RETRY_BASE_DELAY_MS = 30000;
export const RETRY_MAX_DELAY_MS = 300000;
export const HISTORY_LIMIT = 10;
export const TELEMETRY_LIMIT = 1000;

export function defaultAutopilotConfig(): AutopilotConfig {
  return {
    enabled: true,
    fallbackModels: [],
    maxIdleMinutes: 180,
    requeueOnRestart: true,
    budget: { maxRunsPerDay: 50, maxCostPerDay: 0 },
    policy: { failoverAfter: 2, suspendAfter: 5, timeoutFactor: 2 },
  };
}
