import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// Shell 缝隙接口
// ============================================================================

export interface ShellService {
  /** 执行 shell 命令 */
  execute(command: string, options?: ShellExecOptions): Promise<ShellResult>
  /** 检查 shell 是否可用 */
  available(): Promise<boolean>
  /** 获取默认 shell */
  getDefaultShell(): Promise<string>
}

export interface ShellExecOptions {
  cwd?: string
  timeout?: number
  env?: Record<string, string>
  /** 是否在沙箱中执行 */
  sandboxed?: boolean
}

export interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
  signal?: string
  duration: number
}

export const SHELL_SEAM_DEFINITION: ServiceDefinition<ShellService> = {
  name: 'shell',
  description: 'Shell 命令执行能力',
  defaultProvider: 'local',
  dependencies: ['sandbox'],
}

export type ShellProvider = ServiceProvider<ShellService>
