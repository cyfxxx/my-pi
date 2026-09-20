/**
 * Link Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import {
  loadConfig,
  selfName,
  writeLocalState,
  extractFinalReply,
  appendOutbox,
} from './logic';

export function register(pi: ExtensionAPI): void {
  const cfg = loadConfig();
  const me = selfName(cfg.selfName);

  // 注册钩子
  registerHook(pi, {
    event: 'input',
    handler: async (event: unknown) => {
      const inputEvent = event as { text?: string };
      const text = typeof inputEvent?.text === 'string' ? inputEvent.text : '';
      // 处理输入
    },
  });

  registerHook(pi, {
    event: 'agent_end',
    handler: async (event: unknown) => {
      const endEvent = event as { messages?: unknown[] };
      const text = extractFinalReply(endEvent?.messages || []);
      if (text) appendOutbox(me, text);
    },
  });

  // 注册工具
  registerTool(pi, {
    name: 'link_status',
    description: '查看设备状态',
    parameters: {},
    execute: async () => {
      writeLocalState({ device: me, status: 'idle' });
      return `Device ${me} is idle`;
    },
  });

  console.log('✅ Link feature registered');
}
