/**
 * services/session/session-export.ts - 会话导出服务
 *
 * 从 agent-session.ts 提取的纯 I/O 逻辑
 */

/**
 * 导出选项
 */
export interface ExportOptions {
  includeMetadata?: boolean
  includeToolResults?: boolean
  format?: 'full' | 'compact'
}

/**
 * 会话管理器接口
 */
export interface SessionManagerInterface {
  getEntries(): SessionEntry[]
  getHeader(): SessionHeader
}

/**
 * 会话条目
 */
export interface SessionEntry {
  type: string
  role?: string
  content?: string
  toolName?: string
  timestamp?: number
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
 * 导出为 HTML
 */
export async function exportSessionToHtml(
  sm: SessionManagerInterface,
  options?: ExportOptions,
): Promise<string> {
  const header = sm.getHeader()
  const entries = sm.getEntries()

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Session ${header.id}</title>
  <style>
    body { font-family: monospace; margin: 20px; }
    .message { margin: 10px 0; padding: 10px; border-radius: 5px; }
    .user { background-color: #e3f2fd; }
    .assistant { background-color: #f3e5f5; }
    .tool { background-color: #fff3e0; }
  </style>
</head>
<body>
  <h1>Session ${header.id}</h1>
  <p>CWD: ${header.cwd}</p>
  <p>Created: ${new Date(header.timestamp).toISOString()}</p>
  <hr>
  ${entries.map((entry) => formatEntryHtml(entry)).join('\n')}
</body>
</html>`

  return html
}

/**
 * 格式化条目为 HTML
 */
function formatEntryHtml(entry: SessionEntry): string {
  switch (entry.type) {
    case 'message':
      const roleClass = entry.role === 'user' ? 'user' : 'assistant'
      return `<div class="message ${roleClass}"><strong>${entry.role}:</strong> ${entry.content}</div>`
    case 'toolResult':
      return `<div class="message tool"><strong>${entry.toolName}:</strong> ${entry.content}</div>`
    default:
      return `<div class="message">${entry.type}: ${entry.content}</div>`
  }
}

/**
 * 导出为 JSONL
 */
export function exportSessionToJsonl(
  sm: SessionManagerInterface,
  outputPath?: string,
): string {
  const header = sm.getHeader()
  const entries = sm.getEntries()

  const lines = [
    JSON.stringify({ type: 'header', ...header }),
    ...entries.map((entry) => JSON.stringify(entry)),
  ]

  return lines.join('\n')
}
