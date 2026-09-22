/**
 * web-search 配置解析（端点/超时）：环境变量 > settings.json > 默认。
 * 与 pi-tools 的 `pi-web-search/config.ts` 同口径（settings.json 的
 * `pi-web-search` 段，兼容旧 `pi-web-toolkit`）。
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getAgentDir } from '../../core/config';

/** 本地 SearXNG 默认端点（见 scripts/searxng-config.sh / setup-external.sh web）。 */
export const DEFAULT_SEARXNG_URL = 'http://127.0.0.1:8889';
/** 默认搜索超时：本地 SearXNG 多引擎聚合常需 10s+，沿用 pi-tools 的 30s 口径。 */
export const DEFAULT_SEARCH_TIMEOUT = 30000;
/** 共享 HTTP 超时常量（fetch_url / Bing 直搜默认）。 */
export const HTTP_TIMEOUT_MS = DEFAULT_SEARCH_TIMEOUT;

/** 读取 settings.json 中 pi-web-search（兼容旧 pi-web-toolkit）配置段。 */
function readSettingsSections(): Record<string, unknown>[] {
  const paths = [join(getAgentDir(), 'settings.json'), join(process.cwd(), '.pi', 'settings.json')];
  const out: Record<string, unknown>[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
      const ext = raw?.extensions as Record<string, unknown> | undefined;
      for (const key of ['pi-web-search', 'pi-web-toolkit']) {
        const s = (ext?.[key] ?? raw?.[key]) as Record<string, unknown> | undefined;
        if (s && typeof s === 'object') out.push(s);
      }
    } catch {
      /* 忽略坏配置 */
    }
  }
  return out;
}

/**
 * 解析 SearXNG 端点：环境变量 > settings.json（parity 原项目）> 默认本地端点。
 * 未显式配置时返回 null（调用方使用 DEFAULT_SEARXNG_URL）。
 */
export function resolveSearxngUrl(): string | null {
  const env = process.env.SEARXNG_URL || process.env.PI_WEB_TOOLKIT_SEARXNG_URL;
  if (env) return env;
  for (const s of readSettingsSections()) {
    const url = s.searxng_url;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return null;
}

/** 解析搜索超时：环境变量 > settings.json > 默认 30s（原项目同一口径）。 */
export function resolveSearchTimeout(): number {
  const env = Number(process.env.PI_WEB_TOOLKIT_SEARCH_TIMEOUT);
  if (Number.isFinite(env) && env > 0) return env;
  for (const s of readSettingsSections()) {
    const v = Number(s.search_timeout);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return DEFAULT_SEARCH_TIMEOUT;
}
