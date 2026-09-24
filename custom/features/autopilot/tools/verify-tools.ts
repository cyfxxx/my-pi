/**
 * verify_* —— LLM-as-a-Verifier 工具（verify_report / verify_config / verify_test）
 *
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/tools.ts`（verify_report 第 487 行起、
 * verify_config、verify_test）。纯逻辑零 Pi 依赖：统计聚合/配置读写/测试编排都可在
 * 单测中直接调用；`registerVerifyTools` 只通过 `adapters/tool-adapter` 注册。
 *
 * 说明：原项目 Best-of-N 的 LLM 集成未迁移（见 DECISIONS.md），故 verify_test 的
 * 候选生成/评审函数可注入；缺省用占位生成器 + fail-open，不实际调用 LLM。
 */

import { registerTool } from '../../../adapters/tool-adapter';
import { readAutopilotConfig, writeAutopilotConfig } from '../store/ops';
import { defaultVerifierConfig, type VerifierConfig } from '../types';
import { readVerifications, type VerificationRecord } from '../run/verifier-logger';
import { bestOfN, type CandidateScore } from '../run/verifier';

/** 注册函数参数类型从适配器推导，避免 features 直接 import Pi 包（隔离检查 #3） */
type PiApi = Parameters<typeof registerTool>[0];

// ── 配置读写 ──

/** 当前验证配置（未配置时返回默认：禁用） */
export function currentVerifierConfig(): VerifierConfig {
  return readAutopilotConfig().verifier ?? defaultVerifierConfig();
}

/** 应用配置补丁（钳制范围）并写回 autopilot config.json，返回生效配置 */
export function applyVerifierConfigPatch(patch: Record<string, unknown>): VerifierConfig {
  const config = readAutopilotConfig();
  const verifier: VerifierConfig = { ...(config.verifier ?? defaultVerifierConfig()) };

  if (typeof patch.enabled === 'boolean') verifier.enabled = patch.enabled;
  if (typeof patch.nCandidates === 'number' && Number.isFinite(patch.nCandidates)) {
    verifier.nCandidates = Math.min(5, Math.max(2, Math.round(patch.nCandidates)));
  }
  if (typeof patch.verifyAfter === 'number' && Number.isFinite(patch.verifyAfter)) {
    verifier.verifyAfter = Math.max(0, Math.floor(patch.verifyAfter));
  }
  if (typeof patch.threshold === 'number' && Number.isFinite(patch.threshold)) {
    verifier.threshold = Math.min(1, Math.max(0, patch.threshold));
  }
  if (patch.logLevel === 'none' || patch.logLevel === 'summary' || patch.logLevel === 'full') {
    verifier.logLevel = patch.logLevel;
  }

  writeAutopilotConfig({ ...config, verifier });
  return verifier;
}

/** 格式化验证配置块（verify_config 读取/更新共用） */
export function formatVerifierConfig(cfg: VerifierConfig, header = '验证配置'): string {
  return [
    `${header}:`,
    `  enabled: ${cfg.enabled}`,
    `  nCandidates: ${cfg.nCandidates}`,
    `  verifyAfter: ${cfg.verifyAfter}`,
    `  threshold: ${cfg.threshold}`,
    `  maxCostPerVerify: $${cfg.maxCostPerVerify}`,
    `  logLevel: ${cfg.logLevel}`,
  ].join('\n');
}

// ── 统计报告 ──

