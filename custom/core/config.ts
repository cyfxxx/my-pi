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
 * 便携运行时的**平台标识**：与 `scripts/lib-portable.sh` 的 `pi_platform()` 同口径。
 *
 * 为什么必须两侧一致：shell 侧把 Node / CPython / 外部服务装进
 * `<repo>/runtime/<平台>/`（见 scripts/portable-runtime.sh），TS 侧也要能找到同一目录
 * （如 piper 的 TTS 模型）。口径一旦分叉，症状是"明明装了却找不到"——静默回退到 espeak。
 */
export function portablePlatform(): string {
  const os =
    process.platform === 'win32' ? 'win'
    : process.platform === 'darwin' ? 'darwin'
    : process.platform === 'linux' ? 'linux'
    : process.platform;
  const arch =
    process.arch === 'x64' ? 'x64'
    : process.arch === 'arm64' ? 'arm64'
    : process.arch === 'arm' ? 'armv7l'
    : process.arch;
  return `${os}-${arch}`;
}

/** 便携运行时根：`<repo>/runtime/<平台>`（随项目移动；gitignored，见 .gitignore 的 runtime/） */
export function getRuntimeRoot(platform: string = portablePlatform()): string {
  return join(getProjectRoot(), 'runtime', platform);
}

/** 便携外部服务目录：`<repo>/runtime/<平台>/ext/<name>`（SearXNG / whisper / sherpa / tts…） */
export function getExtDir(name: string): string {
  return join(getRuntimeRoot(), 'ext', name);
}

/**
 * pi 的运行时根目录（agentDir）。
 * 按 pi 的约定，配置、技能、会话与第三方扩展都在此目录下。
 *
 * 与 pi 的 `getAgentDir()` 保持同一真值：优先读 `PI_CODING_AGENT_DIR`，
 * 未设置时回退到默认 `<root>/portable/agent`。这样无论是否经 my-pi.sh 启动，
 * 自定义功能与 pi 始终指向同一目录。
 */
export function getAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  return envDir ? resolve(envDir) : join(getPortableRoot(), 'agent');
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

/**
 * my-pi 自定义功能数据目录（记忆库、工具输出归档、遥测等）。
 * 优先读 `PI_MEMORY_DIR`，与 feature 层直接读 env 的路径保持同一真值。
 */
export function getMemoryDir(): string {
  const envDir = process.env.PI_MEMORY_DIR;
  return envDir ? resolve(envDir) : join(getPortableRoot(), 'memory');
}

/**
 * 记忆命名空间（mode 隔离用）。由启动器 / bootstrap 从 modes.json 注入，
 * 只允许 `[A-Za-z0-9_-]+`，空串表示默认（共享）命名空间。
 * 仅 memory 功能据此把长期记忆落到 `<memoryDir>/<namespace>/`。
 */
export function getMemoryNamespace(): string {
  const ns = process.env.PI_MEMORY_NAMESPACE;
  if (!ns) return '';
  return /^[A-Za-z0-9_-]+$/.test(ns) ? ns : '';
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
