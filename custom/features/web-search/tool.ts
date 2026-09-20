/**
 * tool.ts - 搜索工具注册
 *
 * 通过适配器注册搜索工具
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { SearchOnlyConfig } from './types'
import { searchWeb, searchDirect, HTTP_TIMEOUT_MS } from './logic'
import { loadConfig } from './config'

/**
 * 注册搜索工具
 */
export function registerSearchTools(pi: ExtensionAPI): void {
  const config: SearchOnlyConfig = loadConfig()

  // ─── web_search: SearXNG 搜索 ──────────────────────────────
  pi.registerTool({
    name: 'web_search',
    label: '搜索网络',
    description:
      '使用 SearXNG 私密元搜索引擎搜索网络。支持指定搜索引擎列表、分类过滤、分页、时间范围。',
    promptSnippet: '搜索网络，支持多引擎、分类、分页和时间范围过滤',
    promptGuidelines: [
      '国内网络推荐 engines: ["baidu","sogou","bing"]，境外用 ["google","bing","duckduckgo"]',
      '如搜索结果不理想，尝试减少 engines 参数或切换 categories',
      '默认返回 5 条结果，使用 max_results:N 查看更多, brief:true 只看标题列表',
    ],
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        engines: {
          type: 'array',
          items: { type: 'string' },
          description: '指定搜索引擎列表，如 ["google","bing","duckduckgo"]',
        },
        categories: {
          type: 'string',
          enum: ['general', 'news', 'images', 'videos', 'files', 'map', 'music', 'it', 'science', 'social media'],
          description: '搜索类别',
        },
        pageno: { type: 'number', description: '页码，从 1 开始' },
        time_range: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: '时间范围过滤',
        },
        lang: { type: 'string', description: '语言代码，如 zh-CN、en-US' },
        max_results: { type: 'number', description: '返回的最大结果数（默认 5）' },
        brief: { type: 'boolean', description: '简要模式：只返回标题和 URL 列表' },
      },
      required: ['query'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const text = await searchWeb(
        config.search,
        params.query as string,
        {
          engines: params.engines as string[] | undefined,
          categories: params.categories as string | undefined,
          pageno: params.pageno as number | undefined,
          time_range: params.time_range as string | undefined,
          lang: params.lang as string | undefined,
          max_results: params.max_results as number | undefined,
          brief: params.brief as boolean | undefined,
        },
        signal,
      )
      return { content: [{ type: 'text', text }], details: {} }
    },
  } as any)

  // ─── web_fetch: Bing 直接搜索 ──────────────────────────────
  pi.registerTool({
    name: 'web_fetch',
    label: '网络搜索',
    description: '使用 HTTP GET 从搜索引擎获取结果。不依赖 SearXNG，适合搜索不可用时的 fallback。',
    promptSnippet: '网络搜索',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        max_results: { type: 'number', description: '最大返回结果数，默认 5' },
      },
      required: ['query'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const query = params.query as string
      const maxResults = (params.max_results as number) ?? 5
      try {
        const text = await searchDirect(query, maxResults, signal ?? undefined, config.search.timeout)
        return { content: [{ type: 'text', text }], details: {} }
      } catch (e) {
        return { content: [{ type: 'text', text: `搜索失败: ${(e as Error).message}` }], details: {} }
      }
    },
  } as any)

  // ─── fetch_url: HTTP GET ─────────────────────────────────────
  pi.registerTool({
    name: 'fetch_url',
    label: '获取 URL',
    description: '使用 HTTP GET 获取 URL 内容（纯文本/API/JSON/Markdown）。需 JavaScript 渲染的页面用 browser。',
    promptSnippet: '获取网页内容',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整 URL（含协议）' },
        max_length: { type: 'number', description: '最大返回字符数，默认 8000' },
      },
      required: ['url'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const url = params.url as string
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return { content: [{ type: 'text', text: `无效 URL：${url}` }], details: {} }
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { content: [{ type: 'text', text: `不支持的协议 "${parsed.protocol}"：fetch_url 仅允许 http/https URL` }], details: {} }
      }
      const maxLength = Math.max(0, Math.min((params.max_length as number) ?? 8000, 200000))
      const controller = new AbortController()
      const onUserAbort = () => controller.abort()
      signal?.addEventListener?.('abort', onUserAbort)
      const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PiBot/1.0)' },
        })
        if (!res.ok) {
          try { await res.body?.cancel() } catch { /* 已释放 */ }
          return { content: [{ type: 'text', text: `HTTP ${res.status}: ${res.statusText}` }], details: {} }
        }
        const text = await res.text()
        const truncated = text.length > maxLength
          ? text.slice(0, maxLength) + `\n\n...（共 ${text.length} 字符，仅显示前 ${maxLength} 字符）`
          : text
        return { content: [{ type: 'text', text: truncated }], details: {} }
      } catch (e) {
        return { content: [{ type: 'text', text: `请求失败: ${(e as Error).message}` }], details: {} }
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener?.('abort', onUserAbort)
      }
    },
  } as any)
}
