/**
 * Web Search Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerTool } from '../../adapters/tool-adapter';
import { searchWeb } from './logic';
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
      const config: SearchConfig = {
        searxng_url: process.env.SEARXNG_URL || 'https://search.brave.com',
        timeout: 15000,
      };
      const result = await searchWeb(config, query, { max_results: maxResults });
      return result;
    },
  });
}
