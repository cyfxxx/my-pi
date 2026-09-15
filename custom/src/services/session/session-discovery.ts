/**
 * services/session/session-discovery.ts - 会话发现服务
 *
 * 从 session-manager.ts 提取的纯文件系统扫描逻辑
 */

import { readdir, readFile } from 'fs/promises'
import { join, basename } from 'path'

/**
 * 会话信息
 */
export interface SessionInfo {
  path: string
  id: string
  timestamp: number
  cwd: string
  displayName?: string
}

/**
 * 进度回调
 */
export interface SessionListProgress {
  (processed: number, total: number): void
}

/**
 * 会话头部
 */
export interface SessionHeader {
  id: string
  version: number
  timestamp: number
  cwd: string
}

/**
 * 发现会话列表
 */
export async function discoverSessions(
  sessionDir: string,
  options?: { cwd?: string; onProgress?: SessionListProgress },
): Promise<SessionInfo[]> {
  const { cwd, onProgress } = options ?? {}
  
  const files = await readdir(sessionDir)
  const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'))
  
  const sessions: SessionInfo[] = []
  let processed = 0
  
  for (const file of jsonlFiles) {
    try {
      const filePath = join(sessionDir, file)
      const content = await readFile(filePath, 'utf-8')
      const firstLine = content.split('\n')[0]
      
      if (firstLine) {
        const header: SessionHeader = JSON.parse(firstLine)
        
        // 如果指定了 cwd，只返回匹配的会话
        if (cwd && header.cwd !== cwd) {
          continue
        }
        
        sessions.push({
          path: filePath,
          id: header.id,
          timestamp: header.timestamp,
          cwd: header.cwd,
        })
      }
    } catch (error) {
      // 忽略无法解析的文件
      console.warn(`Failed to parse session file: ${file}`, error)
    }
    
    processed++
    onProgress?.(processed, jsonlFiles.length)
  }
  
  // 按时间戳排序（最新的在前）
  sessions.sort((a, b) => b.timestamp - a.timestamp)
  
  return sessions
}

/**
 * 从文件名提取时间戳
 */
export function extractTimestampFromFilename(filename: string): number | null {
  const match = basename(filename).match(/^(\d+)_/)
  if (match) {
    return parseInt(match[1], 10)
  }
  return null
}
