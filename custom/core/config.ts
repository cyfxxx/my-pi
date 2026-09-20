/**
 * 路径配置
 * 
 * 职责：解析所有路径，确保指向项目目录下的 portable/
 * 约束：
 *   - 所有路径必须动态解析，禁止硬编码
 *   - 必须支持从任意位置调用
 */

import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 解析项目根目录
 * 从 custom/core/config.ts 向上两级
 */
export function getProjectRoot(): string {
  return resolve(__dirname, '..', '..');
}

export function getPortableRoot(): string {
  return join(getProjectRoot(), 'portable');
}

export function getConfigDir(): string {
  return join(getPortableRoot(), 'config');
}

export function getSessionDir(): string {
  return join(getPortableRoot(), 'sessions');
}

export function getExtensionDir(): string {
  return join(getPortableRoot(), 'extensions');
}

export function getSkillsDir(): string {
  return join(getPortableRoot(), 'skills');
}

export function getMemoryDir(): string {
  return join(getPortableRoot(), 'memory');
}

export function getVendorPiDir(): string {
  return join(getProjectRoot(), 'vendor', 'pi');
}

/**
 * 确保所有必要目录存在
 */
export function ensureDirectories(): void {
  const dirs = [
    getConfigDir(),
    getSessionDir(),
    getExtensionDir(),
    getSkillsDir(),
    getMemoryDir(),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      throw new Error(`必要目录不存在：${dir}。请先运行 scripts/init-portable.sh`);
    }
  }
}

/**
 * 获取环境变量（带默认值）
 */
export function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}
