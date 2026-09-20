/**
 * 扩展加载器 — 集成到主框架启动流程
 *
 * 负责：
 * 1. 发现 custom/extensions/ 下的扩展
 * 2. 按依赖顺序加载扩展
 * 3. 注入 seam 访问能力
 * 4. 处理扩展生命周期
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { EnhancedExtensionAPI } from './integration.ts'

// ============================================================================
// 扩展定义
// ============================================================================

export interface CustomExtension {
  /** 扩展 ID */
  id: string
  /** 扩展名称 */
  name: string
  /** 版本 */
  version: string
  /** 依赖的其他扩展 */
  dependencies?: string[]
  /** 初始化函数 */
  init: (pi: EnhancedExtensionAPI) => Promise<void> | void
  /** 销毁函数 */
  destroy?: () => Promise<void> | void
  /** 是否启用 */
  enabled?: boolean
}

// ============================================================================
// 扩展加载器
// ============================================================================

export class ExtensionLoader {
  private extensions: Map<string, CustomExtension> = new Map()
  private loaded: Set<string> = new Set()
  private projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  /**
   * 发现所有扩展
   */
  async discover(): Promise<CustomExtension[]> {
    const extensionsDir = join(this.projectRoot, 'custom', 'features')
    const entries = await readdir(extensionsDir, { withFileTypes: true })

    const extensions: CustomExtension[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const extPath = join(extensionsDir, entry.name)
      const manifestPath = join(extPath, 'manifest.json')

      try {
        // 尝试读取 manifest.json
        const { readFile } = await import('node:fs/promises')
        const manifestContent = await readFile(manifestPath, 'utf-8')
        const manifest = JSON.parse(manifestContent)

        // 动态导入扩展入口
        const entryFile = manifest.entry ?? 'index.ts'
        const entryPath = join(extPath, entryFile)
        const mod = await import(entryPath)

        const extension: CustomExtension = {
          id: manifest.id ?? entry.name,
          name: manifest.name ?? entry.name,
          version: manifest.version ?? '0.0.0',
          dependencies: manifest.dependencies ?? [],
          init: mod.init ?? mod.default?.init,
          destroy: mod.destroy ?? mod.default?.destroy,
          enabled: manifest.enabled ?? true,
        }

        extensions.push(extension)
      } catch (err) {
        // 如果没有 manifest.json，尝试直接导入 index.ts
        try {
          const entryPath = join(extPath, 'index.ts')
          const mod = await import(entryPath)

          if (mod.init || mod.default?.init) {
            extensions.push({
              id: entry.name,
              name: entry.name,
              version: '0.0.0',
              init: mod.init ?? mod.default?.init,
              destroy: mod.destroy ?? mod.default?.destroy,
              enabled: true,
            })
          }
        } catch {
          console.warn(`[ExtensionLoader] 无法加载扩展: ${entry.name}`, err)
        }
      }
    }

    return extensions
  }

  /**
   * 按依赖顺序排序
   */
  private sortByDependencies(extensions: CustomExtension[]): CustomExtension[] {
    const sorted: CustomExtension[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (ext: CustomExtension) => {
      if (visited.has(ext.id)) return
      if (visiting.has(ext.id)) {
        console.warn(`[ExtensionLoader] 检测到循环依赖: ${ext.id}`)
        return
      }

      visiting.add(ext.id)

      // 先加载依赖
      for (const depId of ext.dependencies ?? []) {
        const dep = extensions.find(e => e.id === depId)
        if (dep) {
          visit(dep)
        }
      }

      visiting.delete(ext.id)
      visited.add(ext.id)
      sorted.push(ext)
    }

    for (const ext of extensions) {
      visit(ext)
    }

    return sorted
  }

  /**
   * 加载所有扩展
   */
  async loadAll(pi: EnhancedExtensionAPI): Promise<void> {
    const extensions = await this.discover()
    const sorted = this.sortByDependencies(extensions)

    for (const ext of sorted) {
      if (ext.enabled === false) {
        console.log(`[ExtensionLoader] 跳过已禁用扩展: ${ext.id}`)
        continue
      }

      if (this.loaded.has(ext.id)) {
        console.log(`[ExtensionLoader] 扩展已加载: ${ext.id}`)
        continue
      }

      try {
        await ext.init(pi)
        this.extensions.set(ext.id, ext)
        this.loaded.add(ext.id)
        console.log(`[ExtensionLoader] 扩展加载成功: ${ext.id} v${ext.version}`)
      } catch (err) {
        console.error(`[ExtensionLoader] 扩展加载失败: ${ext.id}`, err)
      }
    }
  }

  /**
   * 卸载所有扩展
   */
  async unloadAll(): Promise<void> {
    // 反向卸载
    const loaded = Array.from(this.extensions.values()).reverse()

    for (const ext of loaded) {
      if (ext.destroy) {
        try {
          await ext.destroy()
          console.log(`[ExtensionLoader] 扩展卸载成功: ${ext.id}`)
        } catch (err) {
          console.error(`[ExtensionLoader] 扩展卸载失败: ${ext.id}`, err)
        }
      }
    }

    this.extensions.clear()
    this.loaded.clear()
  }

  /**
   * 获取已加载的扩展
   */
  getLoaded(): CustomExtension[] {
    return Array.from(this.extensions.values())
  }

  /**
   * 检查扩展是否已加载
   */
  isLoaded(id: string): boolean {
    return this.loaded.has(id)
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建扩展加载器
 */
export function createExtensionLoader(projectRoot: string): ExtensionLoader {
  return new ExtensionLoader(projectRoot)
}

/**
 * 加载所有扩展
 */
export async function loadAllExtensions(
  pi: EnhancedExtensionAPI,
  projectRoot: string,
): Promise<ExtensionLoader> {
  const loader = createExtensionLoader(projectRoot)
  await loader.loadAll(pi)
  return loader
}
