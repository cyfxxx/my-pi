import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { SandboxProvider, SandboxService, SandboxWrapOptions, SandboxWrappedCommand } from './types.ts'

const execAsync = promisify(exec)

/** macOS Seatbelt 沙箱 Provider */
export const seatbeltSandboxProvider: SandboxProvider = {
  name: 'seatbelt',
  seam: 'sandbox',
  description: 'macOS Seatbelt 沙箱',
  impl: {
    async wrap(command: string, options?: SandboxWrapOptions): Promise<SandboxWrappedCommand> {
      const allowedPaths = options?.allowedPaths ?? ['/tmp', '/usr', '/bin', '/lib', '/System']

      // 构建 seatbelt profile
      const profile = `
(version 1)
(allow default)
(deny file-write*
  (subpath "/etc")
  (subpath "/var")
  (subpath "/private/etc")
  (subpath "/private/var"))
${allowedPaths.map(p => `(allow file-read* (subpath "${p}"))`).join('\n')}
`

      return {
        command: 'sandbox-exec',
        args: ['-p', profile, 'sh', '-c', command],
      }
    },

    async available(): Promise<boolean> {
      try {
        // 检查是否在 macOS 上
        const result = await execAsync('uname -s')
        return result.stdout.trim() === 'Darwin'
      } catch {
        return false
      }
    },

    getType(): 'seatbelt' {
      return 'seatbelt'
    },
  },
}
