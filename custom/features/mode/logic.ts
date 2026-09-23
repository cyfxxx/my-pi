/**
 * Mode Feature — 纯逻辑层（零 Pi 依赖）
 *
 * 模式 = 启动档位：决定注册哪些自定义功能、思考档位、附加系统提示词（人设）
 * 与长期记忆命名空间。full / minimal 为代码内固定的锁定模式，其余为
 * `portable/agent/modes.json` 中的自定义模式（如 roleplay）。
 *
 * 因 pi 在进程启动时注册工具、无法运行时卸载，功能/人设/命名空间的变更需重启生效；
 * 思考档位可即时切换。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getAgentDir } from '../../core/config';

export interface ModeConfig {
  description: string;
  /** '*' 表示全部功能；否则为功能名白名单 */
  features: string[];
  thinking: string | null;
  /** 相对 agentDir 的人设追加文件（pi --append-system-prompt） */
  appendPrompt: string | null;
  /** 长期记忆命名空间目录名（memory 功能据此隔离） */
  memoryNamespace: string | null;
}

export interface ModesFile {
  default: string;
  current: string;
  modes: Record<string, ModeConfig>;
}

export const ALL_FEATURES = [
  'web-search',
  'context',
  'link',
  'memory',
  'mode',
  'plan-mode',
  'intervention',
  'subagent',
  'tmux',
  'browser',
  'voice',
  'autopilot',
] as const;

/** 固定模式：定义在代码中，modes.json 无法覆盖（locked） */
export const FIXED_MODES: Record<string, ModeConfig> = {
  full: {
    description: '完整模式 - 全部功能（开发项目）',
    features: ['*'],
    thinking: null,
    appendPrompt: null,
    memoryNamespace: null,
  },
  minimal: {
    description: '极简模式 - 仅内置工具，无自定义功能（测试/修复）',
    features: [],
    thinking: 'off',
    appendPrompt: null,
    memoryNamespace: null,
  },
};

export function modesFilePath(): string {
  return join(getAgentDir(), 'modes.json');
}

const DEFAULT_MODES: ModesFile = { default: 'full', current: 'full', modes: {} };

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function normalizeModeConfig(raw: unknown): ModeConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    description: typeof o.description === 'string' ? o.description : '',
    features: strArray(o.features),
    thinking: typeof o.thinking === 'string' ? o.thinking : null,
    appendPrompt: typeof o.appendPrompt === 'string' ? o.appendPrompt : null,
    memoryNamespace: typeof o.memoryNamespace === 'string' ? o.memoryNamespace : null,
  };
}

/** 运行时校验 modes.json：锁定模式由代码注入；损坏字段归一化，避免下游 TypeError */
export function normalizeModesFile(raw: unknown): ModesFile {
  const o = (raw ?? {}) as Record<string, unknown>;
  const modesRaw = (o.modes && typeof o.modes === 'object' ? o.modes : {}) as Record<string, unknown>;
  const modes: Record<string, ModeConfig> = {};
  for (const [name, cfg] of Object.entries(modesRaw)) {
    if (name in FIXED_MODES) continue;
    modes[name] = normalizeModeConfig(cfg);
  }
  for (const [name, cfg] of Object.entries(FIXED_MODES)) modes[name] = cfg;
  const def = typeof o.default === 'string' && modes[o.default] ? o.default : 'full';
  const current = typeof o.current === 'string' && modes[o.current] ? o.current : def;
  return { default: def, current, modes };
}

export function loadModes(): ModesFile {
  const file = modesFilePath();
  if (!existsSync(file)) {
    saveModes(DEFAULT_MODES);
    return normalizeModesFile(DEFAULT_MODES);
  }
  try {
    return normalizeModesFile(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return normalizeModesFile(DEFAULT_MODES);
  }
}

/** 写盘只保存自定义模式（锁定模式不入文件，保持精简与不可篡改） */
export function saveModes(modes: ModesFile): void {
  const file = modesFilePath();
  const custom: Record<string, ModeConfig> = {};
  for (const [name, cfg] of Object.entries(modes.modes)) {
    if (!(name in FIXED_MODES)) custom[name] = cfg;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ default: modes.default, current: modes.current, modes: custom }, null, 2), 'utf-8');
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

export function isLockedMode(name: string): boolean {
  return name in FIXED_MODES;
}

/** 生效模式：env PI_AGENT_MODE 优先（启动器/测试注入），否则 modes.json.current */
export function resolveEffectiveMode(): string {
  const env = process.env.PI_AGENT_MODE;
  if (env && getModeConfig(env)) return env;
  return getCurrentMode();
}

export function getEffectiveModeConfig(): ModeConfig {
  return getModeConfig(resolveEffectiveMode()) ?? FIXED_MODES.full;
}

/** 该功能是否在当前模式启用 */
export function isFeatureEnabled(featureName: string, config: ModeConfig): boolean {
  return config.features.includes('*') || config.features.includes(featureName);
}

/** 人设追加文件的绝对路径（无配置或文件不存在时返回 null） */
export function resolveAppendPromptPath(config: ModeConfig): string | null {
  if (!config.appendPrompt) return null;
  const p = join(getAgentDir(), config.appendPrompt);
  return existsSync(p) ? p : null;
}

function featuresEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export interface ApplyResult {
  thinkingChanged: boolean;
  needsRestart: boolean;
  changes: string[];
}

/** 以 activeConfig（本进程启动时的模式）为基准，计算切到 config 的结果 */
export function applyModeRuntime(
  config: ModeConfig,
  activeConfig: ModeConfig,
  currentThinking: string | undefined,
): ApplyResult {
  const result: ApplyResult = { thinkingChanged: false, needsRestart: false, changes: [] };

  if (config.thinking && config.thinking !== currentThinking) {
    result.thinkingChanged = true;
    result.changes.push(`思考级别: ${config.thinking}`);
  }
  if (!featuresEqual(config.features, activeConfig.features)) {
    result.needsRestart = true;
    result.changes.push(modeFeaturesLabel(config));
  }
  if (config.appendPrompt !== activeConfig.appendPrompt || config.memoryNamespace !== activeConfig.memoryNamespace) {
    result.needsRestart = true;
    result.changes.push('人设 / 记忆命名空间将在重启后生效');
  }
  return result;
}

export function modeFeaturesLabel(config: ModeConfig): string {
  if (config.features.includes('*')) return `启用功能: 全部（${ALL_FEATURES.length}）`;
  if (config.features.length === 0) return '启用功能: 无（仅内置工具）';
  return `启用功能: ${config.features.join('、')}`;
}
