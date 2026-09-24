/**
 * 调度任务完成通知（webhook）
 *
 * 迁移自 pi-tools `pi-autopilot/storage.ts` 的 `sendWebhook`。URL 取 `PI_SCHEDULER_WEBHOOK`
 * 环境变量，其次 autopilot 配置里的 `webhookUrl`；未配置则不发送。发送失败静默
 * （通知失败不影响调度本身），超时 10s。
 */

import type { Task } from '../types';
import { getSettings } from './storage';

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_OUTPUT_MAX = 1000;

/** 解析 webhook 目标地址（env 优先于配置） */
export function resolveWebhookUrl(): string {
  const env = process.env.PI_SCHEDULER_WEBHOOK;
  if (env) return env;
  try {
    return getSettings().webhookUrl ?? '';
  } catch {
    return '';
  }
}

export interface WebhookPayload {
  task: string;
  type: string;
  schedule?: string;
  result: string;
  time: string;
  output: string;
}

/** 构造通知体（output 截断到 WEBHOOK_OUTPUT_MAX） */
export function buildWebhookPayload(
  task: Pick<Task, 'name' | 'type' | 'schedule'>,
  result: string,
  output: string,
  now: Date = new Date(),
): WebhookPayload {
  return {
    task: task.name,
    type: task.type,
    schedule: task.schedule,
    result,
    time: now.toISOString(),
    output: (output || '').slice(0, WEBHOOK_OUTPUT_MAX),
  };
}

/** 发送完成通知；返回是否实际发送成功（未配置 URL / 失败均返回 false） */
export async function sendWebhook(
  task: Pick<Task, 'name' | 'type' | 'schedule'>,
  result: string,
  output: string,
): Promise<boolean> {
  const url = resolveWebhookUrl();
  if (!url) return false;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildWebhookPayload(task, result, output)),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}
