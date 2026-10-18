/**
 * SearXNG 搜索 provider（`ctx.web` 的可替换后端之一）。
 *
 * 为什么要它：DSH 自带的 `web-search-deepseek` **不需要额外 API**（复用 `DEEPSEEK_API_KEY`），
 * 但它把一次搜索做成"一整轮模型调用"（慢、耗 token）；本仓原本就有本地 SearXNG 实例与配套实现。
 * `ctx.web` 是官方接缝（`registerSearchProvider` + `searchProvider` 选择策略），所以这里按接缝挂进去，
 * 不 fork、不改上游。
 *
 * 配置：`SEARXNG_URL`（默认 `http://127.0.0.1:8889`，与原项目一致）。
 */
import type { WebSearchProvider, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web';

export interface SearxngConfig {
  readonly url: string;
  readonly timeoutMs: number;
}

/** 默认端点与原项目一致（`custom/features/web-search/config.ts`）。 */
export const DEFAULT_SEARXNG_URL = 'http://127.0.0.1:8889';
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;

export function resolveSearxngConfig(env: Record<string, string | undefined> = process.env): SearxngConfig {
  const url = (env.SEARXNG_URL ?? env.PI_WEB_TOOLKIT_SEARXNG_URL ?? DEFAULT_SEARXNG_URL).replace(/\/+$/, '');
  const raw = Number(env.PI_WEB_TOOLKIT_SEARCH_TIMEOUT ?? '');
  const timeoutMs = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SEARCH_TIMEOUT_MS;
  return { url, timeoutMs };
}

interface SearxngResponse {
  readonly results?: readonly {
    readonly url?: string;
    readonly title?: string;
    readonly content?: string;
    readonly publishedDate?: string;
  }[];
}

/** 把 SearXNG 的 JSON 结果归一成 `ctx.web` 的 `WebSearchResult`。 */
export function toSearchResult(data: SearxngResponse, maxResults?: number): WebSearchResult {
  const all: WebSearchSource[] = [];
  for (const item of data.results ?? []) {
    if (typeof item.url !== 'string' || item.url.length === 0) continue;
    all.push({
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.content ? { snippet: item.content } : {}),
      ...(item.publishedDate ? { publishedAt: item.publishedDate } : {}),
    });
  }
  const sources = maxResults === undefined ? all : all.slice(0, maxResults);
  return { sources, truncated: sources.length < all.length };
}

export function createSearxngProvider(config: SearxngConfig): WebSearchProvider {
  return {
    id: 'searxng',
    // 契约要求：只做本地可用性判断，不发网络请求。
    available: () => config.url.length > 0,
    async search(request, signal) {
      const params = new URLSearchParams({ format: 'json', q: request.query });
      const response = await fetch(`${config.url}/search?${params.toString()}`, {
        headers: { accept: 'application/json', 'user-agent': 'my-pi-assistant/1.0' },
        signal: signal ?? AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`searxng: ${config.url} 返回 HTTP ${response.status}（检查 SEARXNG_URL 与实例状态）`);
      }
      return toSearchResult((await response.json()) as SearxngResponse, request.maxResults);
    },
  };
}
