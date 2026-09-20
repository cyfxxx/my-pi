/**
 * core/config.ts - 便携化路径解析
 *
 * 统一管理所有路径解析，支持便携化运行
 */

import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

/**
 * 获取项目根目录
 */
export function getProjectRoot(): string {
  return process.env.MY_PI_ROOT || process.cwd()
}

/**
 * 获取配置目录
 */
export function getConfigDir(): string {
  return process.env.MY_PI_CONFIG_DIR || join(getProjectRoot(), 'portable', 'config')
}

/**
 * 获取会话目录
 */
export function getSessionsDir(): string {
  return process.env.MY_PI_SESSION_DIR || join(getProjectRoot(), 'portable', 'sessions')
}

/**
 * 获取扩展目录
 */
export function getExtensionsDir(): string {
  return process.env.MY_PI_EXTENSION_DIR || join(getProjectRoot(), 'portable', 'extensions')
}

/**
 * 获取技能目录
 */
export function getSkillsDir(): string {
  return process.env.MY_PI_SKILLS_DIR || join(getProjectRoot(), 'portable', 'skills')
}

/**
 * 获取记忆目录
 */
export function getMemoryDir(): string {
  return process.env.MY_PI_MEMORY_DIR || join(getProjectRoot(), 'portable', 'memory')
}

/**
 * 获取设置文件路径
 */
export function getSettingsPath(): string {
  return join(getConfigDir(), 'settings.json')
}

/**
 * 获取认证文件路径
 */
export function getAuthPath(): string {
  return join(getConfigDir(), 'auth.json')
}

/**
 * 读取设置文件
 */
export function readSettings(): Record<string, unknown> {
  const path = getSettingsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

/**
 * 获取包目录（用于覆盖 pi 的 getPackageDir）
 */
export function getPackageDir(packageName?: string): string {
  if (packageName) {
    return join(getProjectRoot(), 'vendor', 'pi', 'packages', packageName)
  }
  return join(getProjectRoot(), 'vendor', 'pi')
}
