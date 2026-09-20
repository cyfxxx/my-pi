/**
 * Browser Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { createBrowserConfig, createBrowserState, navigate, closeBrowser, isValidUrl } from './logic';

export function register(pi: ExtensionAPI): void {
  const config = createBrowserConfig();
  const state = createBrowserState();

  // 注册工具：打开浏览器
  registerTool(pi, {
    name: 'browser_navigate',
    description: '在浏览器中导航到指定 URL',
    parameters: {
      url: { type: 'string', description: '要导航的 URL' },
    },
    execute: async (args: { url?: string }) => {
      if (!args?.url) return '错误：缺少 URL 参数';
      if (!isValidUrl(args.url)) return '错误：无效的 URL';
      
      const success = navigate(state, args.url);
      return success ? `已导航到 ${args.url}` : '导航失败';
    },
  });

  // 注册工具：关闭浏览器
  registerTool(pi, {
    name: 'browser_close',
    description: '关闭浏览器',
    parameters: {},
    execute: async () => {
      closeBrowser(state);
      return '浏览器已关闭';
    },
  });

  // 注册钩子：会话结束时关闭浏览器
  registerHook(pi, {
    event: 'session_shutdown',
    handler: async () => {
      closeBrowser(state);
    },
  });

  console.log('✅ Browser feature registered');
}