import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 搜索 缝隙接口
// ============================================================================

export interface SearchService {
  /** 正则搜索文件内容 */
  grep(pattern: string, options?: SearchGrepOptions): Promise<SearchGrepResult>
  /** 查找文件 */
  find(pattern: string, options?: SearchFindOptions): Promise<SearchFindResult>
  /** 列出目录 */
  ls(path: string, options?: SearchLSOptions): Promise<SearchLSResult>
}

export interface SearchGrepOptions {
  path?: string
  include?: string
  exclude?: string
  maxResults?: number
  caseSensitive?: boolean
}

export interface SearchGrepResult {
  matches: SearchGrepMatch[]
  totalMatches: number
  truncated: boolean
}

export interface SearchGrepMatch {
  file: string
  line: number
  content: string
}

export interface SearchFindOptions {
  path?: string
  type?: 'file' | 'directory'
  maxDepth?: number
  name?: string
}

export interface SearchFindResult {
  files: string[]
}

export interface SearchLSOptions {
  recursive?: boolean
  includeHidden?: boolean
}

export interface SearchLSResult {
  entries: SearchLSEntry[]
}

export interface SearchLSEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

export const SEARCH_SEAM_DEFINITION: ServiceDefinition<SearchService> = {
  name: 'search',
  description: '文件搜索能力（grep, find, ls）',
  defaultProvider: 'ripgrep',
}

export type SearchProvider = ServiceProvider<SearchService>
