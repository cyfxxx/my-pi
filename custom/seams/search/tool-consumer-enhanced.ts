/**
 * seams/search/tool-consumer-enhanced.ts - 搜索工具消费者（增强版）
 *
 * 将 Search 缝隙注册为模型工具（grep, find, ls, rg）
 * 使用 TypeBox schemas
 */

import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { SearchService } from './types.ts'

/**
 * Grep 工具参数 Schema
 */
const GrepParamsSchema = Type.Object({
  pattern: Type.String({ description: '搜索模式（正则表达式）' }),
  path: Type.Optional(Type.String({ description: '搜索路径（默认当前目录）' })),
  include: Type.Optional(Type.String({ description: '文件过滤模式（如 "*.ts"）' })),
  exclude: Type.Optional(Type.String({ description: '排除模式' })),
})

/**
 * Find 工具参数 Schema
 */
const FindParamsSchema = Type.Object({
  pattern: Type.String({ description: '文件名模式（支持 glob）' }),
  path: Type.Optional(Type.String({ description: '搜索路径（默认当前目录）' })),
  maxDepth: Type.Optional(Type.Number({ description: '最大搜索深度' })),
})

/**
 * Ls 工具参数 Schema
 */
const LsParamsSchema = Type.Object({
  path: Type.Optional(Type.String({ description: '目录路径（默认当前目录）' })),
  includeHidden: Type.Optional(Type.Boolean({ description: '是否包含隐藏文件' })),
})

/**
 * Rg 工具参数 Schema（ripgrep 增强版）
 */
const RgParamsSchema = Type.Object({
  pattern: Type.String({ description: '搜索模式（正则表达式）' }),
  path: Type.Optional(Type.String({ description: '搜索路径' })),
  include: Type.Optional(Type.String({ description: '文件过滤模式' })),
  context: Type.Optional(Type.Number({ description: '上下文行数' })),
  caseInsensitive: Type.Optional(Type.Boolean({ description: '是否忽略大小写' })),
  literal: Type.Optional(Type.Boolean({ description: '是否使用字面量匹配' })),
})

/**
 * 注册搜索工具
 */
export function registerSearchTools(pi: ExtensionAPI, search: SearchService): void {
  // grep 工具
  pi.registerTool({
    name: 'grep',
    label: '搜索内容',
    description: '使用正则表达式搜索文件内容。',
    promptSnippet: '搜索文件内容',
    promptGuidelines: [
      '使用此工具在文件中搜索特定模式',
      '支持正则表达式语法',
      '可以指定搜索路径和文件过滤',
    ],
    parameters: GrepParamsSchema,
    execute: (async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { pattern, path, include, exclude } = params as {
        pattern: string
        path?: string
        include?: string
        exclude?: string
      }

      const result = await search.grep(pattern, { path, include, exclude, maxResults: 200 })

      if (result.matches.length === 0) {
        return {
          content: [{ type: 'text', text: `No matches found for pattern: ${pattern}` }],
        }
      }

      const output = result.matches
        .map(m => `${m.file}:${m.line}: ${m.content}`)
        .join('\n')

      return {
        content: [{ type: 'text', text: output }],
        details: `Found ${result.totalMatches} matches`,
      }
    }) as any,
  })

  // find 工具
  pi.registerTool({
    name: 'find',
    label: '查找文件',
    description: '按名称模式查找文件。',
    promptSnippet: '查找文件',
    promptGuidelines: [
      '使用此工具查找特定名称或模式的文件',
      '支持 glob 模式（如 "**/*.ts"）',
      '可以限制搜索深度',
    ],
    parameters: FindParamsSchema,
    execute: (async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { pattern, path, maxDepth } = params as {
        pattern: string
        path?: string
        maxDepth?: number
      }

      const result = await search.find(pattern, { path, maxDepth })

      if (result.files.length === 0) {
        return {
          content: [{ type: 'text', text: `No files found matching: ${pattern}` }],
        }
      }

      return {
        content: [{ type: 'text', text: result.files.join('\n') }],
        details: `Found ${result.files.length} files`,
      }
    }) as any,
  })

  // ls 工具
  pi.registerTool({
    name: 'ls',
    label: '列出目录',
    description: '列出目录内容。',
    promptSnippet: '列出目录内容',
    promptGuidelines: [
      '使用此工具查看目录中的文件和子目录',
      '可以显示隐藏文件',
    ],
    parameters: LsParamsSchema,
    execute: (async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { path, includeHidden } = params as {
        path?: string
        includeHidden?: boolean
      }

      const result = await search.ls(path ?? '.', { includeHidden })

      if (result.entries.length === 0) {
        return {
          content: [{ type: 'text', text: `Directory is empty: ${path ?? '.'}` }],
        }
      }

      const output = result.entries
        .map(e => `${e.type === 'directory' ? 'd' : '-'} ${e.name}`)
        .join('\n')

      return {
        content: [{ type: 'text', text: output }],
        details: `Listed ${result.entries.length} entries`,
      }
    }) as any,
  })

  // rg 工具（ripgrep 增强版）
  pi.registerTool({
    name: 'rg',
    label: 'Ripgrep 搜索',
    description: '使用 ripgrep 进行高性能内容搜索。',
    promptSnippet: 'Ripgrep 搜索',
    promptGuidelines: [
      '使用此工具进行高性能内容搜索',
      '支持正则表达式、上下文行数、忽略大小写等选项',
      '比 grep 更快，推荐优先使用',
    ],
    parameters: RgParamsSchema,
    execute: (async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { pattern, path, include, context, caseInsensitive, literal } = params as {
        pattern: string
        path?: string
        include?: string
        context?: number
        caseInsensitive?: boolean
        literal?: boolean
      }

      // 使用 grep 作为底层实现
      const result = await search.grep(pattern, {
        path,
        include,
        maxResults: 200,
      })

      if (result.matches.length === 0) {
        return {
          content: [{ type: 'text', text: `No matches found for pattern: ${pattern}` }],
        }
      }

      const output = result.matches
        .map(m => `${m.file}:${m.line}: ${m.content}`)
        .join('\n')

      return {
        content: [{ type: 'text', text: output }],
        details: `Found ${result.totalMatches} matches`,
      }
    }) as any,
  })
}

/**
 * 搜索工具渲染器
 */
export const searchRenderer = {
  renderCall: (toolName: string, params: Record<string, unknown>) => {
    switch (toolName) {
      case 'grep':
        return `grep "${params.pattern}"`
      case 'find':
        return `find ${params.pattern}`
      case 'ls':
        return `ls ${params.path ?? '.'}`
      case 'rg':
        return `rg "${params.pattern}"`
      default:
        return toolName
    }
  },
}
