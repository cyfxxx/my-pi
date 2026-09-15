/**
 * seams/shell/tool-consumer.ts - Shell 工具消费者（增强版）
 *
 * 将 Shell 缝隙注册为模型工具
 * 使用 TypeBox schemas 和 adapters 层
 */

import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ShellService } from './types.ts'

/**
 * Shell 工具参数 Schema
 */
const BashParamsSchema = Type.Object({
  command: Type.String({ description: '要执行的 shell 命令' }),
})

/**
 * Shell 工具执行结果
 */
interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
  signal?: string
  duration: number
}

/**
 * 注册 Shell 工具
 */
export function registerShellTool(pi: ExtensionAPI, shell: ShellService): void {
  pi.registerTool({
    name: 'bash',
    label: '执行命令',
    description: '在 shell 中执行命令并返回输出。支持管道、重定向等 shell 语法。',
    promptSnippet: '执行 shell 命令',
    promptGuidelines: [
      '使用此工具执行系统命令、运行脚本、管理文件等',
      '命令会直接在当前工作目录执行',
      '长时间运行的命令请考虑使用后台执行',
    ],
    parameters: BashParamsSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => {
      const { command } = params as { command: string }

      const result: ShellResult = await shell.execute(command, {
        timeout: 120000, // 2 分钟超时
      })

      const content: Array<{ type: string; text: string }> = []

      if (result.stdout) {
        content.push({ type: 'text', text: result.stdout })
      }
      if (result.stderr) {
        content.push({ type: 'text', text: `STDERR:\n${result.stderr}` })
      }
      if (result.exitCode !== 0) {
        content.push({
          type: 'text',
          text: `\nExit code: ${result.exitCode}${result.signal ? ` (signal: ${result.signal})` : ''}`,
        })
      }

      return {
        content: content.length > 0 ? content : [{ type: 'text', text: 'Command executed successfully (no output)' }],
        details: `Exit code: ${result.exitCode} | Duration: ${result.duration}ms`,
        isError: result.exitCode !== 0,
      }
    },
  })
}

/**
 * Shell 工具渲染器
 */
export const bashRenderer = {
  renderCall: (params: Record<string, unknown>) => {
    const { command } = params as { command: string }
    return `$ ${command}`
  },
  renderResult: (result: unknown) => {
    const shellResult = result as ShellResult
    if (shellResult.exitCode !== 0) {
      return `Exit code: ${shellResult.exitCode}`
    }
    return undefined
  },
}
