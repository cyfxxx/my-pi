/**
 * 能力缝隙注册表（Seam Registry）
 *
 * 管理所有缝隙的定义、provider 和消费者
 */

import type {
  SeamName,
  ProviderName,
  SeamState,
  ServiceDefinition,
  ServiceProvider,
  SeamConsumer,
  SeamRegistry,
  SeamDefinition,
} from './types.ts'

// ============================================================================
// 错误定义
// ============================================================================

export class SeamError extends Error {
  public readonly seam: SeamName
  public readonly code: string

  constructor(message: string, seam: SeamName, code: string) {
    super(`[Seam:${seam}] ${message}`)
    this.name = 'SeamError'
    this.seam = seam
    this.code = code
  }
}

// ============================================================================
// SeamRegistry 实现
// ============================================================================

export class DefaultSeamRegistry implements SeamRegistry {
  private seams = new Map<SeamName, SeamDefinition>()

  /** 定义一个缝隙 */
  define<T>(definition: ServiceDefinition<T>): void {
    if (this.seams.has(definition.name)) {
      throw new SeamError(
        `缝隙 "${definition.name}" 已定义`,
        definition.name,
        'ALREADY_DEFINED'
      )
    }

    this.seams.set(definition.name, {
      definition,
      providers: new Map(),
      currentProvider: definition.defaultProvider,
      consumers: [],
      state: 'defined',
    })
  }

  /** 提供一个 provider */
  provide<T>(provider: ServiceProvider<T>): void {
    const seam = this.seams.get(provider.seam)
    if (!seam) {
      throw new SeamError(
        `缝隙 "${provider.seam}" 未定义`,
        provider.seam,
        'NOT_DEFINED'
      )
    }

    if (seam.providers.has(provider.name)) {
      throw new SeamError(
        `Provider "${provider.name}" 已存在`,
        provider.seam,
        'PROVIDER_EXISTS'
      )
    }

    seam.providers.set(provider.name, provider as ServiceProvider)
  }

  /** 注册一个消费者 */
  registerConsumer(consumer: SeamConsumer): void {
    const seam = this.seams.get(consumer.seam)
    if (!seam) {
      throw new SeamError(
        `缝隙 "${consumer.seam}" 未定义`,
        consumer.seam,
        'NOT_DEFINED'
      )
    }

    seam.consumers.push(consumer)
  }

  /** 消费一个缝隙的服务 */
  consume<T>(seamName: SeamName): T {
    const seam = this.seams.get(seamName)
    if (!seam) {
      throw new SeamError(
        `缝隙 "${seamName}" 未定义`,
        seamName,
        'NOT_DEFINED'
      )
    }

    if (seam.state === 'error') {
      throw new SeamError(
        `缝隙 "${seamName}" 处于错误状态`,
        seamName,
        'SEAM_ERROR'
      )
    }

    const provider = seam.providers.get(seam.currentProvider)
    if (!provider) {
      throw new SeamError(
        `Provider "${seam.currentProvider}" 不存在`,
        seamName,
        'PROVIDER_NOT_FOUND'
      )
    }

    return provider.impl as T
  }

  /** 切换 provider */
  async switchProvider(seamName: SeamName, providerName: ProviderName): Promise<void> {
    const seam = this.seams.get(seamName)
    if (!seam) {
      throw new SeamError(
        `缝隙 "${seamName}" 未定义`,
        seamName,
        'NOT_DEFINED'
      )
    }

    const newProvider = seam.providers.get(providerName)
    if (!newProvider) {
      throw new SeamError(
        `Provider "${providerName}" 不存在`,
        seamName,
        'PROVIDER_NOT_FOUND'
      )
    }

    // 销毁旧 provider
    const oldProvider = seam.providers.get(seam.currentProvider)
    if (oldProvider?.destroy) {
      await oldProvider.destroy()
    }

    // 初始化新 provider
    if (newProvider.init) {
      await newProvider.init()
    }

    seam.currentProvider = providerName
    seam.state = 'active'
  }

  /** 获取缝隙状态 */
  getState(seamName: SeamName): SeamState {
    const seam = this.seams.get(seamName)
    return seam?.state ?? 'defined'
  }

  /** 获取当前 provider */
  getProvider(seamName: SeamName): ProviderName {
    const seam = this.seams.get(seamName)
    if (!seam) {
      throw new SeamError(
        `缝隙 "${seamName}" 未定义`,
        seamName,
        'NOT_DEFINED'
      )
    }
    return seam.currentProvider
  }

  /** 列出所有缝隙 */
  list(): SeamDefinition[] {
    return Array.from(this.seams.values())
  }

  /** 销毁所有缝隙 */
  async destroyAll(): Promise<void> {
    for (const [name, seam] of this.seams) {
      const provider = seam.providers.get(seam.currentProvider)
      if (provider?.destroy) {
        try {
          await provider.destroy()
        } catch (error) {
          console.error(`[SeamRegistry] 销毁缝隙 "${name}" 失败:`, error)
        }
      }
      seam.state = 'inactive'
    }
  }

  /** 初始化所有缝隙（调用默认 provider 的 init） */
  async initializeAll(): Promise<void> {
    for (const [name, seam] of this.seams) {
      const provider = seam.providers.get(seam.currentProvider)
      if (provider?.init) {
        try {
          await provider.init()
          seam.state = 'active'
        } catch (error) {
          seam.state = 'error'
          console.error(`[SeamRegistry] 初始化缝隙 "${name}" 失败:`, error)
        }
      }
    }
  }
}

// ============================================================================
// 全局单例
// ============================================================================

let globalRegistry: SeamRegistry | null = null

/** 获取全局缝隙注册表 */
export function getSeamRegistry(): SeamRegistry {
  if (!globalRegistry) {
    globalRegistry = new DefaultSeamRegistry()
  }
  return globalRegistry
}

/** 重置全局缝隙注册表（测试用） */
export function resetSeamRegistry(): void {
  globalRegistry = null
}
