/**
 * Voice Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责语音功能
 */

export interface VoiceConfig {
  enabled: boolean;
  sttProvider: 'whisper' | 'openai' | 'google';
  ttsProvider: 'openai' | 'google' | 'system';
  wakeWord?: string;
  language: string;
}

export interface VoiceState {
  listening: boolean;
  recording: boolean;
  transcribing: boolean;
  speaking: boolean;
}

// ── 配置管理 ──

export function createVoiceConfig(): VoiceConfig {
  return {
    enabled: true,
    sttProvider: 'whisper',
    ttsProvider: 'openai',
    language: 'zh-CN',
  };
}

// ── 状态管理 ──

export function createVoiceState(): VoiceState {
  return {
    listening: false,
    recording: false,
    transcribing: false,
    speaking: false,
  };
}

// ── 唤醒词检测 ──

export function detectWakeWord(audio: string, wakeWord: string): boolean {
  return audio.toLowerCase().includes(wakeWord.toLowerCase());
}

// ── 语音转文字 ──

export async function transcribe(audio: Buffer, config: VoiceConfig): Promise<string> {
  // 纯逻辑：模拟转录
  return `转录结果: ${audio.length} bytes`;
}

// ── 文字转语音 ──

export async function speak(text: string, config: VoiceConfig): Promise<void> {
  // 纯逻辑：模拟语音合成
  console.log(`[voice] 朗读: ${text.slice(0, 50)}...`);
}