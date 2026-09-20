/**
 * Intervention Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '../../../vendor/pi/packages/coding-agent/src/extension-api';
import { registerHook } from '../../adapters/hook-adapter';
import { createInterventionConfig, shouldIntervene, formatInterventionMessage } from './logic';

export function register(pi: ExtensionAPI): void {
  const config = createInterventionConfig();

  // 注册钩子：工具调用错误时干预
  registerHook(pi, {
    event: 'after_tool_call',
    handler: async (event: unknown) => {
      const toolEvent = event as { isError?: boolean; error?: Error };
      if (toolEvent.isError && shouldIntervene(toolEvent.error || new Error('unknown'), 0, config)) {
        console.log(formatInterventionMessage(toolEvent.error || new Error('unknown'), 0));
      }
    },
  });

  console.log('✅ Intervention feature registered');
}