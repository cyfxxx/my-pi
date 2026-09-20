/**
 * browser helpers — shared utilities for tool registrations
 */
import type { BrowserManager } from './impl'

export type RecordUsage = (name: string, tokens: number) => void

export function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + `\n\n…… [已截断，共 ${s.length} 字符]`
}

export function toolResult(text: string, _toolName: string, recordUsage?: RecordUsage): { content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> } {
  if (recordUsage) recordUsage(_toolName, Math.ceil(text.length / 4))
  return { content: [{ type: 'text' as const, text }], details: {} }
}

export function createRequirePage(browser: BrowserManager): () => void {
  return () => {
    if (!browser.isPageActive()) {
      throw new Error('尚未打开任何页面。请先调用 browser_navigate。')
    }
  }
}