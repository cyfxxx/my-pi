import { describe, it, expect, beforeEach } from 'vitest'
import { localShellProvider } from '../shell/local-provider.ts'
import { nullSandboxProvider } from '../sandbox/null-provider.ts'
import { envCredentialsProvider } from '../credentials/env-provider.ts'
import { storeTodoProvider } from '../todo/store-provider.ts'

describe('Shell Provider', () => {
  it('should execute commands', async () => {
    const result = await localShellProvider.impl.execute('echo hello')

    expect(result.stdout).toContain('hello')
    expect(result.exitCode).toBe(0)
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('should handle command errors', async () => {
    const result = await localShellProvider.impl.execute('exit 1')

    expect(result.exitCode).toBe(1)
  })

  it('should be available', async () => {
    const available = await localShellProvider.impl.available()
    expect(available).toBe(true)
  })

  it('should get default shell', async () => {
    const shell = await localShellProvider.impl.getDefaultShell()
    expect(shell).toBeTruthy()
  })
})

describe('Sandbox Provider', () => {
  it('should wrap commands', async () => {
    const result = await nullSandboxProvider.impl.wrap('echo hello')

    expect(result.command).toBe('echo hello')
  })

  it('should be available', async () => {
    const available = await nullSandboxProvider.impl.available()
    expect(available).toBe(true)
  })

  it('should return null type', () => {
    const type = nullSandboxProvider.impl.getType()
    expect(type).toBe('null')
  })
})

describe('Credentials Provider', () => {
  it('should get environment variables', async () => {
    process.env.TEST_CREDENTIAL = 'test-value'

    const cred = await envCredentialsProvider.impl.get('TEST_CREDENTIAL')

    expect(cred).toBeDefined()
    expect(cred?.value).toBe('test-value')
    expect(cred?.provider).toBe('env')
  })

  it('should return undefined for missing credentials', async () => {
    const cred = await envCredentialsProvider.impl.get('NONEXISTENT_KEY')

    expect(cred).toBeUndefined()
  })

  it('should set environment variables', async () => {
    await envCredentialsProvider.impl.set('TEST_SET_KEY', 'set-value')

    expect(process.env.TEST_SET_KEY).toBe('set-value')
  })

  it('should delete environment variables', async () => {
    process.env.TEST_DELETE_KEY = 'delete-me'

    await envCredentialsProvider.impl.delete('TEST_DELETE_KEY')

    expect(process.env.TEST_DELETE_KEY).toBeUndefined()
  })

  it('should check if credential exists', async () => {
    process.env.TEST_EXISTS_KEY = 'exists'

    const has = await envCredentialsProvider.impl.has('TEST_EXISTS_KEY')
    const hasNot = await envCredentialsProvider.impl.has('NONEXISTENT')

    expect(has).toBe(true)
    expect(hasNot).toBe(false)
  })
})

describe('Todo Provider', () => {
  beforeEach(async () => {
    await storeTodoProvider.impl.clear()
  })

  it('should create todo items', async () => {
    const item = await storeTodoProvider.impl.create({
      label: 'Test todo',
      priority: 'high',
    })

    expect(item.id).toBeTruthy()
    expect(item.label).toBe('Test todo')
    expect(item.priority).toBe('high')
    expect(item.status).toBe('pending')
  })

  it('should update todo items', async () => {
    const item = await storeTodoProvider.impl.create({
      label: 'Test todo',
    })

    const updated = await storeTodoProvider.impl.update(item.id, {
      status: 'completed',
    })

    expect(updated.status).toBe('completed')
  })

  it('should delete todo items', async () => {
    const item = await storeTodoProvider.impl.create({
      label: 'Test todo',
    })

    await storeTodoProvider.impl.delete(item.id)

    const found = await storeTodoProvider.impl.get(item.id)
    expect(found).toBeUndefined()
  })

  it('should list todo items', async () => {
    await storeTodoProvider.impl.create({ label: 'Todo 1' })
    await storeTodoProvider.impl.create({ label: 'Todo 2' })

    const items = await storeTodoProvider.impl.list()

    expect(items).toHaveLength(2)
  })

  it('should filter by status', async () => {
    await storeTodoProvider.impl.create({ label: 'Pending', status: 'pending' })
    await storeTodoProvider.impl.create({ label: 'Completed', status: 'completed' })

    const pending = await storeTodoProvider.impl.list({ status: 'pending' })
    const completed = await storeTodoProvider.impl.list({ status: 'completed' })

    expect(pending).toHaveLength(1)
    expect(completed).toHaveLength(1)
  })

  it('should clear all items', async () => {
    await storeTodoProvider.impl.create({ label: 'Todo 1' })
    await storeTodoProvider.impl.create({ label: 'Todo 2' })

    await storeTodoProvider.impl.clear()

    const items = await storeTodoProvider.impl.list()
    expect(items).toHaveLength(0)
  })
})
