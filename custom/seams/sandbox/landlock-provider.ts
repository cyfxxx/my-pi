import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { SandboxProvider, SandboxService, SandboxWrapOptions, SandboxWrappedCommand } from './types.ts'

const execAsync = promisify(exec)

/** Linux Landlock 沙箱 Provider */
export const landlockSandboxProvider: SandboxProvider = {
  name: 'landlock',
  seam: 'sandbox',
  description: 'Linux Landlock LSM 沙箱',
  impl: {
    async wrap(command: string, options?: SandboxWrapOptions): Promise<SandboxWrappedCommand> {
      // Landlock 通过 landlock-cli 或自定义包装器实现
      // 这里提供基本的包装逻辑
      const allowedPaths = options?.allowedPaths ?? ['/tmp', '/usr', '/bin', '/lib']
      const deniedPaths = options?.deniedPaths ?? ['/etc/shadow', '/root/.ssh']

      // 构建 landlock 参数
      const args = [
        '--ro-paths', allowedPaths.join(':'),
        '--deny-paths', deniedPaths.join(':'),
        '--',
        'sh', '-c', command,
      ]

      return {
        command: 'landlock',
        args,
        env: {
          LANDLOCK_ABI: '3',
        },
      }
    },

    async available(): Promise<boolean> {
      try {
        // 检查 Landlock 是否可用
        const result = await execAsync('which landlock 2>/dev/null || echo not-found')
        return !result.stdout.includes('not-found')
      } catch {
        return false
      }
    },

    getType(): 'landlock' {
      return 'landlock'
    },
  },
}