export interface VerifierReportStats {
  total: number;
  passRate: number;
  avgCostMultiplier: number;
  avgScoreImprovement: number;
  successRateWithVerification: number;
  successRateWithoutVerification: number;
  marginalGain: { n: number; count: number; avgGain: number }[];
  byTask: { name: string; count: number; passRate: number }[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

/** 聚合验证记录（纯函数）：通过率/成本倍数/边际收益/成功率对比/任务分布 */
export function computeVerifierReport(records: VerificationRecord[]): VerifierReportStats {
  if (records.length === 0) {
    return {
      total: 0,
      passRate: 0,
      avgCostMultiplier: 0,
      avgScoreImprovement: 0,
      successRateWithVerification: 0,
      successRateWithoutVerification: 0,
      marginalGain: [],
      byTask: [],
    };
  }

  const passRate = records.filter((r) => r.passed).length / records.length;
  const avgCostMultiplier = mean(records.map((r) => r.costMultiplier || 0));
  const avgScoreImprovement = mean(
    records.map((r) => (r.scores.length ? Math.max(...r.scores) - (r.scores[0] ?? 0) : 0)),
  );
  const successRateWithVerification = records.filter((r) => r.result === 'success').length / records.length;

  // 未验证基线：选中第一个候选的记录（selectedIndex=0）的成功率；无对照时以整体成功率表示
  const baseline = records.filter((r) => r.selectedIndex === 0);
  const successRateWithoutVerification = baseline.length
    ? baseline.filter((r) => r.result === 'success').length / baseline.length
    : successRateWithVerification;

  const byN = new Map<number, number[]>();
  for (const r of records) {
    if (r.scores.length < 2) continue;
    const gain = Math.max(...r.scores) - (r.scores[0] ?? 0);
    byN.set(r.nCandidates, [...(byN.get(r.nCandidates) ?? []), gain]);
  }
  const marginalGain = [...byN.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, gains]) => ({ n, count: gains.length, avgGain: mean(gains) }));

