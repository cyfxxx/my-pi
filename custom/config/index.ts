/**
 * Cordis 配置系统
 */

export type {
  ExtensionConfig,
  SeamConfig,
  CordisConfig,
  CordisPatch,
} from './types.ts'

export { DEFAULT_CORDIS_CONFIG } from './types.ts'

export { ConfigManager, getConfigManager, resetConfigManager } from './manager.ts'
