import { describe, it, expect, beforeEach } from 'vitest'
import { DefaultSeamRegistry, SeamError, resetSeamRegistry } from '../registry.ts'
import type { ServiceDefinition, ServiceProvider } from '../types.ts'

describe('SeamRegistry', () => {
  let registry: DefaultSeamRegistry

  beforeEach(() => {
    resetSeamRegistry()
    registry = new DefaultSeamRegistry()
  })

  describe('define', () => {
    it('should define a seam', () => {
      const definition: ServiceDefinition<{ test: () => string }> = {
        name: 'test-seam',
        description: 'Test seam',
        defaultProvider: 'test',
      }

      registry.define(definition)

      const seams = registry.list()
      expect(seams).toHaveLength(1)
      expect(seams[0].definition.name).toBe('test-seam')
    })

    it('should throw on duplicate definition', () => {
      const definition: ServiceDefinition = {
        name: 'test-seam',
        description: 'Test seam',
        defaultProvider: 'test',
      }

      registry.define(definition)

      expect(() => registry.define(definition)).toThrow(SeamError)
    })
  })

  describe('provide', () => {
    it('should register a provider', () => {
      const definition: ServiceDefinition<{ test: () => string }> = {
        name: 'test-seam',
        description: 'Test seam',
        defaultProvider: 'test',
      }

      const provider: ServiceProvider<{ test: () => string }> = {
        name: 'test',
        seam: 'test-seam',
        description: 'Test provider',
        impl: { test: () => 'hello' },
      }

      registry.define(definition)
      registry.provide(provider)

      const seams = registry.list()
      expect(seams[0].providers.size).toBe(1)
    })

    it('should throw for undefined seam', () => {
      const provider: ServiceProvider = {
        name: 'test',
        seam: 'nonexistent',
        description: 'Test provider',
        impl: {},
      }

      expect(() => registry.provide(provider)).toThrow(SeamError)
    })
  })

  describe('consume', () => {
    it('should return provider implementation', () => {
      const definition: ServiceDefinition<{ test: () => string }> = {
        name: 'test-seam',
        description: 'Test seam',
        defaultProvider: 'test',
      }

      const provider: ServiceProvider<{ test: () => string }> = {
        name: 'test',
        seam: 'test-seam',
        description: 'Test provider',
        impl: { test: () => 'hello' },
      }

      registry.define(definition)
      registry.provide(provider)

      const impl = registry.consume<{ test: () => string }>('test-seam')
      expect(impl.test()).toBe('hello')
    })

    it('should throw for undefined seam', () => {
      expect(() => registry.consume('nonexistent')).toThrow(SeamError)
    })
  })

  describe('switchProvider', () => {
    it('should switch provider', async () => {
      const definition: ServiceDefinition<{ test: () => string }> = {
        name: 'test-seam',
        description: 'Test seam',
        defaultProvider: 'provider-a',
      }

      const providerA: ServiceProvider<{ test: () => string }> = {
        name: 'provider-a',
        seam: 'test-seam',
        description: 'Provider A',
        impl: { test: () => 'a' },
      }

      const providerB: ServiceProvider<{ test: () => string }> = {
        name: 'provider-b',
        seam: 'test-seam',
        description: 'Provider B',
        impl: { test: () => 'b' },
      }

      registry.define(definition)
      registry.provide(providerA)
      registry.provide(providerB)

      expect(registry.getProvider('test-seam')).toBe('provider-a')

      await registry.switchProvider('test-seam', 'provider-b')

      expect(registry.getProvider('test-seam')).toBe('provider-b')

      const impl = registry.consume<{ test: () => string }>('test-seam')
      expect(impl.test()).toBe('b')
    })
  })

  describe('getState', () => {
    it('should return defined state', () => {
      const definition: ServiceDefinition = {
        name: 'test-seam',
        description: 'Test seam',
        defaultProvider: 'test',
      }

      registry.define(definition)

      expect(registry.getState('test-seam')).toBe('defined')
    })

    it('should return undefined for nonexistent seam', () => {
      expect(registry.getState('nonexistent')).toBe('defined')
    })
  })

  describe('destroyAll', () => {
    it('should destroy all seams', async () => {
      const destroyFn = vi.fn()

      const definition: ServiceDefinition = {
        name: 'test-seam',
        description: 'Test seam',
        defaultProvider: 'test',
      }

      const provider: ServiceProvider = {
        name: 'test',
        seam: 'test-seam',
        description: 'Test provider',
        impl: {},
        destroy: destroyFn,
      }

      registry.define(definition)
      registry.provide(provider)

      await registry.destroyAll()

      expect(destroyFn).toHaveBeenCalled()
      expect(registry.getState('test-seam')).toBe('inactive')
    })
  })
})
