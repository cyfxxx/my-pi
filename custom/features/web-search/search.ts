/**
 * SearXNG 搜索实现（含错误分类与重试、结果格式化/去重）。
 * 迁移自 pi-tools `pi-web-search/search/impl.ts`（wechat-article-exporter 启发）。
 */

import type { SearchConfig, SearchResponse, SearchResultItem } from './types';

// ── 错误分类 ──────────────────────────────────────────────────
// 5xx / 网络错误 → 可重试（服务端临时故障或连接问题）
// 4xx / 非重试状态码 → 立即失败（客户端错误，重试无意义）
// 429 → 特殊处理：读取 Retry-After 头，否则指数退避
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/** 可被 signal 取消的 sleep（避免超时已 abort 后仍空等退避） */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchWithRetry(
  url: string,
  opts: { signal: AbortSignal; headers: Record<string, string> },
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts);

      // 4xx（非429）→ 立即失败，不重试
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return res;
      }

      // 5xx / 429 / OK → 返回（429 也返回，由调用方决定是否再试）
      if (res.ok || RETRYABLE_STATUS.has(res.status)) {
        if (res.ok || attempt >= maxRetries) return res;

        // 重试前释放响应体（避免未消费的 body 占用连接）
        try {
          await res.body?.cancel();
        } catch {
          /* 已释放 */
        }

        // 429: 读 Retry-After 头，否则指数退避
        const retryAfter = res.headers.get('Retry-After');
        const delayMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 10000)
          : Math.min(500 * Math.pow(2, attempt), 8000);
        await sleep(delayMs, opts.signal);
        continue;
      }

      return res;
    } catch (e) {
      // 取消/超时：立即抛出，不再重试
      if (opts.signal.aborted) throw e;
      if (attempt >= maxRetries) throw e;
      // 网络错误：指数退避（500ms → 1s → 2s → 4s，上限8s）
      const delayMs = Math.min(500 * Math.pow(2, attempt), 8000);
      await sleep(delayMs, opts.signal);
    }
  }
  throw new Error('重试耗尽');
}

export async function searchWeb(
  config: SearchConfig,
  query: string,
  options?: {
    engines?: string[];
    categories?: string;
    pageno?: number;
    time_range?: string;
    lang?: string;
    max_results?: number;
    brief?: boolean;
  },
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) return '搜索已取消。';

  const params = new URLSearchParams({ format: 'json', q: query });

  if (options?.categories) params.set('categories', options.categories);
  if (options?.pageno) params.set('pageno', String(options.pageno));
  if (options?.time_range) params.set('time_range', options.time_range);
  if (options?.lang) params.set('lang', options.lang);
  if (options?.engines?.length) params.set('engines', options.engines.join(','));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);

  const onAbort = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetchWithRetry(
      `${config.searxng_url}/search?${params}`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'pi-web-toolkit/1.0' },
      },
      3,
    );

    if (!res.ok) {
      return `搜索失败: SearXNG 返回 ${res.status} ${res.statusText}。请检查 searxng_url 配置是否正确。`;
    }

    const data: SearchResponse = await res.json();
    const maxResults = sanitizeMaxResults(options?.max_results);
    return formatResponse(data, query, maxResults, options?.brief ?? false);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      if (signal?.aborted) return '搜索已取消。';
      return `搜索超时 (${config.timeout}ms)。请检查 SearXNG 实例 ${config.searxng_url} 是否可达。`;
    }
    return `搜索失败: ${(err as Error).message}`;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** max_results 显式校验：非有限或 floor 后 <1 时回退默认 5（避免 slice(0,0) 空结果 / slice(0,-1) 全量泄露） */
export function sanitizeMaxResults(maxResults?: number): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) return 5;
  const n = Math.floor(maxResults);
  return n >= 1 ? n : 5;
}

export function formatResponse(
  data: SearchResponse,
  query: string,
  maxResults: number = 5,
  brief: boolean = false,
): string {
  const lines: string[] = [];
  lines.push(`搜索: "${query}"`, '');

  const rawResults = data.results ?? [];
  // W1: 多引擎结果按 URL 去重（同一链接多引擎命中时合并 engine 标签）
  const seen = new Map<string, SearchResultItem>();
  const results: SearchResultItem[] = [];
  for (const r of rawResults) {
    const key = r.url || r.title;
    if (!key) {
      results.push(r);
      continue;
    }
    const existing = seen.get(key);
    if (existing) {
      if (r.engine && existing.engine && !existing.engine.includes(r.engine)) {
        existing.engine = `${existing.engine},${r.engine}`;
      } else if (r.engine && !existing.engine) {
        existing.engine = r.engine;
      }
      continue;
    }
    seen.set(key, r);
    results.push(r);
  }
  const answers = data.answers ?? [];
  const suggestions = data.suggestions ?? [];
  const corrections = data.corrections ?? [];
  const unresponsive = data.unresponsive_engines ?? [];
  const infoboxes = data.infoboxes ?? [];

  if (brief && results.length > 0) {
    lines.push(`找到 ${data.number_of_results ?? results.length} 条结果（简要模式）：`);
    lines.push('');
    for (const r of results.slice(0, maxResults)) {
      const tag = r.engine ? ` [${r.engine}]` : '';
      lines.push(`- ${r.title}${tag}`);
      lines.push(`  ${r.url}`);
    }
    if (results.length > maxResults) {
      lines.push(`  ... 还有 ${results.length - maxResults} 条结果。使用 max_results:N 展开更多。`);
    }
    if (answers.length > 0) {
      lines.push('');
      lines.push('直接答案：');
      for (const a of answers) lines.push(`- ${a}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  if (results.length > 0) {
    lines.push(`找到 ${data.number_of_results ?? results.length} 条结果：`);
    lines.push('');
    for (const r of results.slice(0, maxResults)) {
      const tag = r.engine ? ` [${r.engine}]` : '';
      lines.push(`### ${r.title}${tag}`);
      lines.push(r.url);
      if (r.content) lines.push(truncate(r.content, 250));
      if (r.publishedDate) lines.push(`时间: ${r.publishedDate}`);
      lines.push('');
    }
    if (results.length > maxResults) {
      lines.push(`... 还有 ${results.length - maxResults} 条结果未显示。使用 max_results:N 查看更多。`);
    }
  } else {
    lines.push('未找到结果。');
  }

  if (answers.length > 0) {
    lines.push('---\n直接答案：');
    for (const a of answers) lines.push(`- ${a}`);
    lines.push('');
  }

  if (suggestions.length > 0) {
    lines.push('搜索建议：`' + suggestions.join('` `') + '`');
    lines.push('');
  }

  if (corrections.length > 0) {
    lines.push('拼写纠正：');
    for (const c of corrections) lines.push(`- ${c}`);
    lines.push('');
  }

  if (unresponsive.length > 0) {
    lines.push(`⚠ 以下引擎无响应：${unresponsive.join('、')}`);
    lines.push('可尝试减少 engines 参数或切换 categories。');
    lines.push('');
  }

  if (infoboxes.length > 0) {
    lines.push('信息框：');
    for (const ib of infoboxes) {
      lines.push(`- ${ib.title ?? ib.content ?? JSON.stringify(ib)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '...';
}
