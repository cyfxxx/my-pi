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

export { scrubSecrets, SECRET_PATTERNS } from './secrets'
export { writeJSONSync, writeJSONAtomic } from './atomic-write'
export {
  dataDir,
  notesFile,
  checkpointsDir,
  ensureDir,
  loadNotes,
  saveNotes,
  updateNotes,
  clearCompactionFlag,
  getTotalSize,
} from './note-store'
