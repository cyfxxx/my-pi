/**
 * Agent Adapter
 * 
 * 职责：封装 Pi 的 AgentSession 创建和管理
 * 约束：
 *   - 这是唯一允许 import vendor/pi 的 session 相关模块的地方
 *   - 对外暴露稳定的 createSession 接口
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export interface SessionConfig {
  configDir: string;
  sessionDir: string;
  extensionDir: string;
  skillsDir: string;
  memoryDir: string;
  model?: string;
  provider?: string;
}

export interface MySession {
  pi: ExtensionAPI;
  config: SessionConfig;
  dispose: () => Promise<void>;
}

/** createAgentSession 返回值中我们实际依赖的运行时字段 */
interface PiSessionLike {
  extensionRunner?: ExtensionAPI;
  pi?: ExtensionAPI;
  dispose?: () => Promise<void>;
}

/**
 * 创建 Agent Session
 * 
 * 注意：具体实现需要根据 vendor/pi 的实际 API 调整。
 * 这是适配器层，允许随上游 API 变化而修改。
 */
export async function createSession(config: SessionConfig): Promise<MySession> {
  // 动态 import，避免顶层 import 造成的副作用
  const { createAgentSession } = await import(
    '../../vendor/pi/packages/coding-agent/dist/index'
  );

  const raw: unknown = await createAgentSession({
    agentDir: config.configDir,
    cwd: config.sessionDir,
  });
  const session = raw as PiSessionLike;

  return {
    pi: (session?.extensionRunner || session?.pi || raw) as ExtensionAPI,
    config,
    dispose: async () => {
      await session?.dispose?.();
    },
  };
}