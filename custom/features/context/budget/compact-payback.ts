/**
 * 压缩的"回本"估算（P2，见 `docs/design/SOL-PI-BORROW.md`）
 *
 * 借鉴 SoL-Pi 的 Online Context Compact：**压缩是一次前缀重写**，所以它的触发时钟不该只是
 * "上下文压力"，还要看**预期的未来节省能否还清重写成本**。
 *
 * 我们自己实测过重写有多贵：被中断那次会话 259,833 未命中里 **60.8% 只来自 2 次 system 段翻转**
 * （147,555 + 10,308）。也就是说"压一下"这个动作本身的代价，比它省下的那点上下文更值得先算清楚。
 *
 * **本模块只算，不决策**（P2 的边界：只观察、不改默认阈值）。它给出"还要几轮才回本"这个
 * **与剩余轮次无关的客观数**，让调用方把它记进日志；是否据此接管压缩阈值，留给拿到真实数据之后。
 *
 * 成本模型（显式写出，便于以后修正）：
 *   · 每轮省下 = 当前上下文 − 压缩后上下文（用摘要占比估计）
 *   · 重写成本 = 生成摘要那次请求要把整段读一遍（按未命中计价）
 *              + 压缩使整段前缀失效、下一次请求按未命中重读一遍
 *              = contextTokens × (1 + missPremium)
 *   · missPremium 默认 49（DeepSeek 命中价约为未命中的 1/50 ⇒ 未命中相对命中贵 49 倍）
 * 这个模型**偏保守**（把重写成本算高），因此它说"值得压"时可信度更高。
 */

/** 未命中相对命中的价格倍率减一（默认按命中价为未命中的 1/50 计） */
export const DEFAULT_MISS_PREMIUM = 49;
/** 摘要相对原上下文的占比估计（pi 的压缩目标未知，故取可配置的保守估计并在日志里记录） */
export const DEFAULT_SUMMARY_RATIO = 0.16;

export interface PaybackInput {
  /** 当前上下文 token 数 */
  contextTokens: number;
  /** 模型窗口大小 */
  contextWindow: number;
  /** 现有的强制触发比（沿用 `auto-compact.ts` 的 0.8/0.85，不在这里改它） */
  forcedRatio: number;
  /** 预估摘要占原上下文的比（默认 0.16） */
  summaryRatio?: number;
  /** 未命中溢价（默认 49） */
  missPremium?: number;
  /** 已知的剩余轮次估计；不传则 verdict 为 `unknown`（**不做猜测**） */
  remainingTurns?: number;
}

export type PaybackTrigger = 'none' | 'forced';
export type PaybackVerdict = 'forced' | 'payback-ok' | 'premature' | 'not-worth' | 'unknown';

export interface PaybackResult {
  trigger: PaybackTrigger;
  /** 每轮省下的 token */
  savedPerTurn: number;
  /** 重写成本（token 当量，含缓存溢价） */
  rewriteCostTokens: number;
  /** 还要几轮才回本；`null` = 省不下东西、永远不会回本 */
  paybackTurns: number | null;
  verdict: PaybackVerdict;
  reason: string;
}

function positive(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function estimateCompactPayback(input: PaybackInput): PaybackResult {
  const contextTokens = Math.max(0, Math.floor(positive(input.contextTokens, 0)));
  const contextWindow = Math.max(1, Math.floor(positive(input.contextWindow, 1)));
  const forcedRatio = positive(input.forcedRatio, 0.8);
  const summaryRatio = Math.min(0.95, positive(input.summaryRatio, DEFAULT_SUMMARY_RATIO));
  // 注意：`missPremium` 合法值为 0，所以不能用"必须 > 0"的 positive()；
  // 但 NaN 必须挡住——否则 NaN 会一路污染 rewriteCostTokens 与 paybackTurns
  // （测试抓到的真实缺陷：`Number.isFinite(paybackTurns)` 变 false）。
  const rawPremium = input.missPremium;
  const missPremium =
    typeof rawPremium === 'number' && Number.isFinite(rawPremium)
      ? Math.max(0, rawPremium)
      : DEFAULT_MISS_PREMIUM;

  const summaryTokens = Math.floor(contextTokens * summaryRatio);
  const savedPerTurn = Math.max(0, contextTokens - summaryTokens);
  // 见文件头：生成摘要读一遍 + 压缩后整段前缀失效重读一遍
  const rewriteCostTokens = Math.round(contextTokens * (1 + missPremium));
  const trigger: PaybackTrigger = contextTokens >= contextWindow * forcedRatio ? 'forced' : 'none';

  const paybackTurns = savedPerTurn > 0 ? Math.ceil(rewriteCostTokens / savedPerTurn) : null;

  let verdict: PaybackVerdict;
  let reason: string;
  if (trigger === 'forced') {
    verdict = 'forced';
    reason = `上下文已达强制线（${(forcedRatio * 100).toFixed(0)}% 窗口），即使回本要 ${paybackTurns ?? '∞'} 轮也必须压`;
  } else if (paybackTurns === null) {
    verdict = 'not-worth';
    reason = '压缩后上下文不会变小（摘要比原上下文还大或相等），永远不回本';
  } else if (input.remainingTurns === undefined) {
    verdict = 'unknown';
    reason = `回本需要约 ${paybackTurns} 轮；未提供剩余轮次估计，故不判定（本模块不做猜测）`;
  } else if (paybackTurns <= input.remainingTurns) {
    verdict = 'payback-ok';
    reason = `回本约 ${paybackTurns} 轮 ≤ 估计剩余 ${input.remainingTurns} 轮，值得压`;
  } else {
    verdict = 'premature';
    reason = `回本约 ${paybackTurns} 轮 > 估计剩余 ${input.remainingTurns} 轮，压了是亏的`;
  }

  return { trigger, savedPerTurn, rewriteCostTokens, paybackTurns, verdict, reason };
}

/** 一行给日志/日报看的摘要 */
export function formatPayback(r: PaybackResult): string {
  const p = r.paybackTurns === null ? '∞' : String(r.paybackTurns);
  return `${r.verdict}(回本${p}轮/省${r.savedPerTurn}/成本${r.rewriteCostTokens})`;
}
