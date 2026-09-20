/**
 * Voice Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '../../../vendor/pi/packages/coding-agent/src/extension-api';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { createVoiceConfig, createVoiceState, transcribe, speak } from './logic';

export function register(pi: ExtensionAPI): void {
  const config = createVoiceConfig();
  const state = createVoiceState();

  // 注册工具：语音转文字
  registerTool(pi, {
    name: 'voice_transcribe',
    description: '将语音转换为文字',
    parameters: {
      audio: { type: 'string', description: '音频数据（base64）' },
    },
    execute: async (args: { audio?: string }) => {
      if (!args?.audio) return '错误：缺少音频数据';
      
      state.recording = true;
      state.transcribing = true;
      
      const result = await transcribe(Buffer.from(args.audio, 'base64'), config);
      
      state.recording = false;
      state.transcribing = false;
      
      return result;
    },
  });

  // 注册工具：文字转语音
  registerTool(pi, {
    name: 'voice_speak',
    description: '将文字转换为语音',
    parameters: {
      text: { type: 'string', description: '要朗读的文本' },
    },
    execute: async (args: { text?: string }) => {
      if (!args?.text) return '错误：缺少文本参数';
      
      state.speaking = true;
      await speak(args.text, config);
      state.speaking = false;
      
      return '语音播放完成';
    },
  });

  // 注册钩子：语音监听
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event: unknown, ctx: any) => {
      if (config.enabled && ctx.hasUI) {
        ctx.ui.notify('语音功能已启用', 'info');
      }
    },
  });

  console.log('✅ Voice feature registered');
}