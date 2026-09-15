/**
 * seams/fs/tool-consumer-enhanced.ts - 文件系统工具消费者（增强版）
 *
 * 将 FS 缝隙注册为模型工具（read, write, edit, mkdir, glob）
 * 使用 TypeBox schemas
 */

import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { FSService } from './types.ts'

/**
 * Read 工具参数 Schema
 */
const ReadParamsSchema = Type.Object({
  filePath: Type.String({ description: '文件路径' }),
  offset: Type.Optional(Type.Number({ description: '起始行号（从 1 开始）' })),
  limit: Type.Optional(Type.Number({ description: '最大读取行数' })),
})

/**
 * Write 工具参数 Schema
 */
const WriteParamsSchema = Type.Object({
  filePath: Type.String({ description: '文件路径' }),
  content: Type.String({ description: '要写入的内容' }),
})

/**
 * Edit 工具参数 Schema
 */
const EditParamsSchema = Type.Object({
  filePath: Type.String({ description: '文件路径' }),
  oldString: Type.String({ description: '要替换的旧字符串' }),
  newString: Type.String({ description: '替换后的新字符串' }),
  replaceAll: Type.Optional(Type.Boolean({ description: '是否替换所有匹配项' })),
})

/**
 * Mkdir 工具参数 Schema
 */
const MkdirParamsSchema = Type.Object({
  path: Type.String({ description: '目录路径' }),
  recursive: Type.Optional(Type.Boolean({ description: '是否递归创建' })),
})

/**
 * Glob 工具参数 Schema
 */
const GlobParamsSchema = Type.Object({
  pattern: Type.String({ description: 'glob 模式' }),
  path: Type.Optional(Type.String({ description: '搜索路径' })),
})

/**
 * 注册文件系统工具
 */
export function registerFSTools(pi: ExtensionAPI, fs: FSService): void {
  // read 工具
  pi.registerTool({
    name: 'read',
    label: '读取文件',
    description: '读取文件内容。支持文本文件和图片。',
    promptSnippet: '读取文件内容',
    promptGuidelines: [
      '使用此工具查看文件内容、配置文件、源代码等',
      '可以指定行号范围来读取文件的特定部分',
      '大文件会被自动截断',
    ],
    parameters: ReadParamsSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { filePath, offset, limit } = params as {
        filePath: string
        offset?: number
        limit?: number
      }

      const result = await fs.readFile(filePath, {
        offset: offset ? (offset - 1) * 50 : undefined,
        limit: limit ? limit * 50 : undefined,
      })

      const lines = result.content.split('\n')
      const startLine = offset ?? 1
      const displayContent = lines
        .slice(0, limit ?? 2000)
        .map((line, i) => `${startLine + i}: ${line}`)
        .join('\n')

      return {
        content: [{ type: 'text', text: displayContent }],
        details: `File: ${filePath} | Size: ${result.size} bytes${result.truncated ? ' (truncated)' : ''}`,
      }
    },
  })

  // write 工具
  pi.registerTool({
    name: 'write',
    label: '写入文件',
    description: '将内容写入文件。如果文件不存在会创建，存在会覆盖。',
    promptSnippet: '写入文件内容',
    promptGuidelines: [
      '使用此工具创建新文件或完全重写现有文件',
      '写入前会自动创建必要的目录',
      '重要文件建议先用 read 查看现有内容',
    ],
    parameters: WriteParamsSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { filePath, content } = params as { filePath: string; content: string }

      await fs.writeFile(filePath, content, { mkdir: true })

      return {
        content: [{ type: 'text', text: `Successfully wrote to ${filePath}` }],
        details: `File: ${filePath} | Size: ${content.length} chars`,
      }
    },
  })

  // edit 工具
  pi.registerTool({
    name: 'edit',
    label: '编辑文件',
    description: '在文件中进行精确的字符串替换。可以替换所有匹配项或第一个匹配项。',
    promptSnippet: '编辑文件内容',
    promptGuidelines: [
      '使用此工具修改文件的特定部分',
      'oldString 必须与文件中的内容完全匹配',
      '如果要替换所有匹配项，设置 replaceAll 为 true',
      '编辑前建议先用 read 查看文件内容',
    ],
    parameters: EditParamsSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { filePath, oldString, newString, replaceAll } = params as {
        filePath: string
        oldString: string
        newString: string
        replaceAll?: boolean
      }

      const result = await fs.editFile(filePath, [
        { oldString, newString, replaceAll },
      ])

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Edit failed: oldString not found in ${filePath}` }],
          isError: true,
        }
      }

      return {
        content: [{ type: 'text', text: `Successfully edited ${filePath}` }],
        details: `File: ${filePath} | Changes: ${result.changes}`,
      }
    },
  })

  // mkdir 工具
  pi.registerTool({
    name: 'mkdir',
    label: '创建目录',
    description: '创建目录。',
    promptSnippet: '创建目录',
    promptGuidelines: [
      '使用此工具创建新目录',
      '如果目录已存在，操作会成功',
      '使用 recursive 选项递归创建多级目录',
    ],
    parameters: MkdirParamsSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { path, recursive } = params as { path: string; recursive?: boolean }

      await fs.mkdir(path, { recursive })

      return {
        content: [{ type: 'text', text: `Created directory: ${path}` }],
        details: `Directory: ${path}`,
      }
    },
  })

  // glob 工具
  pi.registerTool({
    name: 'glob',
    label: '匹配文件',
    description: '使用 glob 模式匹配文件。',
    promptSnippet: '匹配文件',
    promptGuidelines: [
      '使用此工具查找匹配模式的文件',
      '支持标准 glob 语法（如 "**/*.ts"）',
      '返回匹配的文件路径列表',
    ],
    parameters: GlobParamsSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { pattern, path } = params as { pattern: string; path?: string }

      const result = await fs.glob(pattern, { path })

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
  })
}

/**
 * 文件系统工具渲染器
 */
export const fsRenderer = {
  renderCall: (toolName: string, params: Record<string, unknown>) => {
    switch (toolName) {
      case 'read':
        return `cat ${params.filePath}`
      case 'write':
        return `> ${params.filePath}`
      case 'edit':
        return `edit ${params.filePath}`
      case 'mkdir':
        return `mkdir ${params.path}`
      case 'glob':
        return `glob ${params.pattern}`
      default:
        return toolName
    }
  },
}
