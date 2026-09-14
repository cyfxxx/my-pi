/**
 * SeamRegistry 与 ExtensionAPI 的集成层
 *
 * 将 SeamRegistry 注入到扩展 API 中，使扩展可以使用 seam 命名空间
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { SeamRegistry, SeamAPI, ServiceDefinition, ServiceProvider, SeamName, ProviderName, SeamState } from './seams/types.ts'
import { getSeamRegistry } from './seams/registry.ts'
import { localShellProvider } from './seams/shell/local-provider.ts'
import { localFSProvider } from './seams/fs/local-provider.ts'
import { nullSandboxProvider } from './seams/sandbox/null-provider.ts'
import { envCredentialsProvider } from './seams/credentials/env-provider.ts'
import { terminalInteractionProvider } from './seams/interaction/terminal-provider.ts'
import { fileSettingsProvider } from './seams/settings/file-provider.ts'
import { llmSessionTitleProvider } from './seams/session-title/llm-provider.ts'
import { storeTodoProvider } from './seams/todo/store-provider.ts'
import {
  SHELL_SEAM_DEFINITION,
  FS_SEAM_DEFINITION,
  SANDBOX_SEAM_DEFINITION,
  CREDENTIALS_SEAM_DEFINITION,
  INTERACTION_SEAM_DEFINITION,
  SETTINGS_SEAM_DEFINITION,
  SESSION_TITLE_SEAM_DEFINITION,
  TODO_SEAM_DEFINITION,
} from './seams/index.ts'

// ============================================================================
// 初始化 SeamRegistry
// ============================================================================

/** 初始化所有缝隙和默认 provider */
export function initializeSeamRegistry(): SeamRegistry {
  const registry = getSeamRegistry()

  // 定义所有缝隙
  registry.define(SHELL_SEAM_DEFINITION)
  registry.define(FS_SEAM_DEFINITION)
  registry.define(SANDBOX_SEAM_DEFINITION)
  registry.define(CREDENTIALS_SEAM_DEFINITION)
  registry.define(INTERACTION_SEAM_DEFINITION)
  registry.define(SETTINGS_SEAM_DEFINITION)
  registry.define(SESSION_TITLE_SEAM_DEFINITION)
  registry.define(TODO_SEAM_DEFINITION)

  // 注册默认 provider
  registry.provide(localShellProvider)
  registry.provide(localFSProvider)
  registry.provide(nullSandboxProvider)
  registry.provide(envCredentialsProvider)
  registry.provide(terminalInteractionProvider)
  registry.provide(fileSettingsProvider)
  registry.provide(llmSessionTitleProvider)
  registry.provide(storeTodoProvider)

  return registry
}

// ============================================================================
// ExtensionAPI 增强
// ============================================================================

/**
 * 为 ExtensionAPI 添加 seam 命名空间
 */
export function enhanceAPIWithSeams(pi: ExtensionAPI): EnhancedExtensionAPI {
  const registry = getSeamRegistry()

  const seamAPI: SeamAPI = {
    define<T>(definition: ServiceDefinition<T>): void {
      registry.define(definition)
    },

    provide<T>(provider: ServiceProvider<T>): void {
      registry.provide(provider)
    },

    consume<T>(seam: SeamName): T {
      return registry.consume<T>(seam)
    },

    async switchProvider(seam: SeamName, provider: ProviderName): Promise<void> {
      await registry.switchProvider(seam, provider)
    },

    getState(seam: SeamName): SeamState {
      return registry.getState(seam)
    },
  }

  return {
    ...pi,
    seam: seamAPI,
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface EnhancedExtensionAPI extends ExtensionAPI {
  seam: SeamAPI
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 获取 Shell 服务
 */
export function getShell(pi: EnhancedExtensionAPI): import('./seams/shell/types.ts').ShellService {
  return pi.seam.consume<import('./seams/shell/types.ts').ShellService>('shell')
}

/**
 * 获取 FS 服务
 */
export function getFS(pi: EnhancedExtensionAPI): import('./seams/fs/types.ts').FSService {
  return pi.seam.consume<import('./seams/fs/types.ts').FSService>('fs')
}

/**
 * 获取 Sandbox 服务
 */
export function getSandbox(pi: EnhancedExtensionAPI): import('./seams/sandbox/types.ts').SandboxService {
  return pi.seam.consume<import('./seams/sandbox/types.ts').SandboxService>('sandbox')
}

/**
 * 获取 Credentials 服务
 */
export function getCredentials(pi: EnhancedExtensionAPI): import('./seams/credentials/types.ts').CredentialsService {
  return pi.seam.consume<import('./seams/credentials/types.ts').CredentialsService>('credentials')
}

/**
 * 获取 Interaction 服务
 */
export function getInteraction(pi: EnhancedExtensionAPI): import('./seams/interaction/types.ts').InteractionService {
  return pi.seam.consume<import('./seams/interaction/types.ts').InteractionService>('interaction')
}

/**
 * 获取 Settings 服务
 */
export function getSettings(pi: EnhancedExtensionAPI): import('./seams/settings/types.ts').SettingsService {
  return pi.seam.consume<import('./seams/settings/types.ts').SettingsService>('settings')
}

/**
 * 获取 SessionTitle 服务
 */
export function getSessionTitle(pi: EnhancedExtensionAPI): import('./seams/session-title/types.ts').SessionTitleService {
  return pi.seam.consume<import('./seams/session-title/types.ts').SessionTitleService>('session-title')
}

/**
 * 获取 Todo 服务
 */
export function getTodo(pi: EnhancedExtensionAPI): import('./seams/todo/types.ts').TodoService {
  return pi.seam.consume<import('./seams/todo/types.ts').TodoService>('todo')
}
