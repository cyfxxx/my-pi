import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { FSService } from './types.ts'

/**
 * 文件系统工具消费者
 * 将 FS 缝隙注册为模型工具（read, write, edit）
 */
export function registerFSTools(pi: ExtensionAPI, fs: FSService): void {
  // read 工具
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readTool: any = {
    name: 'read',
    label: '读取文件',
    description: '读取文件内容。支持文本文件和图片。',
    promptSnippet: '读取文件内容',
    promptGuidelines: [
      '使用此工具查看文件内容、配置文件、源代码等',
      '可以指定行号范围来读取文件的特定部分',
      '大文件会被自动截断',
    ],
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '文件路径',
        },
        offset: {
          type: 'number',
          description: '起始行号（从 1 开始）',
        },
        limit: {
          type: 'number',
          description: '最大读取行数',
        },
      },
      required: ['filePath'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { filePath, offset, limit } = params as {
        filePath: string
        offset?: number
        limit?: number
      }

      const result = await fs.readFile(filePath, {
        offset: offset ? (offset - 1) * 50 : undefined, // 粗略估算
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
  }
  pi.registerTool(readTool)

  // write 工具
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeTool: any = {
    name: 'write',
    label: '写入文件',
    description: '将内容写入文件。如果文件不存在会创建，存在会覆盖。',
    promptSnippet: '写入文件内容',
    promptGuidelines: [
      '使用此工具创建新文件或完全重写现有文件',
      '写入前会自动创建必要的目录',
      '重要文件建议先用 read 查看现有内容',
    ],
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '文件路径',
        },
        content: {
          type: 'string',
          description: '要写入的内容',
        },
      },
      required: ['filePath', 'content'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { filePath, content } = params as { filePath: string; content: string }

      await fs.writeFile(filePath, content, { mkdir: true })

      return {
        content: [{ type: 'text', text: `Successfully wrote to ${filePath}` }],
        details: `File: ${filePath} | Size: ${content.length} chars`,
      }
    },
  }
  pi.registerTool(writeTool)

  // edit 工具
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editTool: any = {
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
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '文件路径',
        },
        oldString: {
          type: 'string',
          description: '要替换的旧字符串',
        },
        newString: {
          type: 'string',
          description: '替换后的新字符串',
        },
        replaceAll: {
          type: 'boolean',
          description: '是否替换所有匹配项',
        },
      },
      required: ['filePath', 'oldString', 'newString'],
    },
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
  }
  pi.registerTool(editTool)
}
