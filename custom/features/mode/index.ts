/**
 * Mode Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '../../../vendor/pi/packages/coding-agent/src/extension-api';
import { registerHook } from '../../adapters/hook-adapter';
import {
  loadModes,
  getModeConfig,
  getCurrentMode,
} from './logic';

export function register(pi: ExtensionAPI): void {
  // 注册钩子：会话启动时显示当前模式信息
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event: unknown, ctx: any) => {
      const envMode = process.env.PI_AGENT_MODE;
      const modeName = envMode || getCurrentMode();

      if (!modeName || modeName === 'full') return;

      const config = getModeConfig(modeName);
      if (!config) return;

      if (ctx.hasUI) {
        ctx.ui.notify(
          `[模式] ${modeName}: ${config.description}`,
          'info',
        );
      }
    },
  });

  console.log('✅ Mode feature registered');
}