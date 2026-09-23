/**
 * Context Budget — 输出速度（tokens/s）跟踪（纯逻辑，零 Pi 依赖）
 *
 * 回合开始计时；流式过程中按字符数估算实时速度；回合结束用真实 output token 结算。
 */

export interface SpeedTracker {
  startTurn(now: number): void;
  addOutputChars(chars: number): void;
  liveSpeed(now: number): number | null;
  finishTurn(outputTokens: number, now: number): number | null;
  elapsedMs(now: number): number;
}

export function estimateTokensFromChars(chars: number, charsPerToken = 4): number {
  if (!Number.isFinite(chars) || chars <= 0 || charsPerToken <= 0) return 0;
  return chars / charsPerToken;
}

export function formatSpeed(tps: number): string {
  if (!Number.isFinite(tps) || tps <= 0) return '0 tok/s';
  return tps < 10 ? `${tps.toFixed(1)} tok/s` : `${Math.round(tps)} tok/s`;
}

export function createSpeedTracker(charsPerToken = 4): SpeedTracker {
  let startedAt: number | null = null;
  let chars = 0;

  return {
    startTurn(now: number): void {
      startedAt = now;
      chars = 0;
    },
    addOutputChars(n: number): void {
      if (Number.isFinite(n) && n > 0) chars += n;
    },
    elapsedMs(now: number): number {
      return startedAt === null ? 0 : Math.max(0, now - startedAt);
    },
    liveSpeed(now: number): number | null {
      const ms = this.elapsedMs(now);
      if (startedAt === null || ms < 250) return null;
      const tps = estimateTokensFromChars(chars, charsPerToken) / (ms / 1000);
      return Number.isFinite(tps) && tps > 0 ? tps : null;
    },
    finishTurn(outputTokens: number, now: number): number | null {
      const ms = this.elapsedMs(now);
      if (startedAt === null || ms <= 0) return null;
      const tokens = Number.isFinite(outputTokens) && outputTokens > 0
        ? outputTokens
        : estimateTokensFromChars(chars, charsPerToken);
      if (tokens <= 0) return null;
      const tps = tokens / (ms / 1000);
      return Number.isFinite(tps) && tps > 0 ? tps : null;
    },
  };
}
