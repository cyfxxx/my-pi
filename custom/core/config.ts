/**
 * 路径配置
 *
 * 职责：解析项目内的所有路径（纯逻辑，零 Pi 依赖）
 *
 * 目录布局：
 *   <root>/portable/agent/    pi 的运行时根（agentDir，由 PI_CODING_AGENT_DIR 指向）
 *                             ├── settings.json / auth.json / models.json / ...
 *                             ├── skills/      技能
 *                             ├── sessions/    会话
 *                             └── extensions/ 第三方扩展（以及 npm/、git/ 安装的包）
 *   <root>/portable/memory/   my-pi 自定义功能数据（由 PI_MEMORY_DIR 指向）
 *
 * 约束：
 *   - 所有路径必须动态解析，禁止硬编码
 *   - 必须支持从任意位置调用
 */

import { existsSync, mkdirSync } from 'fs';
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

/**
 * pi 的运行时根目录（agentDir）。
 * 按 pi 的约定，配置、技能、会话与第三方扩展都在此目录下。
 */
export function getAgentDir(): string {
  return join(getPortableRoot(), 'agent');
}

/** 技能目录（= agentDir/skills，pi 自动发现） */
export function getSkillsDir(): string {
  return join(getAgentDir(), 'skills');
}

/** 会话目录（= agentDir/sessions/<转义 cwd>） */
export function getSessionDir(): string {
  return join(getAgentDir(), 'sessions');
}

/** 第三方扩展目录（= agentDir/extensions，pi 自动发现） */
export function getExtensionDir(): string {
  return join(getAgentDir(), 'extensions');
}

/** my-pi 自定义功能数据目录（note-store 笔记、工具输出归档） */
export function getMemoryDir(): string {
  return join(getPortableRoot(), 'memory');
}

export function getVendorPiDir(): string {
  return join(getProjectRoot(), 'vendor', 'pi');
}

/**
 * 确保必需目录存在（agentDir 与 memory）。
 * 技能/会话/扩展由 pi 按需创建，这里只保证两个根目录就绪。
 */
export function ensureDirectories(): void {
  for (const dir of [getAgentDir(), getMemoryDir()]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * 获取环境变量（带默认值）
 */
export function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}
