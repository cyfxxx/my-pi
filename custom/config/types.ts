/**
 * Cordis 配置格式定义
 *
 * 声明式插件组合配置
 */

// ============================================================================
// 扩展配置
// ============================================================================

export interface ExtensionConfig {
  /** 扩展 ID */
  id: string
  /** 是否启用 */
  enabled?: boolean
  /** 扩展配置 */
  config?: Record<string, unknown>
}

// ============================================================================
// 缝隙配置
// ============================================================================

export interface SeamConfig {
  /** 缝隙名称 */
  name: string
  /** 当前 provider */
  provider: string
  /** provider 配置 */
  config?: Record<string, unknown>
}

// ============================================================================
// 主配置
// ============================================================================

export interface CordisConfig {
  /** 扩展配置列表 */
  extensions?: ExtensionConfig[]
  /** 缝隙配置列表 */
  seams?: SeamConfig[]
  /** 全局配置 */
  global?: {
    /** 日志级别 */
    logLevel?: 'debug' | 'info' | 'warn' | 'error'
    /** 是否启用 session log */
    sessionLog?: boolean
    /** session log 路径 */
    sessionLogPath?: string
  }
}

// ============================================================================
// Patch 配置（环境覆盖）
// ============================================================================

export interface CordisPatch {
  /** 要 patch 的扩展 */
  extensions?: Array<{
    id: string
    config: Record<string, unknown>
  }>
  /** 要 patch 的缝隙 */
  seams?: Array<{
    name: string
    provider: string
    config?: Record<string, unknown>
  }>
}

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_CORDIS_CONFIG: CordisConfig = {
  extensions: [
    { id: 'pi-context', enabled: true },
    { id: 'plan-mode', enabled: true },
    { id: 'pi-memory', enabled: true },
    { id: 'pi-autopilot', enabled: true },
    { id: 'pi-web-search', enabled: true },
    { id: 'pi-browser', enabled: true },
    { id: 'pi-intervention', enabled: true },
    { id: 'pi-link', enabled: true },
    { id: 'pi-tmux', enabled: true },
    { id: 'pi-mode', enabled: true },
    { id: 'pi-voice', enabled: true },
    { id: 'subagent', enabled: true },
  ],
  seams: [
    { name: 'shell', provider: 'local' },
    { name: 'fs', provider: 'local' },
    { name: 'search', provider: 'local' },
    { name: 'sandbox', provider: 'null' },
    { name: 'llm', provider: 'google' },
    { name: 'subagent', provider: 'local' },
    { name: 'credentials', provider: 'env' },
    { name: 'interaction', provider: 'terminal' },
    { name: 'settings', provider: 'file' },
    { name: 'session-log', provider: 'jsonl' },
    { name: 'webhook', provider: 'http' },
    { name: 'session-title', provider: 'llm' },
    { name: 'todo', provider: 'store' },
  ],
  global: {
    logLevel: 'info',
    sessionLog: true,
    sessionLogPath: '.pi/session-log.jsonl',
  },
}
