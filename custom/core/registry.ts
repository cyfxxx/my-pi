/**
 * core/registry.ts - 功能注册表
 *
 * 管理已注册的功能模块
 */

export interface Feature {
  id: string
  name: string
  version: string
  enabled: boolean
  init?: () => Promise<void> | void
  destroy?: () => Promise<void> | void
}

/**
 * 功能注册表
 */
export class FeatureRegistry {
  private features: Map<string, Feature> = new Map()

  /**
   * 注册功能
   */
  register(feature: Feature): void {
    this.features.set(feature.id, feature)
  }

  /**
   * 获取功能
   */
  get(id: string): Feature | undefined {
    return this.features.get(id)
  }

  /**
   * 获取所有已注册功能
   */
  getAll(): Feature[] {
    return Array.from(this.features.values())
  }

  /**
   * 获取所有已启用功能
   */
  getEnabled(): Feature[] {
    return this.getAll().filter(f => f.enabled)
  }

  /**
   * 启用功能
   */
  enable(id: string): boolean {
    const feature = this.features.get(id)
    if (feature) {
      feature.enabled = true
      return true
    }
    return false
  }

  /**
   * 禁用功能
   */
  disable(id: string): boolean {
    const feature = this.features.get(id)
    if (feature) {
      feature.enabled = false
      return true
    }
    return false
  }

  /**
   * 初始化所有已启用功能
   */
  async initAll(): Promise<void> {
    for (const feature of this.getEnabled()) {
      if (feature.init) {
        try {
          await feature.init()
        } catch (err) {
          console.error(`[FeatureRegistry] 初始化功能 ${feature.id} 失败:`, err)
        }
      }
    }
  }

  /**
   * 销毁所有功能
   */
  async destroyAll(): Promise<void> {
    for (const feature of this.getAll().reverse()) {
      if (feature.destroy) {
        try {
          await feature.destroy()
        } catch (err) {
          console.error(`[FeatureRegistry] 销毁功能 ${feature.id} 失败:`, err)
        }
      }
    }
  }
}

/**
 * 全局注册表实例
 */
let globalRegistry: FeatureRegistry | null = null

export function getRegistry(): FeatureRegistry {
  if (!globalRegistry) {
    globalRegistry = new FeatureRegistry()
  }
  return globalRegistry
}
