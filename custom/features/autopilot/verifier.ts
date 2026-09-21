/**
 * Autopilot Feature — LLM-as-a-Verifier 核心（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/verifier.ts`。
 * 生成/评分函数由调用方注入（LLM 集成在 scheduler 层）；此处提供纯逻辑与
 * ProgressTracker，便于测试。
 */

import type { VerifierConfig } from './types';
import { logVerification, type VerificationRecord } from './verifier-logger';

export interface CandidateScore {
  index: number;
  score: number;
  reasoning: string;
}

export interface VerificationResult {
  bestIndex: number;
  scores: CandidateScore[];
  passed: boolean;
  reasoning: string;
  durationMs: number;
  estCost: number;
}

export const DEFAULT_JUDGE_PROMPT = `你是一个任务执行方案的评审专家。请对以下 N 个候选方案进行评分，选出最优方案。

评分维度（各维度 0-1 分）：正确性、完整性、效率、安全性。

请为每个候选方案给出综合分数（0-1）与简短理由，最后选出最优方案。`;

/** 解析评审输出中的候选评分（容错；缺失项补 0.5） */
export function parseJudgeScores(text: string, n: number): CandidateScore[] {
  const scores: CandidateScore[] = [];
  for (let i = 0; i < n; i++) {
    const re = new RegExp(`候选\\s*${i + 1}\\s*[:：]\\s*分数\\s*[=＝]\\s*([0-9]*\\.?[0-9]+)`);
    const m = re.exec(text);
    const reasonMatch = new RegExp(`候选\\s*${i + 1}\\s*[:：][^\\n]*理由\\s*[=＝]\\s*([^\\n]*)`).exec(text);
    scores.push({
      index: i,
      score: m ? Math.max(0, Math.min(1, parseFloat(m[1]))) : 0.5,
      reasoning: reasonMatch ? reasonMatch[1].trim() : '',
    });
  }
  return scores;
}

export function selectBest(scores: CandidateScore[]): CandidateScore {
  return scores.reduce((a, b) => (a.score >= b.score ? a : b), scores[0] ?? { index: 0, score: 0, reasoning: '' });
}

/** 是否应启用 Best-of-N（失败次数达到 verifyAfter 且启用） */
export function shouldVerify(failCount: number, config: VerifierConfig): boolean {
  return config.enabled && failCount >= config.verifyAfter;
}

export interface ProgressStep {
  toolName: string;
  resultSummary: string;
  score: number;
  ts: number;
}

export class ProgressTracker {
  private steps: ProgressStep[] = [];
  private readonly threshold: number;
  constructor(threshold = 0.2) {
    this.threshold = threshold;
  }

  step(toolName: string, resultSummary: string): number {
    let score = 0.5;
    if (/success|完成|已创建|已更新/i.test(resultSummary)) score += 0.2;
    if (/error|失败|错误|异常/i.test(resultSummary)) score -= 0.3;
    if (/timeout|超时/i.test(resultSummary)) score -= 0.2;
    if (['bash', 'write', 'edit'].includes(toolName) && /rm|delete|remove/i.test(resultSummary)) score -= 0.1;
    score = Math.max(0, Math.min(1, score));
    this.steps.push({ toolName, resultSummary: resultSummary.slice(0, 200), score, ts: Date.now() });
    return this.currentScore();
  }

  currentScore(): number {
    if (this.steps.length === 0) return 0.5;
    let totalWeight = 0;
    let weightedSum = 0;
    for (let i = 0; i < this.steps.length; i++) {
      const weight = i + 1;
      weightedSum += this.steps[i].score * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  }

  shouldAbort(): boolean {
    return this.currentScore() < this.threshold;
  }
  getSteps(): ProgressStep[] {
    return [...this.steps];
  }
  getScoreSequence(): number[] {
    return this.steps.map((s) => s.score);
  }
  reset(): void {
    this.steps = [];
  }
}

export interface BestOfNOptions {
  nCandidates?: number;
  threshold?: number;
  judgeModel?: string;
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * Best-of-N：生成 N 候选 → 评分选优。生成与评分函数由调用方注入；
 * 未提供评分函数时 fail-open 回退首个候选。
 */
export async function bestOfN(
  generateFn: (prompt: string) => Promise<string>,
  prompt: string,
  config: VerifierConfig,
  options: BestOfNOptions = {},
  judgeFn?: (prompt: string, candidates: string[]) => Promise<CandidateScore[]>,
): Promise<VerificationResult> {
  const n = options.nCandidates ?? config.nCandidates;
  const threshold = options.threshold ?? config.threshold;
  const timeout = options.timeout ?? 30_000;
  const startTime = Date.now();
  const fallback = (reason: string): VerificationResult => ({
    bestIndex: 0,
    scores: [{ index: 0, score: 0.5, reasoning: reason }],
    passed: true,
    reasoning: reason,
    durationMs: Date.now() - startTime,
    estCost: 0,
  });

  try {
    const candidates = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        try {
          return await Promise.race([
            generateFn(prompt),
            new Promise<never>((_, reject) => {
              const t = setTimeout(() => reject(new Error(`候选 ${i} 生成超时`)), timeout);
              t.unref?.();
            }),
          ]);
        } catch (err) {
          return `[候选 ${i} 生成失败: ${(err as Error).message}]`;
        }
      }),
    );

    if (!judgeFn) return fallback('未提供评分函数，fail-open 回退');
    const scores = await judgeFn(prompt, candidates);
    const best = selectBest(scores);
    return {
      bestIndex: best.index,
      scores,
      passed: best.score >= threshold,
      reasoning: `最优候选: ${best.index + 1} (分数: ${best.score.toFixed(2)})`,
      durationMs: Date.now() - startTime,
      estCost: 0,
    };
  } catch (err) {
    console.error('[verifier] 验证失败，fail-open:', (err as Error).message);
    return fallback('验证器出错，fail-open 回退');
  }
}

export function recordVerification(
  result: VerificationResult,
  taskId: string,
  taskName: string,
  config: VerifierConfig,
  baselineCost: number,
  judgeModel: string,
  resultOutcome: 'success' | 'failed',
): void {
  if (config.logLevel === 'none') return;
  const record: VerificationRecord = {
    ts: new Date().toISOString(),
    epoch: Date.now(),
    taskId,
    taskName,
    nCandidates: result.scores.length,
    selectedIndex: result.bestIndex,
    scores: result.scores.map((s) => s.score),
    durationMs: result.durationMs,
    estCost: result.estCost,
    baselineCost,
    costMultiplier: baselineCost > 0 ? result.estCost / baselineCost : 0,
    passed: result.passed,
    reasoning: result.reasoning,
    result: resultOutcome,
    judgeModel,
  };
  logVerification(record);
}
