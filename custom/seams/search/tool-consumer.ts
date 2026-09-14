import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { SearchService } from './types.ts'

/**
 * 搜索工具消费者
 * 将 Search 缝隙注册为模型工具（grep, find, ls）
 */
export function registerSearchTools(pi: ExtensionAPI, search: SearchService): void {
  // grep 工具
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grepTool: any = {
    name: 'grep',
    label: '搜索内容',
    description: '使用正则表达式搜索文件内容。',
    promptSnippet: '搜索文件内容',
    promptGuidelines: [
      '使用此工具在文件中搜索特定模式',
      '支持正则表达式语法',
      '可以指定搜索路径和文件过滤',
    ],
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '搜索模式（正则表达式）',
        },
        path: {
          type: 'string',
          description: '搜索路径（默认当前目录）',
        },
        include: {
          type: 'string',
          description: '文件过滤模式（如 "*.ts"）',
        },
        exclude: {
          type: 'string',
          description: '排除模式',
        },
      },
      required: ['pattern'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
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
    },
  }
  pi.registerTool(grepTool)

  // find 工具
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findTool: any = {
    name: 'find',
    label: '查找文件',
    description: '按名称模式查找文件。',
    promptSnippet: '查找文件',
    promptGuidelines: [
      '使用此工具查找特定名称或模式的文件',
      '支持 glob 模式（如 "**/*.ts"）',
      '可以限制搜索深度',
    ],
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '文件名模式（支持 glob）',
        },
        path: {
          type: 'string',
          description: '搜索路径（默认当前目录）',
        },
        maxDepth: {
          type: 'number',
          description: '最大搜索深度',
        },
      },
      required: ['pattern'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
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
    },
  }
  pi.registerTool(findTool)

  // ls 工具
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lsTool: any = {
    name: 'ls',
    label: '列出目录',
    description: '列出目录内容。',
    promptSnippet: '列出目录内容',
    promptGuidelines: [
      '使用此工具查看目录中的文件和子目录',
      '可以显示隐藏文件',
    ],
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目录路径（默认当前目录）',
        },
        includeHidden: {
          type: 'boolean',
          description: '是否包含隐藏文件',
        },
      },
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
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
    },
  }
  pi.registerTool(lsTool)
}
