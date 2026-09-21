/**
 * Mode Feature — 纯逻辑层（零 Pi 依赖）
 *
 * 迁移自 pi-tools `agent/extensions/pi-mode/{types,config,apply}.ts`。
 * 模式配置读写 `portable/agent/modes.json`；运行时只改思考级别，扩展/技能/
 * 系统提示词变更标记为需重启。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getAgentDir } from '../../core/config';

export interface ModeConfig {
  description: string;
  extensions: string[];
  skills: string[];
  systemPrompt: string | null;
  appendSystemPrompt: string | null;
  thinking: string | null;
}

export interface ModesFile {
  default: string;
  current: string;
  modes: Record<string, ModeConfig>;
}

export function modesFilePath(): string {
  return join(getAgentDir(), 'modes.json');
}

const DEFAULT_MODES: ModesFile = {
  default: 'full',
  current: 'full',
  modes: {
    full: {
      description: '完整模式 - 所有扩展和技能可用',
      extensions: [],
      skills: [],
      systemPrompt: null,
      appendSystemPrompt: null,
      thinking: null,
    },
  },
};

export function loadModes(): ModesFile {
  const file = modesFilePath();
  if (!existsSync(file)) {
    saveModes(DEFAULT_MODES);
    return DEFAULT_MODES;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as ModesFile;
  } catch {
    return DEFAULT_MODES;
  }
}

export function saveModes(modes: ModesFile): void {
  const file = modesFilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(modes, null, 2), 'utf-8');
}

export function getCurrentMode(): string {
  const modes = loadModes();
  return modes.current || modes.default || 'full';
}

export function getModeConfig(modeName: string): ModeConfig | undefined {
  return loadModes().modes[modeName];
}

export function setCurrentMode(modeName: string): void {
  const modes = loadModes();
  modes.current = modeName;
  saveModes(modes);
}

export function listModeNames(): string[] {
  return Object.keys(loadModes().modes);
}

export function getDefaultMode(): string {
  const modes = loadModes();
  return modes.default || 'full';
}

// ── 运行时应用 ──

export interface ApplyResult {
  thinkingChanged: boolean;
  needsRestart: boolean;
  changes: string[];
}

export function applyModeRuntime(config: ModeConfig, currentThinking: string | undefined): ApplyResult {
  const result: ApplyResult = { thinkingChanged: false, needsRestart: false, changes: [] };

  if (config.thinking && config.thinking !== currentThinking) {
    result.thinkingChanged = true;
    result.changes.push(`思考级别: ${config.thinking}`);
  }
  if (config.extensions.length > 0) {
    result.needsRestart = true;
    result.changes.push('扩展将在重启后生效');
  }
  if (config.skills.length > 0) {
    result.needsRestart = true;
    result.changes.push('技能将在重启后生效');
  }
  if (config.systemPrompt || config.appendSystemPrompt) {
    result.needsRestart = true;
    result.changes.push('系统提示词将在重启后生效');
  }
  return result;
}

export function needsRestart(config: ModeConfig): boolean {
  return (
    config.extensions.length > 0 ||
    config.skills.length > 0 ||
    config.systemPrompt !== null ||
    config.appendSystemPrompt !== null
  );
}
