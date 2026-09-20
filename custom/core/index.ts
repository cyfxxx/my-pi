/**
 * core/index.ts - 核心服务统一导出
 */

export {
  getProjectRoot,
  getPortableRoot,
  getConfigDir,
  getSessionDir,
  getExtensionDir,
  getSkillsDir,
  getMemoryDir,
  getVendorPiDir,
  ensureDirectories,
  getEnv,
} from './config'

export {
  defineFeature,
  registerAll,
} from './registry'