  const byTaskMap = new Map<string, { count: number; passed: number }>();
  for (const r of records) {
    const name = r.taskName || r.taskId;
    const entry = byTaskMap.get(name) ?? { count: 0, passed: 0 };
    entry.count++;
    if (r.passed) entry.passed++;
    byTaskMap.set(name, entry);
  }
  const byTask = [...byTaskMap.entries()]
    .map(([name, e]) => ({ name, count: e.count, passRate: e.passed / e.count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: records.length,
    passRate,
    avgCostMultiplier,
    avgScoreImprovement,
    successRateWithVerification,
    successRateWithoutVerification,
    marginalGain,
    byTask,
  };
}

/** 格式化报告（对齐 pi-tools formatReport 输出） */
export function formatVerifierReport(stats: VerifierReportStats): string {
  if (stats.total === 0) return '验证统计：暂无数据';

  const lines: string[] = [
    '─── LLM-as-a-Verifier 验证统计 ───',
    `总验证次数: ${stats.total}`,
    `通过率: ${Math.round(stats.passRate * 100)}%`,
    `平均成本倍数: ${stats.avgCostMultiplier.toFixed(1)}x`,
    `平均分数提升: +${(stats.avgScoreImprovement * 100).toFixed(1)}%`,
    '',
    '成功率对比:',
    `  启用验证: ${Math.round(stats.successRateWithVerification * 100)}%`,
    `  未验证基线: ${Math.round(stats.successRateWithoutVerification * 100)}%`,
    `  提升: +${Math.round((stats.successRateWithVerification - stats.successRateWithoutVerification) * 100)}%`,
  ];

  if (stats.marginalGain.length > 0) {
    lines.push('', '边际收益（候选数 vs 平均增益）:');
    for (const mg of stats.marginalGain) {
      lines.push(`  N=${mg.n}: +${(mg.avgGain * 100).toFixed(1)}% (${mg.count} 次)`);
    }
  }

  const topTasks = stats.byTask.slice(0, 5);
  if (topTasks.length > 0) {
    lines.push('', '按任务（Top 5）:');
    for (const t of topTasks) {
      lines.push(`  ${t.name}: ${t.count} 次, 通过率 ${Math.round(t.passRate * 100)}%`);
    }
  }

  return lines.join('\n');
}

/** verify_report 主逻辑：读取落盘记录并汇总 */
export function buildVerifierReport(): string {
  return formatVerifierReport(computeVerifierReport(readVerifications()));
}

// ── 手动验证测试 ──

export interface VerifyTestDeps {
  /** 候选生成函数；缺省为占位实现（与 pi-tools 原工具一致，不实际调用 LLM） */
  generate?: (prompt: string) => Promise<string>;
  /** 评审函数；不提供时 bestOfN fail-open 回退首个候选 */
  judge?: (prompt: string, candidates: string[]) => Promise<CandidateScore[]>;
}

/** 占位候选生成器（pi-tools verify_test 原实现） */
export function defaultCandidateGenerator(prompt: string): Promise<string> {
  return Promise.resolve(`[候选测试: ${prompt.slice(0, 30)}...]`);
}

/** verify_test 主逻辑：Best-of-N 执行一次并格式化候选评分 */
export async function runVerifyTest(
  prompt: string,
  nCandidates: number | undefined,
  deps: VerifyTestDeps = {},
  config: VerifierConfig = currentVerifierConfig(),
): Promise<string> {
  if (!config.enabled) {
    return '验证功能未启用。使用 verify_config(enabled=true) 启用。';
  }

  const requested = nCandidates ?? config.nCandidates;
  const n = Number.isFinite(requested) ? Math.min(5, Math.max(2, Math.round(requested))) : 3;
  const result = await bestOfN(
    deps.generate ?? defaultCandidateGenerator,
    prompt,
    { ...config, nCandidates: n },
    {},
    deps.judge,
  );

  const lines: string[] = [
    '─── Best-of-N 验证测试 ───',
    `提示词: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`,
    `候选数: ${n}`,
    `通过: ${result.passed ? '是' : '否'} (阈值: ${config.threshold})`,
    `耗时: ${result.durationMs}ms`,
    '',
    '候选评分:',
  ];
  for (const s of result.scores) {
    const marker = s.index === result.bestIndex ? ' ← 最优' : '';
    lines.push(`  候选 ${s.index + 1}: ${(s.score * 100).toFixed(1)}%${marker}`);
    if (s.reasoning) lines.push(`    ${s.reasoning}`);
  }
  lines.push(`\n结论: ${result.reasoning}`);
  return lines.join('\n');
}

// ── 注册 ──

/** 向 Pi 注册 verify_report / verify_config / verify_test */
export function registerVerifyTools(pi: PiApi): void {
  registerTool(pi, {
    name: 'verify_report',
    description: '查看 LLM-as-a-Verifier 验证功能的统计数据：通过率、成本倍数、边际收益、成功率对比。',
    parameters: {},
    execute: async () => buildVerifierReport(),
  });

  registerTool(pi, {
    name: 'verify_config',
    description: '查看或修改 LLM-as-a-Verifier 验证配置。不传参数时返回当前配置。',
    parameters: {
      enabled: { type: 'boolean', description: '启用/禁用验证', optional: true },
      nCandidates: { type: 'number', description: '候选数量（2-5）', optional: true },
      verifyAfter: { type: 'number', description: '失败 N 次后启用验证', optional: true },
      threshold: { type: 'number', description: '最低通过分数（0-1）', optional: true },
      logLevel: { type: 'string', enum: ['none', 'summary', 'full'], description: '日志级别', optional: true },
    },
    execute: async (args) => {
      if (Object.keys(args).length === 0) return formatVerifierConfig(currentVerifierConfig());
      return formatVerifierConfig(applyVerifierConfigPatch(args), '已更新验证配置');
    },
  });

  registerTool(pi, {
    name: 'verify_test',
    description: '对指定提示词执行一次 Best-of-N 验证测试，展示各候选评分。仅测试不调度。',
    parameters: {
      prompt: { type: 'string', description: '要测试的提示词' },
      nCandidates: { type: 'number', description: '候选数量（默认 3，范围 2-5）', optional: true },
    },
    execute: async (args) => {
      const prompt = typeof args.prompt === 'string' ? args.prompt : '';
      if (!prompt) return '缺少参数: prompt';
      const n = typeof args.nCandidates === 'number' && Number.isFinite(args.nCandidates) ? args.nCandidates : undefined;
      return runVerifyTest(prompt, n);
    },
  });
}
