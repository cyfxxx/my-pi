/**
 * Intervention Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责干预机制
 */

export interface InterventionConfig {
  enabled: boolean;
  maxRetries: number;
  timeout: number;
}

// ── 干预管理 ──

export function createInterventionConfig(): InterventionConfig {
  return {
    enabled: true,
    maxRetries: 3,
    timeout: 30000,
  };
}

export function shouldIntervene(error: Error, retryCount: number, config: InterventionConfig): boolean {
  if (!config.enabled) return false;
  if (retryCount >= config.maxRetries) return false;
  return true;
}

export function formatInterventionMessage(error: Error, retryCount: number): string {
  return `干预请求：发生错误 (${error.message})，重试次数: ${retryCount}`;
}