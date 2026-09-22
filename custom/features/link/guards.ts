/**
 * Link Feature — 并发去重守卫（零 Pi 依赖，进程内存态）
 */

const inflight = new Map<string, boolean>();
const lastSends = new Map<string, { hash: string; ts: number }>();
export const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export function simpleHash(s: string): string {
  const str = s ?? '';
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function checkConcurrentAndDedup(deviceKey: string, message: string): { ok: boolean; detail?: string } {
  if (inflight.get(deviceKey)) return { ok: false, detail: '该设备已有进行中的调用，请等它完成后再发' };
  const hash = simpleHash(message);
  const prev = lastSends.get(deviceKey);
  if (prev && prev.hash === hash && Date.now() - prev.ts < DEDUP_WINDOW_MS) {
    const mins = Math.round((Date.now() - prev.ts) / 60000);
    return { ok: false, detail: `与 ${mins} 分钟前发送的完全相同消息，已去重` };
  }
  return { ok: true };
}

export function markSendStart(deviceKey: string): void {
  inflight.set(deviceKey, true);
}
export function markSendSuccess(deviceKey: string, message: string): void {
  lastSends.set(deviceKey, { hash: simpleHash(message), ts: Date.now() });
}
export function markSendEnd(deviceKey: string): void {
  inflight.delete(deviceKey);
}
export function resetSendGuards(): void {
  inflight.clear();
  lastSends.clear();
}
