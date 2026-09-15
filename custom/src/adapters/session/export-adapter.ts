/**
 * adapters/session/export-adapter.ts - 会话导出适配器
 *
 * 桥接会话导出，提供稳定的导出接口
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/**
 * 导出选项
 */
export interface ExportOptions {
  includeMetadata?: boolean
  includeToolResults?: boolean
  format?: 'full' | 'compact'
}

/**
 * 创建会话导出适配器
 */
export function createExportAdapter(pi: ExtensionAPI) {
  return {
    /**
     * 导出为 HTML
     */
    async exportToHtml(options?: ExportOptions): Promise<string> {
      // 默认实现
      return '<html><body>Session export not implemented</body></html>'
    },
    
    /**
     * 导出为 JSONL
     */
    async exportToJsonl(options?: ExportOptions): Promise<string> {
      // 默认实现
      return ''
    },
    
    /**
     * 导出为 Markdown
     */
    async exportToMarkdown(options?: ExportOptions): Promise<string> {
      // 默认实现
      return '# Session Export\n\nNot implemented'
    },
  }
}

/**
 * 会话导出器类
 * 提供更高级的导出功能
 */
export class SessionExporter {
  private pi: ExtensionAPI
  private adapter: ReturnType<typeof createExportAdapter>
  
  constructor(pi: ExtensionAPI) {
    this.pi = pi
    this.adapter = createExportAdapter(pi)
  }
  
  /**
   * 导出会话
   */
  async export(format: 'html' | 'jsonl' | 'markdown', options?: ExportOptions): Promise<string> {
    switch (format) {
      case 'html':
        return this.adapter.exportToHtml(options)
      case 'jsonl':
        return this.adapter.exportToJsonl(options)
      case 'markdown':
        return this.adapter.exportToMarkdown(options)
      default:
        throw new Error(`Unsupported export format: ${format}`)
    }
  }
}
