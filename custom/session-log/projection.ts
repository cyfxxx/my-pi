/**
 * Session Log 投影查询
 *
 * 提供结构化查询 session log 的能力
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { SessionEvent, SessionLogStats } from './types.ts'

// ============================================================================
// 投影查询接口
// ============================================================================

export interface SessionLogProjection {
  /** 加载日志文件 */
  load(path: string): Promise<void>

  /** 获取所有事件 */
  getAll(): SessionEvent[]

  /** 按类型过滤 */
  getByType(type: string): SessionEvent[]

  /** 按时间范围过滤 */
  getByTimeRange(start: Date, end: Date): SessionEvent[]

  /** 获取工具调用统计 */
  getToolStats(): Record<string, { count: number; totalTime: number; avgTime: number }>

  /** 获取错误事件 */
  getErrors(): SessionEvent[]

  /** 获取统计摘要 */
  getStats(): SessionLogStats

  /** 搜索内容 */
  search(query: string): SessionEvent[]
}

// ============================================================================
// 实现
// ============================================================================

/** 创建 SessionLogProjection 实例 */
export function createProjection(): SessionLogProjection {
  let events: SessionEvent[] = []

  return {
    async load(path: string): Promise<void> {
      if (!existsSync(path)) {
        return
      }

      const content = await readFile(path, 'utf-8')
      const lines = content.split('\n').filter(line => line.trim())

      events = lines.map(line => {
        try {
          return JSON.parse(line) as SessionEvent
        } catch {
          return null
        }
      }).filter((e): e is SessionEvent => e !== null)
    },

    getAll(): SessionEvent[] {
      return [...events]
    },

    getByType(type: string): SessionEvent[] {
      return events.filter(e => e.type === type)
    },

    getByTimeRange(start: Date, end: Date): SessionEvent[] {
      return events.filter(e => {
        const time = new Date(e.timestamp)
        return time >= start && time <= end
      })
    },

    getToolStats(): Record<string, { count: number; totalTime: number; avgTime: number }> {
      const toolCalls = events.filter(e => e.type === 'tool_call')
      const toolResults = events.filter(e => e.type === 'tool_result')

      const stats: Record<string, { count: number; totalTime: number; avgTime: number }> = {}

      for (const call of toolCalls) {
        const toolName = (call as { toolName?: string }).toolName
        if (toolName) {
          if (!stats[toolName]) {
            stats[toolName] = { count: 0, totalTime: 0, avgTime: 0 }
          }
          stats[toolName].count++
        }
      }

      for (const result of toolResults) {
        const resultData = result as { toolName?: string; duration?: number }
        if (resultData.toolName && stats[resultData.toolName]) {
          stats[resultData.toolName].totalTime += resultData.duration ?? 0
          stats[resultData.toolName].avgTime = stats[resultData.toolName].totalTime / stats[resultData.toolName].count
        }
      }

      return stats
    },

    getErrors(): SessionEvent[] {
      return events.filter(e => e.type === 'tool_result' && (e as { isError?: boolean }).isError)
    },

    getStats(): SessionLogStats {
      const toolStats = this.getToolStats()

      return {
        totalEvents: events.length,
        eventsByType: events.reduce((acc, e) => {
          acc[e.type] = (acc[e.type] ?? 0) + 1
          return acc
        }, {} as Record<string, number>),
        toolStats: Object.fromEntries(
          Object.entries(toolStats).map(([name, stats]) => [
            name,
            { count: stats.count, totalTime: stats.totalTime, avgTime: stats.avgTime },
          ]),
        ),
        errorCount: this.getErrors().length,
        totalTokens: events
          .filter(e => e.type === 'assistant_message')
          .reduce((acc, e) => acc + ((e as { usage?: { totalTokens?: number } }).usage?.totalTokens ?? 0), 0),
      }
    },

    search(query: string): SessionEvent[] {
      const lower = query.toLowerCase()
      return events.filter(e => {
        const json = JSON.stringify(e).toLowerCase()
        return json.includes(lower)
      })
    },
  }
}
