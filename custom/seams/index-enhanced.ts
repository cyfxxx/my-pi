/**
 * seams/index-enhanced.ts - 增强版 Seams 入口
 *
 * 整合所有增强版工具消费者和适配器
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerShellTool, bashRenderer } from './shell/tool-consumer-enhanced.ts'
import { registerFSTools, fsRenderer } from './fs/tool-consumer-enhanced.ts'
import { registerSearchTools, searchRenderer } from './search/tool-consumer-enhanced.ts'

/**
 * Seams 服务接口
 */
export interface SeamServices {
  shell: {
    execute: (command: string, options?: { timeout?: number }) => Promise<{
      stdout: string
      stderr: string
      exitCode: number
      signal?: string
      duration: number
    }>
  }
  fs: {
    readFile: (path: string, options?: { offset?: number; limit?: number }) => Promise<{
      content: string
      size: number
      truncated?: boolean
    }>
    writeFile: (path: string, content: string, options?: { mkdir?: boolean }) => Promise<void>
    editFile: (path: string, edits: Array<{ oldString: string; newString: string; replaceAll?: boolean }>) => Promise<{
      success: boolean
      changes: number
    }>
    mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
    glob: (pattern: string, options?: { path?: string }) => Promise<{ files: string[] }>
  }
  search: {
    grep: (pattern: string, options?: { path?: string; include?: string; exclude?: string; maxResults?: number }) => Promise<{
      matches: Array<{ file: string; line: number; content: string }>
      totalMatches: number
    }>
    find: (pattern: string, options?: { path?: string; maxDepth?: number }) => Promise<{ files: string[] }>
    ls: (path: string, options?: { includeHidden?: boolean }) => Promise<{
      entries: Array<{ name: string; type: 'file' | 'directory' }>
    }>
  }
}

/**
 * 注册所有 Seams 工具
 */
export function registerSeamTools(pi: ExtensionAPI, services: SeamServices): void {
  // 注册 Shell 工具
  registerShellTool(pi, services.shell)

  // 注册文件系统工具
  registerFSTools(pi, services.fs)

  // 注册搜索工具
  registerSearchTools(pi, services.search)
}

/**
 * 获取工具渲染器
 */
export function getToolRenderers() {
  return {
    bash: bashRenderer,
    fs: fsRenderer,
    search: searchRenderer,
  }
}
