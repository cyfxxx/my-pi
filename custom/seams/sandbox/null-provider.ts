import type { SandboxProvider, SandboxService, SandboxWrapOptions, SandboxWrappedCommand } from './types.ts'

/** 无沙箱 Provider（开发环境） */
export const nullSandboxProvider: SandboxProvider = {
  name: 'null',
  seam: 'sandbox',
  description: '无沙箱（直接执行）',
  impl: {
    async wrap(command: string, _options?: SandboxWrapOptions): Promise<SandboxWrappedCommand> {
      // 无沙箱，直接返回原命令
      return { command }
    },

    async available(): Promise<boolean> {
      return true // 无沙箱总是可用
    },

    getType(): 'null' {
      return 'null'
    },
  },
}
