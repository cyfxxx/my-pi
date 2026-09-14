/**
 * 集成测试 — 验证 seams 架构与扩展的集成
 */

import { describe, it, expect } from 'vitest'
import { createShellAdapter, createFSAdapter } from '../seams/adapter.ts'
import { getSeamRegistry } from '../seams/registry.ts'
import { initializeSeamRegistry } from '../integration.ts'

describe('Seam Integration', () => {
  it('should initialize seam registry', () => {
    const registry = initializeSeamRegistry()
    expect(registry).toBeDefined()
  })

  it('should create shell adapter', () => {
    // 创建一个 mock 的 EnhancedExtensionAPI
    const mockPi = {
      seam: {
        define: () => {},
        provide: () => {},
        consume: (seam: string) => {
          if (seam === 'shell') {
            return {
              execute: async (opts: { command: string }) => ({
                stdout: `executed: ${opts.command}`,
                stderr: '',
                exitCode: 0,
                duration: 100,
              }),
              getDefaultShell: async () => '/bin/bash',
              available: async () => true,
            }
          }
          return null
        },
        switchProvider: async () => {},
        getState: () => 'active',
      },
    } as any

    const shell = createShellAdapter(mockPi)
    expect(shell).toBeDefined()
    expect(typeof shell.exec).toBe('function')
    expect(typeof shell.execFull).toBe('function')
  })

  it('should create fs adapter', () => {
    const mockPi = {
      seam: {
        define: () => {},
        provide: () => {},
        consume: (seam: string) => {
          if (seam === 'fs') {
            return {
              readFile: async () => 'file content',
              writeFile: async () => {},
              exists: async () => true,
              stat: async () => ({
                type: 'file' as const,
                size: 100,
                mtime: new Date(),
                ctime: new Date(),
                atime: new Date(),
              }),
              mkdir: async () => {},
              readdir: async () => [],
              rename: async () => {},
              unlink: async () => {},
              rmdir: async () => {},
              appendFile: async () => {},
            }
          }
          return null
        },
        switchProvider: async () => {},
        getState: () => 'active',
      },
    } as any

    const fs = createFSAdapter(mockPi)
    expect(fs).toBeDefined()
    expect(typeof fs.readFile).toBe('function')
    expect(typeof fs.writeFile).toBe('function')
  })

  it('should execute shell commands through adapter', async () => {
    const mockPi = {
      seam: {
        define: () => {},
        provide: () => {},
        consume: (seam: string) => {
          if (seam === 'shell') {
            return {
              execute: async (opts: { command: string }) => ({
                stdout: `executed: ${opts.command}`,
                stderr: '',
                exitCode: 0,
                duration: 100,
              }),
              getDefaultShell: async () => '/bin/bash',
              available: async () => true,
            }
          }
          return null
        },
        switchProvider: async () => {},
        getState: () => 'active',
      },
    } as any

    const shell = createShellAdapter(mockPi)
    const result = await shell.exec('echo hello')

    expect(result).toBe('executed: echo hello')
  })

  it('should read files through adapter', async () => {
    const mockPi = {
      seam: {
        define: () => {},
        provide: () => {},
        consume: (seam: string) => {
          if (seam === 'fs') {
            return {
              readFile: async (path: string) => `content of ${path}`,
              writeFile: async () => {},
              exists: async () => true,
              stat: async () => ({
                type: 'file' as const,
                size: 100,
                mtime: new Date(),
                ctime: new Date(),
                atime: new Date(),
              }),
              mkdir: async () => {},
              readdir: async () => [],
              rename: async () => {},
              unlink: async () => {},
              rmdir: async () => {},
              appendFile: async () => {},
            }
          }
          return null
        },
        switchProvider: async () => {},
        getState: () => 'active',
      },
    } as any

    const fs = createFSAdapter(mockPi)
    const content = await fs.readFile('/test.txt')

    expect(content).toBe('content of /test.txt')
  })
})
