import { describe, it, expect, beforeEach } from 'vitest'
import { createProjection, type SessionLogProjection } from '../session-log/projection.ts'
import type { SessionEvent } from '../session-log/types.ts'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('SessionLogProjection', () => {
  let projection: SessionLogProjection

  const mockEvents: SessionEvent[] = [
    {
      id: 'evt-1',
      type: 'session_info',
      timestamp: Date.parse('2025-01-15T10:00:00Z'),
      modelVisible: false,
      name: 'test-session',
    },
    {
      id: 'evt-2',
      type: 'tool_call',
      timestamp: Date.parse('2025-01-15T10:00:05Z'),
      modelVisible: true,
      toolName: 'bash',
      toolCallId: 'tc-1',
      input: { command: 'echo hello' },
    },
    {
      id: 'evt-3',
      type: 'tool_result',
      timestamp: Date.parse('2025-01-15T10:00:06Z'),
      modelVisible: true,
      toolName: 'bash',
      toolCallId: 'tc-1',
      content: [{ type: 'text', text: 'hello\n' }],
      isError: false,
      duration: 1000,
    },
    {
      id: 'evt-4',
      type: 'assistant_message',
      timestamp: Date.parse('2025-01-15T10:00:10Z'),
      modelVisible: true,
      content: 'Hello!',
      usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
    },
    {
      id: 'evt-5',
      type: 'tool_result',
      timestamp: Date.parse('2025-01-15T10:00:15Z'),
      modelVisible: true,
      toolName: 'read',
      toolCallId: 'tc-2',
      content: [{ type: 'text', text: 'file content' }],
      isError: true,
      duration: 500,
    },
    {
      id: 'evt-6',
      type: 'tool_call',
      timestamp: Date.parse('2025-01-15T11:00:00Z'),
      modelVisible: true,
      toolName: 'read',
      toolCallId: 'tc-2',
      input: { path: '/test.txt' },
    },
  ]

  beforeEach(() => {
    projection = createProjection()
  })

  it('should load events from JSONL file', async () => {
    const tmpFile = join(tmpdir(), `test-session-${Date.now()}.jsonl`)
    await writeFile(tmpFile, mockEvents.map(e => JSON.stringify(e)).join('\n'))

    await projection.load(tmpFile)

    expect(projection.getAll()).toHaveLength(6)

    await unlink(tmpFile)
  })

  it('should filter by type', async () => {
    const tmpFile = join(tmpdir(), `test-session-${Date.now()}.jsonl`)
    await writeFile(tmpFile, mockEvents.map(e => JSON.stringify(e)).join('\n'))
    await projection.load(tmpFile)

    const toolCalls = projection.getByType('tool_call')
    expect(toolCalls).toHaveLength(2)
  })

  it('should get tool stats', async () => {
    const tmpFile = join(tmpdir(), `test-session-${Date.now()}.jsonl`)
    await writeFile(tmpFile, mockEvents.map(e => JSON.stringify(e)).join('\n'))
    await projection.load(tmpFile)

    const stats = projection.getToolStats()
    expect(stats.bash).toBeDefined()
    expect(stats.bash.count).toBe(1)
    expect(stats.bash.totalTime).toBe(1000)
    expect(stats.read).toBeDefined()
    expect(stats.read.count).toBe(1)
  })

  it('should get errors', async () => {
    const tmpFile = join(tmpdir(), `test-session-${Date.now()}.jsonl`)
    await writeFile(tmpFile, mockEvents.map(e => JSON.stringify(e)).join('\n'))
    await projection.load(tmpFile)

    const errors = projection.getErrors()
    expect(errors).toHaveLength(1)
  })

  it('should get stats summary', async () => {
    const tmpFile = join(tmpdir(), `test-session-${Date.now()}.jsonl`)
    await writeFile(tmpFile, mockEvents.map(e => JSON.stringify(e)).join('\n'))
    await projection.load(tmpFile)

    const stats = projection.getStats()
    expect(stats.totalEvents).toBe(6)
    expect(stats.errorCount).toBe(1)
    expect(stats.totalTokens).toBe(110)
  })

  it('should search content', async () => {
    const tmpFile = join(tmpdir(), `test-session-${Date.now()}.jsonl`)
    await writeFile(tmpFile, mockEvents.map(e => JSON.stringify(e)).join('\n'))
    await projection.load(tmpFile)

    const results = projection.search('echo')
    expect(results).toHaveLength(1)
  })
})
