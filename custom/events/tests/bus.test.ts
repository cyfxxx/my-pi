import { describe, it, expect, beforeEach } from 'vitest'
import { DefaultEventBus, resetEventBus } from '../bus.ts'
import type { EventDefinition } from '../types.ts'

describe('EventBus', () => {
  let bus: DefaultEventBus

  beforeEach(() => {
    resetEventBus()
    bus = new DefaultEventBus()
  })

  describe('define', () => {
    it('should define an event', () => {
      const definition: EventDefinition<{ message: string }> = {
        name: 'test-event',
        mode: 'emit',
        description: 'Test event',
      }

      bus.define(definition)

      const def = bus.getDefinition('test-event')
      expect(def).toBeDefined()
      expect(def?.name).toBe('test-event')
    })
  })

  describe('on/emit', () => {
    it('should call handler on emit', async () => {
      const definition: EventDefinition<{ message: string }> = {
        name: 'test-event',
        mode: 'emit',
        description: 'Test event',
      }

      bus.define(definition)

      const handler = vi.fn()
      bus.on('test-event', handler)

      await bus.emit('test-event', { message: 'hello' })

      expect(handler).toHaveBeenCalledWith({ message: 'hello' })
    })

    it('should support multiple handlers', async () => {
      const definition: EventDefinition = {
        name: 'test-event',
        mode: 'emit',
        description: 'Test event',
      }

      bus.define(definition)

      const handler1 = vi.fn()
      const handler2 = vi.fn()

      bus.on('test-event', handler1)
      bus.on('test-event', handler2)

      await bus.emit('test-event', {})

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should return dispose function', async () => {
      const definition: EventDefinition = {
        name: 'test-event',
        mode: 'emit',
        description: 'Test event',
      }

      bus.define(definition)

      const handler = vi.fn()
      const dispose = bus.on('test-event', handler)

      dispose()

      await bus.emit('test-event', {})

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('waterfall', () => {
    it('should chain handlers', async () => {
      const definition: EventDefinition<string, string> = {
        name: 'waterfall-event',
        mode: 'waterfall',
        description: 'Waterfall event',
      }

      bus.define(definition)

      bus.on('waterfall-event', (payload, next) => {
        return next(payload + '-a')
      })

      bus.on('waterfall-event', (payload, next) => {
        return next(payload + '-b')
      })

      const result = await bus.emit('waterfall-event', 'start')

      expect(result).toBe('start-a-b')
    })

    it('should support short-circuiting', async () => {
      const definition: EventDefinition<string, string> = {
        name: 'waterfall-event',
        mode: 'waterfall',
        description: 'Waterfall event',
      }

      bus.define(definition)

      bus.on('waterfall-event', (_payload, next) => {
        return 'short-circuit'
      })

      bus.on('waterfall-event', (payload, next) => {
        return next(payload + '-b')
      })

      const result = await bus.emit('waterfall-event', 'start')

      expect(result).toBe('short-circuit')
    })
  })

  describe('bail', () => {
    it('should return first defined result', async () => {
      const definition: EventDefinition<string, string | undefined> = {
        name: 'bail-event',
        mode: 'bail',
        description: 'Bail event',
      }

      bus.define(definition)

      bus.on('bail-event', () => undefined)
      bus.on('bail-event', () => 'second')
      bus.on('bail-event', () => 'third')

      const result = await bus.emit('bail-event', '')

      expect(result).toBe('second')
    })
  })

  describe('off', () => {
    it('should remove handler', async () => {
      const definition: EventDefinition = {
        name: 'test-event',
        mode: 'emit',
        description: 'Test event',
      }

      bus.define(definition)

      const handler = vi.fn()
      bus.on('test-event', handler)
      bus.off('test-event', handler)

      await bus.emit('test-event', {})

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('once', () => {
    it('should call handler only once', async () => {
      const definition: EventDefinition = {
        name: 'test-event',
        mode: 'emit',
        description: 'Test event',
      }

      bus.define(definition)

      const handler = vi.fn()
      bus.once('test-event', handler)

      await bus.emit('test-event', {})
      await bus.emit('test-event', {})

      expect(handler).toHaveBeenCalledTimes(1)
    })
  })
})
