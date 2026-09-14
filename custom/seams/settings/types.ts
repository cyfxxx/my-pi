import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 设置管理 缝隙接口
// ============================================================================

export interface SettingsService {
  /** 获取设置值 */
  get<T>(key: string): T | undefined
  /** 设置值 */
  set<T>(key: string, value: T): Promise<void>
  /** 删除设置 */
  delete(key: string): Promise<void>
  /** 列出所有设置 */
  all(): Record<string, unknown>
  /** 监听设置变更 */
  onChange(key: string, callback: (value: unknown) => void): () => void
}

export interface SettingsChange {
  key: string
  oldValue: unknown
  newValue: unknown
}

export const SETTINGS_SEAM_DEFINITION: ServiceDefinition<SettingsService> = {
  name: 'settings',
  description: '用户设置管理能力',
  defaultProvider: 'file',
}

export type SettingsProvider = ServiceProvider<SettingsService>
