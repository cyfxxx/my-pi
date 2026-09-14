import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// 凭证管理 缝隙接口
// ============================================================================

export interface CredentialsService {
  /** 获取凭证 */
  get(name: string): Promise<Credential | undefined>
  /** 设置凭证 */
  set(name: string, value: string, options?: CredentialSetOptions): Promise<void>
  /** 删除凭证 */
  delete(name: string): Promise<void>
  /** 列出凭证（脱敏） */
  list(): Promise<CredentialInfo[]>
  /** 检查凭证是否存在 */
  has(name: string): Promise<boolean>
}

export interface Credential {
  name: string
  value: string
  provider: string
  createdAt: Date
  updatedAt: Date
}

export interface CredentialSetOptions {
  /** 凭证提供者 */
  provider?: string
  /** 过期时间 */
  expiresAt?: Date
}

export interface CredentialInfo {
  name: string
  provider: string
  /** 脱敏后的值 */
  masked: string
  createdAt: Date
}

export const CREDENTIALS_SEAM_DEFINITION: ServiceDefinition<CredentialsService> = {
  name: 'credentials',
  description: '凭证管理能力',
  defaultProvider: 'env',
}

export type CredentialsProvider = ServiceProvider<CredentialsService>
