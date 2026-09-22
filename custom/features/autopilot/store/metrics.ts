/**
 * Autopilot Feature — 度量仪表盘（纯逻辑，零 Pi 依赖）
 *
 * 汇总 VISION §2 三大判据为可对比数字：干预率、token 成本、缓存命中率（+任务成功率）。
 * 以数据文件读取方式聚合（新增干预快照 / 用量统计 / autopilot 遥测），不改动各 feature 代码。
 */

import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';
import { readJSONL, readJSONOr } from '../../../core/fs-json';
import { localDay } from '../../../core/text';

interface InterventionLike {
  ts?: string;
  correctivePrompt?: string | null;
}
interface UsageLike {
  ts?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  outputTokens?: number;
}
interface TelemetryLike {
  ts?: string;
  result?: 'success' | 'failed';
}

export interface MetricsDashboard {
  interventions: { total: number; corrected: number; linkRate: number; last7d: number };
  usage: { todayCount: number; todayInput: number; todayOutput: number; cacheHitRate: number };
  tasks: { runs: number; successRate: number };
  generatedAt: string;
}

export function collectMetrics(memoryDir: string = getMemoryDir(), now: number = Date.now()): MetricsDashboard {
  const interventions = readJSONL<InterventionLike>(join(memoryDir, 'interventions.jsonl'));
  const usage = readJSONL<UsageLike>(join(memoryDir, 'context', 'usage.jsonl'));
  const telemetryData = readJSONOr<{ runs?: TelemetryLike[] }>(join(memoryDir, 'scheduler', 'telemetry.json'), {});
  const telemetry: TelemetryLike[] = Array.isArray(telemetryData.runs) ? telemetryData.runs : [];

  const weekAgo = now - 7 * 24 * 3600_000;
  const totalInterventions = interventions.length;
  const corrected = interventions.filter((i) => i.correctivePrompt).length;
  const last7d = interventions.filter((i) => {
    const t = new Date(i.ts ?? 0).getTime();
    return Number.isFinite(t) && t >= weekAgo;
  }).length;

  const today = localDay(new Date(now));
  let todayCount = 0;
  let todayInput = 0;
  let todayOutput = 0;
  let cacheRead = 0;
  for (const u of usage) {
    if (localDay(u.ts ?? 0) !== today) continue;
    todayCount++;
    todayInput += u.input ?? 0;
    todayOutput += u.output ?? u.outputTokens ?? 0;
    cacheRead += u.cacheRead ?? 0;
  }

  const runs = telemetry.length;
  const successes = telemetry.filter((t) => t.result === 'success').length;

  return {
    interventions: {
      total: totalInterventions,
      corrected,
      linkRate: totalInterventions ? corrected / totalInterventions : 0,
      last7d,
    },
    usage: {
      todayCount,
      todayInput,
      todayOutput,
      cacheHitRate: todayInput + cacheRead > 0 ? cacheRead / (todayInput + cacheRead) : 0,
    },
    tasks: { runs, successRate: runs ? successes / runs : 0 },
    generatedAt: new Date(now).toISOString(),
  };
}

export function formatMetrics(d: MetricsDashboard): string {
  return [
    '度量仪表盘（VISION §2）:',
    `  干预: 快照 ${d.interventions.total}（已关联纠正 ${d.interventions.corrected}，关联率 ${(d.interventions.linkRate * 100).toFixed(0)}%），近 7 天 ${d.interventions.last7d}`,
    `  成本: 今日工具调用 ${d.usage.todayCount} 次，输入 ${d.usage.todayInput.toLocaleString()} tok / 输出 ${d.usage.todayOutput.toLocaleString()} tok`,
    `  缓存: 今日命中率 ${(d.usage.cacheHitRate * 100).toFixed(1)}%`,
    `  任务: 运行 ${d.tasks.runs} 次，成功率 ${(d.tasks.successRate * 100).toFixed(0)}%`,
    `  生成: ${d.generatedAt}`,
  ].join('\n');
}
