/**
 * 启动引导系统
 *
 * 负责：
 * 1. 加载 cordis.yml 配置
 * 2. 初始化 SeamRegistry
 * 3. 创建增强的 ExtensionAPI
 * 4. 发现并加载扩展
 */

import { ConfigManager, type CordisConfig } from './config/manager.ts'
import { initializeSeamRegistry, enhanceAPIWithSeams, type EnhancedExtensionAPI } from './integration.ts'
import { getSeamRegistry } from './seams/registry.ts'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { join } from 'node:path'
import { ExtensionLoader, createExtensionLoader } from './extension-loader.ts'

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
  /** 扩展加载器 */
  extensionLoader: ExtensionLoader
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

  console.log('[bootstrap] 启动 my-pi 框架...')

  // 1. 加载配置
  const configPath = join(root, 'custom', 'cordis.yml')
  const configManager = new ConfigManager(configPath)
  await configManager.load()
  const config = configManager.getConfig()
  console.log('[bootstrap] 配置加载完成')

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
  console.log('[bootstrap] SeamRegistry 初始化完成')

  // 4. 创建增强的 API
  const enhancedPi = enhanceAPIWithSeams(pi)

  // 5. 创建扩展加载器
  const extensionLoader = createExtensionLoader(root)

  // 6. 自动发现并加载扩展
  await extensionLoader.loadAll(enhancedPi)
  console.log(`[bootstrap] 已加载 ${extensionLoader.getLoaded().length} 个扩展`)

  // 7. 注入项目根目录到设置缝隙
  const settingsProvider = registry.getState('settings')
  if (settingsProvider && typeof settingsProvider === 'object') {
    const settingsImpl = settingsProvider as Record<string, unknown>
    if (typeof settingsImpl.setProjectRoot === 'function') {
      (settingsImpl.setProjectRoot as (root: string) => void)(root)
    }
  }

  console.log('[bootstrap] 框架启动完成')

  return {
    pi: enhancedPi,
    configManager,
    config,
    projectRoot: root,
    extensionLoader,
  }
}

// ============================================================================
// 优雅关闭
// ============================================================================

/**
 * 优雅关闭框架
 */
export async function shutdown(ctx: BootstrapContext): Promise<void> {
  console.log('[bootstrap] 开始关闭框架...')

  // 1. 卸载所有扩展
  await ctx.extensionLoader.unloadAll()

  // 2. 销毁所有缝隙
  const registry = getSeamRegistry()
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

  // 3. 保存配置
  await ctx.configManager.save()

  console.log('[bootstrap] 框架已关闭')
}
