/**
 * Link Feature — 共享类型（零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-link/*` 的类型定义集合。
 */

export interface DeviceAddr {
  host: string;
  port?: number;
}

export interface DeviceConfig {
  host: string;
  user: string;
  port?: number;
  altHosts?: DeviceAddr[];
  cwd?: string;
  timeoutSec?: number;
  sessionDir?: string;
  extensions?: boolean;
  sshArgs?: string[];
  sessionPolicy?: 'continue' | 'fresh';
}

export interface LinkConfig {
  devices: Record<string, DeviceConfig>;
  defaultTimeoutSec: number;
  selfName?: string;
  allowUnattended?: boolean;
}

export interface AgentCard {
  name: string;
  skills: string[];
  host: string;
  user: string;
  port: number;
  pi?: boolean;
}

export interface IfaceInfo {
  name: string;
  address: string;
}

export interface DeviceState {
  device: string;
  status: 'idle' | 'busy';
  currentTask?: string;
  tmuxSession?: string;
  currentSessionFile?: string;
  updatedAt: number;
}

export interface LocalState {
  device: string;
  status: 'idle' | 'busy';
  currentTask?: string;
  tmuxSession?: string;
  currentSessionFile?: string;
  updatedAt: number;
}

export interface ActiveState {
  device: string;
  lastActiveAt: number;
  lastInput?: string;
  lastSendAt?: number;
}

export interface OutboxEntry {
  ts: number;
  text: string;
}
