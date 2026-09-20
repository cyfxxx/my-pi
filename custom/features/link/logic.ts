/**
 * Link Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责多设备 pi 互联
 */

// ── 设备配置 ──

export interface DeviceConfig {
  name: string;
  host: string;
  port?: number;
  user?: string;
  keyFile?: string;
}

export interface LinkConfig {
  selfName: string;
  devices: DeviceConfig[];
}

// ── 状态管理 ──

export interface LinkState {
  device: string;
  status: 'idle' | 'busy';
  tmuxSession?: string;
}

// ── 配置加载 ──

export function loadConfig(): LinkConfig {
  return {
    selfName: 'local',
    devices: [],
  };
}

// ── 设备名称解析 ──

export function selfName(configName?: string): string {
  return configName || 'local';
}

// ── 状态写入 ──

export function writeLocalState(state: LinkState): void {
  // 纯逻辑：状态写入
  console.log(`[link] Device ${state.device} is ${state.status}`);
}

// ── 消息提取 ──

export function extractFinalReply(messages: unknown[]): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const last = messages[messages.length - 1] as { content?: string };
  return typeof last?.content === 'string' ? last.content : undefined;
}

// ── 收件箱管理 ──

export function appendOutbox(device: string, text: string): void {
  // 纯逻辑：追加到收件箱
  console.log(`[link] Appending to outbox for ${device}`);
}
