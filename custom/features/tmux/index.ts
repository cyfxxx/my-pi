/**
 * Tmux Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { createTmuxConfig, detectTmuxSession, formatSessionName } from './logic';

export function register(pi: ExtensionAPI): void {
  const config = createTmuxConfig();

  // 注册钩子：检测 tmux 会话
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      const session = detectTmuxSession();
      if (session && ctx.hasUI) {
        ctx.ui.notify(`tmux 会话: ${session}`, 'info');
      }
    },
  });

  console.log('✅ Tmux feature registered');
}