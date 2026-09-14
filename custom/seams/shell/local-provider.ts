import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { ShellProvider, ShellService, ShellExecOptions, ShellResult } from './types.ts'

const execAsync = promisify(exec)

/** 本地 Shell Provider */
export const localShellProvider: ShellProvider = {
  name: 'local',
  seam: 'shell',
  description: '本地 shell 执行（child_process）',
  impl: {
    async execute(command: string, options?: ShellExecOptions): Promise<ShellResult> {
      const startTime = Date.now()

      try {
        const result = await execAsync(command, {
          cwd: options?.cwd,
          timeout: options?.timeout,
          env: options?.env ? { ...process.env, ...options.env } : undefined,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          encoding: 'utf-8',
        })

        return {
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          exitCode: 0,
          duration: Date.now() - startTime,
        }
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; code?: number; signal?: string }

        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? (error as Error).message,
          exitCode: err.code ?? 1,
          signal: err.signal,
          duration: Date.now() - startTime,
        }
      }
    },

    async available(): Promise<boolean> {
      try {
        await execAsync('echo ok', { timeout: 5000 })
        return true
      } catch {
        return false
      }
    },

    async getDefaultShell(): Promise<string> {
      return process.env.SHELL ?? '/bin/sh'
    },
  },
}
