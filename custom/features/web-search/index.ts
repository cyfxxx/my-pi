/**
 * index.ts - Web Search 功能入口
 *
 * 注册搜索工具到 Pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerSearchTools } from './tool'

/**
 * 扩展初始化函数
 */
export async function init(pi: ExtensionAPI): Promise<void> {
  registerSearchTools(pi)
}

/**
 * 扩展销毁函数（搜索扩展无需清理）
 */
export async function destroy(): Promise<void> {
  // 搜索扩展无需清理
}

// 导出纯逻辑（供其他模块复用）
export { searchWeb, searchDirect, createConcurrencyLimiter, batchFetch } from './logic'
export type { SearchConfig, SearchResultItem, SearchResponse, SearchOnlyConfig } from './types'
export type { ConcurrencyLimiter, BatchFetchOptions, BatchFetchResult } from './logic'
