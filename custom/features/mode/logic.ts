/**
 * Mode Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责模式切换
 */

export interface ModeConfig {
  name: string;
  description: string;
  extensions: string[];
  skills: string[];
}

// ── 模式配置 ──

const MODES: Record<string, ModeConfig> = {
  full: {
    name: 'full',
    description: '完整模式，所有扩展和技能可用',
    extensions: ['*'],
    skills: ['*'],
  },
  light: {
    name: 'light',
    description: '轻量模式，只保留搜索、计划模式和基础工具',
    extensions: ['web-search', 'plan-mode'],
    skills: ['search'],
  },
  quick: {
    name: 'quick',
    description: '极简模式，只保留内置工具，无扩展无技能',
    extensions: [],
    skills: [],
  },
};

// ── 配置管理 ──

export function loadModes(): Record<string, ModeConfig> {
  return MODES;
}

export function getModeConfig(modeName: string): ModeConfig | undefined {
  return MODES[modeName];
}

export function getCurrentMode(): string {
  return process.env.PI_AGENT_MODE || 'full';
}

// ── 命令注册 ──

export function registerCommands(): void {
  // 纯逻辑：命令注册
}