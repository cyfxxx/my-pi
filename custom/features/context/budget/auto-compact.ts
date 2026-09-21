/**
 * Auto-Compact — 按模型窗口比例的自动压缩阈值策略（含防抖）纯逻辑，零 Pi 依赖
 *
 * 迁移自 pi-tools `agent/services/token-budget/auto-compact.ts`。
 * pi 内置 shouldCompact 阈值 = contextWindow - reserveTokens，对 1M 窗口模型
 * 形同虚设；本模块按窗口比例给出合理阈值，由扩展在回合结束时判定并触发 ctx.compact()。
 */

export type CompactReason = 'under-threshold' | 'over-threshold' | 'cooldown' | 'no-window';

export interface CompactDecision {
  shouldCompact: boolean;
  threshold: number;
  contextTokens: number;
  reason: CompactReason;
}

export const LARGE_WINDOW_SIZE = 256_000;
export const LARGE_WINDOW_RATIO = 0.8;
export const SMALL_WINDOW_RATIO = 0.85;
export const DEFAULT_COOLDOWN_MS = 180_000;

export interface CompactThresholdOpts {
  largeWindowSize?: number;
  largeRatio?: number;
  smallRatio?: number;
  absoluteTokens?: number;
}

export function computeCompactThreshold(
  contextWindow: number,
  opts: CompactThresholdOpts = {},
): number | null {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  if (
    typeof opts.absoluteTokens === 'number' &&
    opts.absoluteTokens > 0 &&
    contextWindow > opts.absoluteTokens
  ) {
    return Math.floor(opts.absoluteTokens);
  }
  const lws = opts.largeWindowSize ?? LARGE_WINDOW_SIZE;
  const lr = opts.largeRatio ?? LARGE_WINDOW_RATIO;
  const sr = opts.smallRatio ?? SMALL_WINDOW_RATIO;
  const ratio = contextWindow > lws ? lr : sr;
  return Math.floor(contextWindow * ratio);
}

export interface CompactDecider {
  readonly cooldownMs: number;
  readonly lastCompactAt: number;
  decide(contextTokens: number, contextWindow: number, now?: number): CompactDecision;
  markCompact(now?: number): void;
}

export function makeCompactDecider(
  cooldownMs = DEFAULT_COOLDOWN_MS,
  opts: CompactThresholdOpts = {},
): CompactDecider {
  let lastCompactAt = 0;
  return {
    get cooldownMs() {
      return cooldownMs;
    },
    get lastCompactAt() {
      return lastCompactAt;
    },
    decide(contextTokens, contextWindow, now = Date.now()): CompactDecision {
      const threshold = computeCompactThreshold(contextWindow, opts);
      if (threshold === null) {
        return { shouldCompact: false, threshold: 0, contextTokens, reason: 'no-window' };
      }
      if (contextTokens <= threshold) {
        return { shouldCompact: false, threshold, contextTokens, reason: 'under-threshold' };
      }
      if (now - lastCompactAt < cooldownMs) {
        return { shouldCompact: false, threshold, contextTokens, reason: 'cooldown' };
      }
      return { shouldCompact: true, threshold, contextTokens, reason: 'over-threshold' };
    },
    markCompact(now = Date.now()): void {
      lastCompactAt = now;
    },
  };
}

export interface AutoContinueGate {
  readonly enabled: boolean;
  readonly armed: boolean;
  arm(): void;
  disarm(): void;
  shouldContinue(): boolean;
}

export function makeAutoContinueGate(enabled = true): AutoContinueGate {
  let armed = false;
  return {
    get enabled() {
      return enabled;
    },
    get armed() {
      return armed;
    },
    arm(): void {
      armed = enabled;
    },
    disarm(): void {
      armed = false;
    },
    shouldContinue(): boolean {
      if (!armed) return false;
      armed = false;
      return enabled;
    },
  };
}
