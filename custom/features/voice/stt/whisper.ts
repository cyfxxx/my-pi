/**
 * Voice Feature — whisper 服务健康查询（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/whisper.ts`。
 *
 * `/health` 结果带短 TTL 内存缓存（成功与失败都缓存），
 * 使 `/voice doctor` 的 model/device/status 三次查询只发一次请求（最坏 9s → 最坏 3s + 缓存命中）。
 */

import type { VoiceConfig } from '../config';

interface WhisperHealth {
  ok?: boolean;
  model?: string;
  device?: string;
}

type HealthOutcome = { ok: true; data: WhisperHealth } | { ok: false };

interface HealthCacheEntry {
  startedAt: number;
  outcome: Promise<HealthOutcome>;
}

/** /health 缓存 TTL：覆盖 doctor/status 的连续查询，又不至于让状态长时间失真。 */
const HEALTH_TTL_MS = 2500;

/** key 含端点与 token：不同目标/凭据不互相污染。 */
const healthCache = new Map<string, HealthCacheEntry>();

function headersOf(cfg: VoiceConfig): Record<string, string> {
  return cfg.whisperToken ? { Authorization: `Bearer ${cfg.whisperToken}` } : {};
}

function cacheKeyOf(cfg: VoiceConfig): string {
  return `${cfg.whisperEndpoint}\n${cfg.whisperToken ?? ''}`;
}

/** 单次探测；网络错误/JSON 解析失败统一视为失败（与旧行为一致）。 */
async function fetchHealth(cfg: VoiceConfig): Promise<HealthOutcome> {
  try {
    const res = await fetch(`${cfg.whisperEndpoint}/health`, { headers: headersOf(cfg), signal: AbortSignal.timeout(3000) });
    return { ok: true, data: (await res.json()) as WhisperHealth };
  } catch {
    return { ok: false };
  }
}

/** 取缓存中的探测结果；TTL 内复用（并行调用也去重），过期后重新探测。 */
function probeHealth(cfg: VoiceConfig): Promise<HealthOutcome> {
  const key = cacheKeyOf(cfg);
  const now = Date.now();
  const hit = healthCache.get(key);
  if (hit && now - hit.startedAt < HEALTH_TTL_MS) return hit.outcome;
  for (const [k, v] of healthCache) {
    if (now - v.startedAt >= HEALTH_TTL_MS) healthCache.delete(k);
  }
  const outcome = fetchHealth(cfg);
  healthCache.set(key, { startedAt: now, outcome });
  return outcome;
}

/** 清空缓存（测试用，确保用例互不影响）。 */
export function resetWhisperHealthCache(): void {
  healthCache.clear();
}

export async function whisperModel(cfg: VoiceConfig): Promise<string | null> {
  const outcome = await probeHealth(cfg);
  if (!outcome.ok) return null;
  return outcome.data.ok ? outcome.data.model ?? null : null;
}

export async function whisperDevice(cfg: VoiceConfig): Promise<string | null> {
  const outcome = await probeHealth(cfg);
  if (!outcome.ok) return null;
  return outcome.data.device ?? null;
}

export async function whisperStatus(cfg: VoiceConfig): Promise<string> {
  const outcome = await probeHealth(cfg);
  if (!outcome.ok) return '不可达（运行 pi-whisper.sh start）';
  return outcome.data.ok ? '运行中' : '启动中';
}
