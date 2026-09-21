/**
 * Memory Feature — 运行环境检测（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-memory/env.ts`。
 * 记忆条目带 environments 标签（缺省 all），注入/检索按当前环境过滤。
 */

import { existsSync, readFileSync } from 'node:fs';

export const ENVIRONMENTS = ['all', 'termux', 'wsl2', 'linux', 'macos', 'windows'] as const;
export type RuntimeEnv = (typeof ENVIRONMENTS)[number];

let cached: RuntimeEnv | null = null;

export function detectEnvironment(): RuntimeEnv {
  if (cached) return cached;
  const override = process.env.PI_MEMORY_ENV;
  if (override && (ENVIRONMENTS as readonly string[]).includes(override)) {
    cached = override as RuntimeEnv;
    return cached;
  }
  try {
    if (existsSync('/storage/emulated/0')) {
      cached = 'termux';
      return cached;
    }
  } catch {
    /* 忽略权限错误 */
  }
  try {
    if (existsSync('/proc/version') && readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')) {
      cached = 'wsl2';
      return cached;
    }
  } catch {
    /* 忽略 */
  }
  if (process.platform === 'darwin') {
    cached = 'macos';
    return cached;
  }
  if (process.platform === 'win32') {
    cached = 'windows';
    return cached;
  }
  cached = 'linux';
  return cached;
}

export function resetEnvironmentCache(): void {
  cached = null;
}

/** 条目是否对当前环境可见：无 environments 视为 all；含 all 永远可见；否则须含当前环境 */
export function isEnvVisible(environments: string[] | undefined, current: RuntimeEnv): boolean {
  if (!environments || environments.length === 0) return true;
  if (environments.includes('all')) return true;
  return environments.includes(current);
}

export function formatEnvironments(environments: string[] | undefined): string {
  if (!environments || environments.length === 0) return '通用';
  return environments.join(',');
}
