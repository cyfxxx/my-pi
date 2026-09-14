/**
 * pi-context 迁移示例
 *
 * 展示如何将现有扩展迁移到 seams 架构
 *
 * 迁移前：
 *   import { execSync } from 'node:child_process'
 *   import { readFileSync, writeFileSync } from 'node:fs'
 *
 * 迁移后：
 *   import { createShellAdapter, createFSAdapter } from '../seams/adapter.ts'
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createShellAdapter, createFSAdapter } from '../../seams/adapter.ts'
import type { EnhancedExtensionAPI } from '../../integration.ts'

// ============================================================================
// 迁移前（原始代码）
// ============================================================================

/**
 * 原始 pi-context 实现
 * - 直接使用 execSync 调用 git 命令
 * - 直接使用 readFileSync 读取文件
 */
export function _originalContext(_pi: ExtensionAPI) {
  // const { execSync } = require('node:child_process')
  // const { readFileSync } = require('node:fs')

  // const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' })
  // const packageJson = readFileSync('package.json', 'utf-8')

  return {
    name: 'pi-context',
    // ...
  }
}

// ============================================================================
// 迁移后（使用 seams）
// ============================================================================

/**
 * 迁移后的 pi-context 实现
 * - 使用 shell seam 执行 git 命令
 * - 使用 fs seam 读取文件
 */
export async function migratedContext(pi: EnhancedExtensionAPI) {
  const shell = createShellAdapter(pi)
  const fs = createFSAdapter(pi)

  // 获取 git 状态
  const gitStatus = await shell.exec('git status --porcelain')

  // 读取 package.json
  const packageJson = await fs.readFile('package.json')

  // 获取 git diff
  const gitDiff = await shell.exec('git diff --cached --stat')

  return {
    name: 'pi-context',
    getGitStatus: () => gitStatus,
    getPackageJson: () => packageJson,
    getGitDiff: () => gitDiff,
  }
}

// ============================================================================
// 渐进式迁移策略
// ============================================================================

/**
 * 步骤 1：创建适配器包装器
 *
 * 在扩展入口处创建适配器实例
 */
export function step1_createAdapters(pi: EnhancedExtensionAPI) {
  const shell = createShellAdapter(pi)
  const fs = createFSAdapter(pi)

  return { shell, fs }
}

/**
 * 步骤 2：替换直接 API 调用
 *
 * 将 execSync 替换为 shell.exec
 * 将 readFileSync 替换为 fs.readFile
 */
export async function step2_replaceAPICalls(
  shell: ReturnType<typeof createShellAdapter>,
  fs: ReturnType<typeof createFSAdapter>,
) {
  // 旧：execSync('git status', { encoding: 'utf-8' })
  // 新：
  const status = await shell.exec('git status')

  // 旧：readFileSync('file.txt', 'utf-8')
  // 新：
  const content = await fs.readFile('file.txt')

  return { status, content }
}

/**
 * 步骤 3：添加错误处理
 *
 * seams 提供统一的错误处理
 */
export async function step3_addErrorHandling(
  shell: ReturnType<typeof createShellAdapter>,
) {
  try {
    const result = await shell.execFull('git status')
    return result.stdout
  } catch (error) {
    // seams 提供结构化错误信息
    console.error('Git command failed:', error)
    return ''
  }
}

/**
 * 步骤 4：测试迁移
 *
 * 确保功能与原始实现一致
 */
export async function step4_testMigration(
  shell: ReturnType<typeof createShellAdapter>,
) {
  // 验证 shell 适配器工作正常
  const hasGit = await shell.hasCommand('git')
  if (!hasGit) {
    throw new Error('Git is not installed')
  }

  const result = await shell.exec('git --version')
  if (!result.includes('git version')) {
    throw new Error('Git version check failed')
  }

  return true
}
