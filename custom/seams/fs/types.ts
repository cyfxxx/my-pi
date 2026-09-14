import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 文件系统 缝隙接口
// ============================================================================

export interface FSService {
  /** 读取文件 */
  readFile(path: string, options?: FSReadOptions): Promise<FSReadResult>
  /** 写入文件 */
  writeFile(path: string, content: string, options?: FSWriteOptions): Promise<void>
  /** 编辑文件 */
  editFile(path: string, edits: FSEdit[], options?: FSEditOptions): Promise<FSEditResult>
  /** 搜索文件内容 */
  grep(pattern: string, options?: GrepOptions): Promise<GrepResult>
  /** 查找文件 */
  find(pattern: string, options?: FindOptions): Promise<FindResult>
  /** 列出目录 */
  ls(path: string, options?: LSOptions): Promise<LSResult>
  /** 检查路径是否存在 */
  exists(path: string): Promise<boolean>
  /** 获取文件信息 */
  stat(path: string): Promise<FSStat>
  /** 创建目录 */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  /** 删除文件或目录 */
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

export interface FSReadOptions {
  encoding?: BufferEncoding
  offset?: number
  limit?: number
}

export interface FSReadResult {
  content: string
  size: number
  truncated: boolean
}

export interface FSWriteOptions {
  encoding?: BufferEncoding
  /** 是否创建父目录 */
  mkdir?: boolean
}

export interface FSEdit {
  oldString: string
  newString: string
 replaceAll?: boolean
}

export interface FSEditOptions {
  /** 编辑前是否读取文件 */
  dryRun?: boolean
}

export interface FSEditResult {
  success: boolean
  changes: number
}

export interface GrepOptions {
  path?: string
  include?: string
  exclude?: string
  maxResults?: number
  caseSensitive?: boolean
  multiline?: boolean
}

export interface GrepResult {
  matches: GrepMatch[]
  totalMatches: number
}

export interface GrepMatch {
  file: string
  line: number
  content: string
}

export interface FindOptions {
  path?: string
  type?: 'file' | 'directory'
  maxDepth?: number
}

export interface FindResult {
  files: string[]
}

export interface LSOptions {
  recursive?: boolean
  includeHidden?: boolean
}

export interface LSResult {
  entries: FSEntry[]
}

export interface FSEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
}

export interface FSStat {
  size: number
  isFile: boolean
  isDirectory: boolean
  created: Date
  modified: Date
}

export const FS_SEAM_DEFINITION: ServiceDefinition<FSService> = {
  name: 'fs',
  description: '文件系统操作能力',
  defaultProvider: 'local',
  dependencies: ['sandbox'],
}

export type FSProvider = ServiceProvider<FSService>
