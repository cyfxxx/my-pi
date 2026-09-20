/**
 * types.ts - 搜索类型定义
 *
 * 纯类型定义，零 Pi 依赖
 */

export interface SearchConfig {
  searxng_url: string
  timeout: number
}

export interface SearchResultItem {
  title: string
  url: string
  content?: string
  engine?: string
  score?: number
  category?: string
  publishedDate?: string
  thumbnail?: string
}

export interface SearchResponse {
  query: string
  number_of_results: number
  results: SearchResultItem[]
  answers: string[]
  corrections: string[]
  suggestions: string[]
  unresponsive_engines: string[]
  infoboxes: Array<{ title?: string; content?: string; [key: string]: unknown }>
}

export interface SearchOnlyConfig {
  search: SearchConfig
}
