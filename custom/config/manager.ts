/**
 * ConfigManager — 声明式配置管理
 *
 * 读取 cordis.yml + 环境 patch，应用配置到 seams 和 extensions
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CordisConfig, CordisPatch, ExtensionConfig, SeamConfig } from './types.ts'
import { DEFAULT_CORDIS_CONFIG } from './types.ts'

export type { CordisConfig, CordisPatch, ExtensionConfig, SeamConfig }

// ============================================================================
// 配置管理器
// ============================================================================

export class ConfigManager {
  private config: CordisConfig = { ...DEFAULT_CORDIS_CONFIG }
  private patches: CordisPatch[] = []
  private watchers: Set<(config: CordisConfig) => void> = new Set()
  private filePath: string
  private environment: string

  constructor(filePath: string = 'cordis.yml', environment: string = 'development') {
    this.filePath = filePath
    this.environment = environment
  }

  /** 加载配置文件 */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf-8')
      const parsed = this.parseYaml(content)
      this.config = parsed as unknown as CordisConfig
    } catch {
      // 文件不存在，使用默认配置
      this.config = { ...DEFAULT_CORDIS_CONFIG }
    }

    // 加载环境 patch
    await this.loadPatches()

    // 应用 patches
    this.applyPatches()
  }

  /** 保存配置文件 */
  async save(): Promise<void> {
    const dir = dirname(this.filePath)
    await mkdir(dir, { recursive: true })

    const content = this.toYaml(this.config as unknown as Record<string, unknown>)
    await writeFile(this.filePath, content, 'utf-8')
  }

  /** 获取完整配置 */
  getConfig(): CordisConfig {
    return { ...this.config }
  }

  /** 获取扩展配置 */
  getExtension(id: string): ExtensionConfig | undefined {
    return this.config.extensions?.find(e => e.id === id)
  }

  /** 检查扩展是否启用 */
  isExtensionEnabled(id: string): boolean {
    const ext = this.getExtension(id)
    return ext?.enabled !== false
  }

  /** 获取缝隙配置 */
  getSeam(name: string): SeamConfig | undefined {
    return this.config.seams?.find(s => s.name === name)
  }

  /** 获取缝隙的当前 provider */
  getSeamProvider(name: string): string | undefined {
    return this.getSeam(name)?.provider
  }

  /** 获取全局配置 */
  getGlobal(): CordisConfig['global'] {
    return this.config.global
  }

  /** 更新扩展配置 */
  async updateExtension(id: string, updates: Partial<ExtensionConfig>): Promise<void> {
    const index = this.config.extensions?.findIndex(e => e.id === id) ?? -1

    if (index >= 0 && this.config.extensions) {
      this.config.extensions[index] = {
        ...this.config.extensions[index],
        ...updates,
      }
    } else if (this.config.extensions) {
      this.config.extensions.push({ id, ...updates })
    }

    await this.save()
    this.notifyWatchers()
  }

  /** 更新缝隙配置 */
  async updateSeam(name: string, updates: Partial<SeamConfig>): Promise<void> {
    const index = this.config.seams?.findIndex(s => s.name === name) ?? -1

    if (index >= 0 && this.config.seams) {
      this.config.seams[index] = {
        ...this.config.seams[index],
        ...updates,
      }
    } else if (this.config.seams) {
      this.config.seams.push({ name, ...updates } as SeamConfig)
    }

    await this.save()
    this.notifyWatchers()
  }

  /** 监听配置变更 */
  onChange(callback: (config: CordisConfig) => void): () => void {
    this.watchers.add(callback)
    return () => {
      this.watchers.delete(callback)
    }
  }

  /** 重置为默认配置 */
  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CORDIS_CONFIG }
    this.patches = []
    await this.save()
    this.notifyWatchers()
  }

  // ============================================================================
  // 内部方法
  // ============================================================================

  /** 加载环境 patches */
  private async loadPatches(): Promise<void> {
    this.patches = []

    // 加载环境特定 patch
    const envPatchPath = this.filePath.replace('.yml', `.${this.environment}.yml`)
    try {
      const content = await readFile(envPatchPath, 'utf-8')
      const patch = this.parseYaml(content) as CordisPatch
      this.patches.push(patch)
    } catch {
      // 环境 patch 不存在
    }
  }

  /** 应用 patches */
  private applyPatches(): void {
    for (const patch of this.patches) {
      // 应用扩展 patches
      if (patch.extensions && this.config.extensions) {
        for (const extPatch of patch.extensions) {
          const existing = this.config.extensions.find(e => e.id === extPatch.id)
          if (existing) {
            existing.config = { ...existing.config, ...extPatch.config }
          }
        }
      }

      // 应用缝隙 patches
      if (patch.seams && this.config.seams) {
        for (const seamPatch of patch.seams) {
          const existing = this.config.seams.find(s => s.name === seamPatch.name)
          if (existing) {
            existing.provider = seamPatch.provider
            if (seamPatch.config) {
              existing.config = { ...existing.config, ...seamPatch.config }
            }
          }
        }
      }
    }
  }

  /** 通知所有 watchers */
  private notifyWatchers(): void {
    for (const watcher of this.watchers) {
      try {
        watcher(this.config)
      } catch (error) {
        console.error('[ConfigManager] 变更通知错误:', error)
      }
    }
  }

  /** 简单 YAML 解析（仅支持基本格式） */
  private parseYaml(content: string): Record<string, unknown> {
    // 简单的 YAML 解析，实际项目应使用 js-yaml
    const lines = content.split('\n')
    const result: Record<string, unknown> = {}
    let currentKey = ''
    let currentObj: Record<string, unknown> = result

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const indent = line.length - line.trimStart().length

      if (indent === 0 && trimmed.includes(':')) {
        const [key, ...valueParts] = trimmed.split(':')
        const value = valueParts.join(':').trim()

        if (value) {
          result[key.trim()] = this.parseValue(value)
        } else {
          currentKey = key.trim()
          result[currentKey] = {}
          currentObj = result[currentKey] as Record<string, unknown>
        }
      } else if (indent > 0 && trimmed.includes(':')) {
        const [key, ...valueParts] = trimmed.split(':')
        const value = valueParts.join(':').trim()

        if (value) {
          currentObj[key.trim()] = this.parseValue(value)
        }
      }
    }

    return result
  }

  /** 解析 YAML 值 */
  private parseValue(value: string): unknown {
    if (value === 'true') return true
    if (value === 'false') return false
    if (value === 'null') return null
    if (/^\d+$/.test(value)) return parseInt(value, 10)
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1)
    }
    return value
  }

  /** 简单 YAML 序列化 */
  private toYaml(obj: Record<string, unknown>): string {
    const lines: string[] = []

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`${key}:`)
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          lines.push(`  ${k}: ${this.toYamlValue(v)}`)
        }
      } else {
        lines.push(`${key}: ${this.toYamlValue(value)}`)
      }
    }

    return lines.join('\n') + '\n'
  }

  /** 序列化 YAML 值 */
  private toYamlValue(value: unknown): string {
    if (typeof value === 'string') return `"${value}"`
    if (typeof value === 'boolean') return value.toString()
    if (typeof value === 'number') return value.toString()
    if (value === null) return 'null'
    if (Array.isArray(value)) {
      return `[${value.map(v => this.toYamlValue(v)).join(', ')}]`
    }
    return String(value)
  }
}

// ============================================================================
// 全局单例
// ============================================================================

let globalConfigManager: ConfigManager | null = null

/** 获取全局配置管理器 */
export function getConfigManager(): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager()
  }
  return globalConfigManager
}

/** 重置全局配置管理器（测试用） */
export function resetConfigManager(): void {
  globalConfigManager = null
}
