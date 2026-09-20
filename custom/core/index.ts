/**
 * core/index.ts - 核心服务统一导出
 */

export {
  getProjectRoot,
  getConfigDir,
  getSessionsDir,
  getExtensionsDir,
  getSkillsDir,
  getMemoryDir,
  getSettingsPath,
  getAuthPath,
  readSettings,
  getPackageDir,
} from './config'

export {
  FeatureRegistry,
  getRegistry,
} from './registry'

export type { Feature } from './registry'
