/**
 * Web Search Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerTool } from '../../adapters/tool-adapter';
import { searchWeb, searchDirect, fetchUrl, resolveSearxngUrl, resolveSearchTimeout, DEFAULT_SEARXNG_URL } from './logic';
import type { SearchConfig } from './types';

export function register(pi: ExtensionAPI): void {
  registerTool(pi, {
    name: 'web_search',
    description: '搜索网络并返回结果列表',
    parameters: {
      query: { type: 'string', description: '搜索关键词' },
      maxResults: { type: 'number', description: '最大结果数，默认 5', optional: true },
    },
    execute: async (args) => {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) ?? 5;
      // 端点解析：环境变量 > settings.json（pi-web-search.searxng_url）> 本地默认
      const searxngUrl = resolveSearxngUrl() || DEFAULT_SEARXNG_URL;
      const config: SearchConfig = { searxng_url: searxngUrl, timeout: resolveSearchTimeout() };
      const result = await searchWeb(config, query, { max_results: maxResults });
      // SearXNG 不可达/无结果时自动降级为免配置 HTTP 搜索（Bing 直连）
      if (/^搜索(失败|超时)|^未找到结果/.test(result)) {
        return `[SearXNG 不可用（${searxngUrl}），已降级 HTTP 搜索]\n\n${await searchDirect(query, maxResults)}`;
      }
      return result;
    },
  });

  // fetch_url：轻量 HTTP GET（无需浏览器）
  registerTool(pi, {
    name: 'fetch_url',
    description: '使用 HTTP GET 获取 URL 内容（纯文本/API/JSON/Markdown）。需 JavaScript 渲染的页面用 browser_navigate。',
    parameters: {
      url: { type: 'string', description: '完整 URL（含协议）' },
      max_length: { type: 'number', description: '最大返回字符数，默认 8000', optional: true },
    },
    execute: async (args) => {
      const url = args.url as string;
      const maxLength = (args.max_length as number) ?? 8000;
      return fetchUrl(url, maxLength, resolveSearchTimeout());
    },
  });

  // web_fetch：轻量 HTTP 搜索（不依赖 SearXNG，作为搜索不可用时的 fallback）
  registerTool(pi, {
    name: 'web_fetch',
    description: '使用 HTTP GET 从搜索引擎获取结果。不依赖 SearXNG，适合搜索不可用时的 fallback。',
    parameters: {
      query: { type: 'string', description: '搜索关键词' },
      max_results: { type: 'number', description: '最大返回结果数，默认 5', optional: true },
    },
    execute: async (args) => {
      const query = args.query as string;
      const maxResults = (args.max_results as number) ?? 5;
      return searchDirect(query, maxResults);
    },
  });
}
