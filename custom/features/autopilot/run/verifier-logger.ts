/**
 * Autopilot Feature — 验证器记录与聚合（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/verifier-logger.ts`。
 * 落盘：portable/memory/scheduler/verifier.jsonl + verifier-summary.json。
 */

import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';
import { writeJSONSync } from '../../../core/atomic-write';
import { appendJSONLRotating, readJSONL } from '../../../core/fs-json';

export interface VerificationRecord {
  ts: string;
  epoch: number;
  taskId: string;
  taskName: string;
  nCandidates: number;
  selectedIndex: number;
  scores: number[];
  durationMs: number;
  estCost: number;
  baselineCost: number;
  costMultiplier: number;
  passed: boolean;
  reasoning: string;
  result: 'success' | 'failed';
  judgeModel: string;
  progressScores?: number[];
}

export interface VerifierSummary {
  lastUpdated: string;
  totalVerifications: number;
  passRate: number;
  avgCostMultiplier: number;
  byTaskType: Record<string, { count: number; passRate: number; avgCost: number }>;
  marginalGain: Array<{ n: number; count: number; avgGain: number }>;
  successRateWithVerification: number;
  successRateWithoutVerification: number;
}

const MAX_SIZE = 4 * 1024 * 1024;

function statsDir(): string {
  return join(getMemoryDir(), 'scheduler');
}
export function verifierLogPath(): string {
  return join(statsDir(), 'verifier.jsonl');
}
export function verifierSummaryPath(): string {
  return join(statsDir(), 'verifier-summary.json');
}

export function logVerification(record: VerificationRecord): void {
  try {
    appendJSONLRotating(verifierLogPath(), record, MAX_SIZE);
    writeJSONSync(verifierSummaryPath(), summarize(readVerifications()));
  } catch {
    /* fail-open */
  }
}

export function readVerifications(): VerificationRecord[] {
  return readJSONL<VerificationRecord>(verifierLogPath());
}

/** 聚合统计（纯函数，便于单测） */
export function summarize(records: VerificationRecord[]): VerifierSummary {
  const total = records.length;
  const passed = records.filter((r) => r.passed).length;
  const avgCostMultiplier = total ? records.reduce((s, r) => s + r.costMultiplier, 0) / total : 0;
  const successWith = total ? records.filter((r) => r.result === 'success').length / total : 0;

  const byTaskType: Record<string, { count: number; passRate: number; avgCost: number }> = {};
  for (const r of records) {
    const key = r.taskName.startsWith('plan') ? 'plan' : 'general';
    const b = byTaskType[key] ?? { count: 0, passRate: 0, avgCost: 0 };
    b.count++;
    b.passRate += r.passed ? 1 : 0;
    b.avgCost += r.estCost;
    byTaskType[key] = b;
  }
  for (const k of Object.keys(byTaskType)) {
    const b = byTaskType[k];
    if (b.count > 0) {
      b.passRate /= b.count;
      b.avgCost /= b.count;
    }
  }

  const byN = new Map<number, { count: number; gainSum: number }>();
  for (const r of records) {
    const best = r.scores.length ? Math.max(...r.scores) : 0;
    const mean = r.scores.length ? r.scores.reduce((s, x) => s + x, 0) / r.scores.length : 0;
    const entry = byN.get(r.nCandidates) ?? { count: 0, gainSum: 0 };
    entry.count++;
    entry.gainSum += best - mean;
    byN.set(r.nCandidates, entry);
  }
  const marginalGain = [...byN.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, v]) => ({ n, count: v.count, avgGain: v.count ? v.gainSum / v.count : 0 }));

  return {
    lastUpdated: new Date().toISOString(),
    totalVerifications: total,
    passRate: total ? passed / total : 0,
    avgCostMultiplier,
    byTaskType,
    marginalGain,
    successRateWithVerification: successWith,
    // 未验证基线不可得（无对照），以 0 表示未知
    successRateWithoutVerification: 0,
  };
}
