/**
 * 能力缝隙（Capability Seam）核心类型定义
 *
 * 每个能力缝隙由三角色组成：
 * 1. Service Definition — 声明接口
 * 2. Service Provider — 实现接口
 * 3. Consumer — 消费服务（通常是模型工具）
 */

// ============================================================================
// 基础类型
// ============================================================================

/** 缝隙名称，全局唯一 */
export type SeamName = string

/** Provider 名称，在一个缝隙内唯一 */
export type ProviderName = string

/** 缝隙状态 */
export type SeamState = 'defined' | 'active' | 'inactive' | 'error'

// ============================================================================
// Service Definition（接口声明）
// ============================================================================

/**
 * 服务定义 — 声明一个能力缝隙的接口
 *
 * @template T — 服务接口类型
 */
export interface ServiceDefinition<T = unknown> {
  /** 缝隙名称（全局唯一） */
  name: SeamName
  /** 服务接口描述 */
  description: string
  /** 默认 provider 名称 */
  defaultProvider: ProviderName
  /** 服务接口的 TypeScript 类型（运行时用于类型检查） */
  schema?: T
  /** 缝隙依赖的其他缝隙 */
  dependencies?: SeamName[]
  /** 是否可选（缺失时不报错） */
  optional?: boolean
}

// ============================================================================
// Service Provider（实现）
// ============================================================================

/**
 * 服务提供者 — 实现一个能力缝隙的接口
 *
 * @template T — 服务接口类型
 */
export interface ServiceProvider<T = unknown> {
  /** Provider 名称 */
  name: ProviderName
  /** 所属缝隙 */
  seam: SeamName
  /** Provider 描述 */
  description: string
  /** 服务实现 */
  impl: T
  /** 初始化（可选） */
  init?(): Promise<void>
  /** 销毁（可选） */
  destroy?(): Promise<void>
  /** 健康检查（可选） */
  healthCheck?(): Promise<boolean>
}

// ============================================================================
// Consumer（消费）
// ============================================================================

/**
 * 服务消费者 — 使用一个能力缝隙的接口
 */
export interface SeamConsumer {
  /** 消费者名称 */
  name: string
  /** 依赖的缝隙 */
  seam: SeamName
  /** 消费者类型 */
  type: 'tool' | 'event' | 'service'
  /** 绑定到 provider（运行时注入） */
  bind(provider: unknown): void
}

// ============================================================================
// 缝隙注册表接口
// ============================================================================

/**
 * 缝隙注册表 — 管理所有缝隙的定义、provider 和消费者
 */
export interface SeamRegistry {
  /** 定义一个缝隙 */
  define<T>(definition: ServiceDefinition<T>): void
  /** 提供一个 provider */
  provide<T>(provider: ServiceProvider<T>): void
  /** 注册一个消费者 */
  registerConsumer(consumer: SeamConsumer): void
  /** 消费一个缝隙的服务 */
  consume<T>(seam: SeamName): T
  /** 切换 provider */
  switchProvider(seam: SeamName, provider: ProviderName): Promise<void>
  /** 获取缝隙状态 */
  getState(seam: SeamName): SeamState
  /** 获取当前 provider */
  getProvider(seam: SeamName): ProviderName
  /** 列出所有缝隙 */
  list(): SeamDefinition[]
  /** 销毁所有缝隙 */
  destroyAll(): Promise<void>
}

/** 缝隙完整定义（含运行时状态） */
export interface SeamDefinition {
  definition: ServiceDefinition
  providers: Map<ProviderName, ServiceProvider>
  currentProvider: ProviderName
  consumers: SeamConsumer[]
  state: SeamState
}

// ============================================================================
// ExtensionAPI 扩展
// ============================================================================

/**
 * 扩展 API 的缝隙命名空间
 */
export interface SeamAPI {
  /** 定义一个缝隙 */
  define<T>(definition: ServiceDefinition<T>): void
  /** 提供一个 provider */
  provide<T>(provider: ServiceProvider<T>): void
  /** 消费一个缝隙的服务 */
  consume<T>(seam: SeamName): T
  /** 切换 provider */
  switchProvider(seam: SeamName, provider: ProviderName): Promise<void>
  /** 获取缝隙状态 */
  getState(seam: SeamName): SeamState
}
