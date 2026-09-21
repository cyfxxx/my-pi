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

function normalizeModeConfig(raw: unknown): ModeConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    description: typeof o.description === 'string' ? o.description : '',
    extensions: strArray(o.extensions),
    skills: strArray(o.skills),
    systemPrompt: typeof o.systemPrompt === 'string' ? o.systemPrompt : null,
    appendSystemPrompt: typeof o.appendSystemPrompt === 'string' ? o.appendSystemPrompt : null,
    thinking: typeof o.thinking === 'string' ? o.thinking : null,
  };
}

/** 运行时校验 modes.json：字段缺失/类型错误一律归一化，避免下游 TypeError 崩溃 */
export function normalizeModesFile(raw: unknown): ModesFile {
  const o = (raw ?? {}) as Record<string, unknown>;
  const modesRaw = (o.modes && typeof o.modes === 'object' ? o.modes : {}) as Record<string, unknown>;
  const modes: Record<string, ModeConfig> = {};
  for (const [name, cfg] of Object.entries(modesRaw)) modes[name] = normalizeModeConfig(cfg);
  if (Object.keys(modes).length === 0) modes.full = normalizeModeConfig(DEFAULT_MODES.modes.full);
  const def = typeof o.default === 'string' && modes[o.default] ? o.default : 'full';
  const current = typeof o.current === 'string' && modes[o.current] ? o.current : def;
  return { default: def, current, modes };
}

export function loadModes(): ModesFile {
  const file = modesFilePath();
  if (!existsSync(file)) {
    saveModes(DEFAULT_MODES);
    return DEFAULT_MODES;
  }
  try {
    return normalizeModesFile(JSON.parse(readFileSync(file, 'utf-8')));
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
