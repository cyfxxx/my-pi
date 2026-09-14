import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 沙箱 缝隙接口
// ============================================================================

export interface SandboxService {
  /** 包装命令在沙箱中执行 */
  wrap(command: string, options?: SandboxWrapOptions): Promise<SandboxWrappedCommand>
  /** 检查沙箱是否可用 */
  available(): Promise<boolean>
  /** 获取沙箱类型 */
  getType(): SandboxType
}

export type SandboxType = 'landlock' | 'seatbelt' | 'bwrap' | 'null'

export interface SandboxWrapOptions {
  /** 允许的目录 */
  allowedPaths?: string[]
  /** 禁止的路径 */
  deniedPaths?: string[]
  /** 允许的网络访问 */
  allowedNetwork?: boolean
  /** 允许的系统调用 */
  allowedSyscalls?: string[]
}

export interface SandboxWrappedCommand {
  /** 包装后的命令 */
  command: string
  /** 包装器路径 */
  wrapper?: string
  /** 额外参数 */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
}

export const SANDBOX_SEAM_DEFINITION: ServiceDefinition<SandboxService> = {
  name: 'sandbox',
  description: '进程隔离沙箱能力',
  defaultProvider: 'null',
}

export type SandboxProvider = ServiceProvider<SandboxService>
