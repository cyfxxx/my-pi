/**
 * Voice Feature — whisper 服务健康查询（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/whisper.ts`。
 */

import type { VoiceConfig } from '../config';

function headersOf(cfg: VoiceConfig): Record<string, string> {
  return cfg.whisperToken ? { Authorization: `Bearer ${cfg.whisperToken}` } : {};
}

export async function whisperModel(cfg: VoiceConfig): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.whisperEndpoint}/health`, { headers: headersOf(cfg), signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as { ok?: boolean; model?: string };
    return data.ok ? data.model ?? null : null;
  } catch {
    return null;
  }
}

export async function whisperDevice(cfg: VoiceConfig): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.whisperEndpoint}/health`, { headers: headersOf(cfg), signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as { device?: string };
    return data.device ?? null;
  } catch {
    return null;
  }
}

export async function whisperStatus(cfg: VoiceConfig): Promise<string> {
  try {
    const res = await fetch(`${cfg.whisperEndpoint}/health`, { headers: headersOf(cfg), signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as { ok?: boolean };
    return data.ok ? '运行中' : '启动中';
  } catch {
    return '不可达（运行 pi-whisper.sh start）';
  }
}
