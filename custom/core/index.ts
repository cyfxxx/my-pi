/**
 * core/index.ts - 核心服务统一导出
 */

export {
  getProjectRoot,
  getPortableRoot,
  getAgentDir,
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
export { writeJSONSync, writeTextSync, writeJSONAtomic } from './atomic-write'
export { isBlockedHost, isUrlAllowed } from './net-guard'
export { ensureDir, readJSONSync, readJSONOr, readJSONL, appendJSONL, appendJSONLRotating } from './fs-json'
export { localDay, truncateChars, oneLine, formatTokens } from './text'
export { parseSubcommand, filterCompletions } from './cli'
