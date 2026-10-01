/**
 * Mode Feature — 纯逻辑层（零 Pi 依赖）
 *
 * 模式 = 启动档位：决定注册哪些自定义功能、思考档位、附加系统提示词（人设）
 * 与长期记忆命名空间。full / minimal 为代码内固定的锁定模式，其余为
 * `portable/agent/modes.json` 中的自定义模式（如 roleplay）。
 *
 * 数据分两处（职责分离，别合并）：
 *   - `modes.json`（**入库**）：`default` + 自定义模式定义 = 配置
 *   - `modes-state.json`（gitignored）：`current` = 运行时状态
 *
 * 因 pi 在进程启动时注册工具、无法运行时卸载，功能/人设/命名空间的变更需重启生效
 * （`/mode` 会自动请求重启并续接当前会话）；思考档位可即时切换。
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
  /** 内存中的合并视图；来自 modes-state.json（或配置里的遗留字段），不写回配置 */
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

/**
 * 运行时状态文件（当前模式）。**刻意与 modes.json 分离**：
 *
 * `modes.json` 是入库配置（`.gitignore` 用 `!portable/agent/modes.json` 特意放行），
 * 而"当前模式"是每台机器的运行时选择。混在一起的实测后果：一次 `/mode roleplay` 只是把
 * 入库文件改脏，随后任何 git 操作（checkout / stash / restore / pull，含另一台设备拉下来的
 * 版本）都会把它静默退回 `full`——用户看到的就是"切了模式、重启后没生效"。
 *
 * 本文件落在 agentDir 下，被 `.gitignore` 的 `portable/agent/*` 覆盖（无 `!` 例外）。
 */
export function modeStatePath(): string {
  return join(getAgentDir(), 'modes-state.json');
}

export interface ModeStateFile {
  /** 当前模式名；null 表示从未选择过（回落 default） */
  current: string | null;
  updatedAt?: string;
}

/** 读运行时状态（缺失/损坏都返回 current: null，不抛） */
export function loadModeState(): ModeStateFile {
  try {
    const raw = JSON.parse(readFileSync(modeStatePath(), 'utf-8')) as Record<string, unknown>;
    return {
      current: typeof raw.current === 'string' ? raw.current : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    };
  } catch {
    return { current: null };
  }
}

export function saveModeState(state: ModeStateFile): void {
  const file = modeStatePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ current: state.current, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
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
  let parsed: unknown = null;
  if (!existsSync(file)) {
    saveModes(DEFAULT_MODES); // 自愈：生成配置骨架（不含 current）
    parsed = { default: DEFAULT_MODES.default, modes: {} };
  } else {
    try {
      parsed = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      parsed = null; // 损坏 → 用默认值，不覆盖用户文件
    }
  }
  const merged = normalizeModesFile(parsed ?? {});
  // current 取值优先级：运行时状态文件 > modes.json 里的遗留字段（迁移兼容，normalize 已处理）> default
  const state = loadModeState();
  if (state.current && merged.modes[state.current]) merged.current = state.current;
  return merged;
}

/** 写配置：只保存 default 与自定义模式（锁定模式不入文件；current 属运行时状态，不写这里） */
export function saveModes(modes: ModesFile): void {
  const file = modesFilePath();
  const custom: Record<string, ModeConfig> = {};
  for (const [name, cfg] of Object.entries(modes.modes)) {
    if (!(name in FIXED_MODES)) custom[name] = cfg;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ default: modes.default, modes: custom }, null, 2), 'utf-8');
}

export function getCurrentMode(): string {
  const modes = loadModes();
  return modes.current || modes.default || 'full';
}

export function getModeConfig(modeName: string): ModeConfig | undefined {
  return loadModes().modes[modeName];
}

/**
 * 切换当前模式：只写运行时状态文件，**不碰入库的 modes.json**。
 * 于是切模式不再让工作区变脏，git 操作也不可能再回退它。
 */
export function setCurrentMode(modeName: string): void {
  saveModeState({ current: modeName });
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

/**
 * 生效模式：外部注入的 env 覆盖优先（启动器/测试），否则读磁盘运行时状态。
 *
 * 必须区分"外部注入"与"bootstrap 回写"：bootstrap 会把解析结果写回 `PI_AGENT_MODE`
 * 作为进程内标记。若不加区分，`/reload` 重跑 bootstrap 时会读到上一次的旧值，
 * 模式永远切不动——这条正是"热重载切模式"此前不成立的原因。来源由 bootstrap 写入
 * `PI_AGENT_MODE_SOURCE`；未设置时视为外部注入（兼容 launcher/测试直接注入）。
 */
export function resolveEffectiveMode(): string {
  const env = process.env.PI_AGENT_MODE;
  const source = process.env.PI_AGENT_MODE_SOURCE;
  const envAllowed = source === undefined || source === 'env';
  if (envAllowed && env && getModeConfig(env)) return env;
  return getCurrentMode();
}

/** 本进程模式是否由外部环境变量强制（启动一致性校验据此避免误报） */
export function isModeForcedByEnv(): boolean {
  return process.env.PI_AGENT_MODE_SOURCE === 'env';
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
