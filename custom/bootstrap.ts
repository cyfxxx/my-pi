/**
 * 启动引导系统
 *
 * 负责：
 * 1. 加载 cordis.yml 配置
 * 2. 初始化 SeamRegistry
 * 3. 创建增强的 ExtensionAPI
 * 4. 加载并激活扩展
 */

import { ConfigManager, type CordisConfig } from './config/manager.ts'
import { initializeSeamRegistry, enhanceAPIWithSeams, type EnhancedExtensionAPI } from './integration.ts'
import { getSeamRegistry } from './seams/registry.ts'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { join } from 'node:path'

// ============================================================================
// 启动上下文
// ============================================================================

export interface BootstrapContext {
  /** 增强后的 ExtensionAPI（包含 seam 命名空间） */
  pi: EnhancedExtensionAPI
  /** 配置管理器 */
  configManager: ConfigManager
  /** 当前配置 */
  config: CordisConfig
  /** 项目根目录 */
  projectRoot: string
}

// ============================================================================
// 启动函数
// ============================================================================

/**
 * 启动 my-pi 框架
 *
 * @param pi - 原始 ExtensionAPI
 * @param projectRoot - 项目根目录（默认 process.cwd()）
 * @returns BootstrapContext
 */
export async function bootstrap(
  pi: ExtensionAPI,
  projectRoot?: string,
): Promise<BootstrapContext> {
  const root = projectRoot ?? process.cwd()

  // 1. 加载配置
  const configPath = join(root, 'custom', 'cordis.yml')
  const configManager = new ConfigManager(configPath)
  await configManager.load()
  const config = configManager.getConfig()

  // 2. 初始化 SeamRegistry
  initializeSeamRegistry()

  // 3. 根据配置启用/禁用缝隙
  const registry = getSeamRegistry()
  if (config.seams) {
    for (const seamConfig of config.seams) {
      if (seamConfig.provider) {
        try {
          await registry.switchProvider(seamConfig.name, seamConfig.provider)
        } catch (err) {
          console.warn(`[bootstrap] 切换缝隙 ${seamConfig.name} provider 失败:`, err)
        }
      }
    }
  }

  // 4. 根据配置启用/禁用扩展
  if (config.extensions) {
    for (const extConfig of config.extensions) {
      if (!extConfig.enabled) {
        console.log(`[bootstrap] 跳过已禁用扩展: ${extConfig.id}`)
      }
    }
  }

  // 5. 创建增强的 API
  const enhancedPi = enhanceAPIWithSeams(pi)

  // 6. 注入项目根目录到设置缝隙
  const settingsProvider = registry.getState('settings')
  if (settingsProvider && typeof settingsProvider === 'object') {
    // 如果 settings provider 支持设置项目根目录
    const settingsImpl = settingsProvider as Record<string, unknown>
    if (typeof settingsImpl.setProjectRoot === 'function') {
      (settingsImpl.setProjectRoot as (root: string) => void)(root)
    }
  }

  return {
    pi: enhancedPi,
    configManager,
    config,
    projectRoot: root,
  }
}

// ============================================================================
// 扩展加载器
// ============================================================================

/**
 * 加载扩展并注入 seam 访问能力
 */
export async function loadExtensions(
  ctx: BootstrapContext,
  extensions: Array<{ id: string; init: (pi: EnhancedExtensionAPI) => Promise<void> | void }>,
): Promise<void> {
  for (const ext of extensions) {
    // 检查是否在配置中被禁用
    const extConfig = ctx.config.extensions?.find(e => e.id === ext.id)
    if (extConfig?.enabled === false) {
      console.log(`[bootstrap] 跳过已禁用扩展: ${ext.id}`)
      continue
    }

    try {
      await ext.init(ctx.pi)
      console.log(`[bootstrap] 扩展加载成功: ${ext.id}`)
    } catch (err) {
      console.error(`[bootstrap] 扩展加载失败: ${ext.id}`, err)
    }
  }
}

// ============================================================================
// 优雅关闭
// ============================================================================

/**
 * 优雅关闭框架
 */
export async function shutdown(ctx: BootstrapContext): Promise<void> {
  const registry = getSeamRegistry()

  // 销毁所有缝隙
  const seams = ['shell', 'fs', 'sandbox', 'credentials', 'interaction', 'settings', 'session-title', 'todo'] as const

  for (const seam of seams) {
    try {
      const state = registry.getState(seam)
      if (state && typeof state === 'object') {
        const destroy = (state as Record<string, unknown>).destroy
        if (typeof destroy === 'function') {
          await (destroy as () => Promise<void>)()
        }
      }
    } catch (err) {
      console.warn(`[bootstrap] 关闭缝隙 ${seam} 失败:`, err)
    }
  }

  // 保存配置
  await ctx.configManager.save()

  console.log('[bootstrap] 框架已关闭')
}
