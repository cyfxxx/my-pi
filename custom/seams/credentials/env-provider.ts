import type { CredentialsProvider, CredentialsService, Credential, CredentialSetOptions, CredentialInfo } from './types.ts'

/** 环境变量凭证 Provider */
export const envCredentialsProvider: CredentialsProvider = {
  name: 'env',
  seam: 'credentials',
  description: '环境变量凭证管理',
  impl: {
    async get(name: string): Promise<Credential | undefined> {
      const value = process.env[name]
      if (value === undefined) return undefined

      return {
        name,
        value,
        provider: 'env',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },

    async set(name: string, value: string, options?: CredentialSetOptions): Promise<void> {
      // 环境变量只能在当前进程设置
      process.env[name] = value
    },

    async delete(name: string): Promise<void> {
      delete process.env[name]
    },

    async list(): Promise<CredentialInfo[]> {
      const credentials: CredentialInfo[] = []

      // 扫描常见的 API key 环境变量
      const commonKeys = [
        'GOOGLE_API_KEY',
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'DEEPSEEK_API_KEY',
        'GITHUB_TOKEN',
        'NPM_TOKEN',
      ]

      for (const key of commonKeys) {
        const value = process.env[key]
        if (value) {
          credentials.push({
            name: key,
            provider: 'env',
            masked: maskValue(value),
            createdAt: new Date(),
          })
        }
      }

      // 扫描自定义凭证（带 PI_ 前缀）
      for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith('PI_') && value && !commonKeys.includes(key)) {
          credentials.push({
            name: key,
            provider: 'env',
            masked: maskValue(value),
            createdAt: new Date(),
          })
        }
      }

      return credentials
    },

    async has(name: string): Promise<boolean> {
      return process.env[name] !== undefined
    },
  },
}

/** 脱敏值 */
function maskValue(value: string): string {
  if (value.length <= 8) return '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}
