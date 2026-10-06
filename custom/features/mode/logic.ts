/**
 * Mode Feature — 纯逻辑层（零 Pi 依赖）
 *
 * 模式 = 启动档位：决定注册哪些自定义功能、思考档位、附加系统提示词（人设）
 * 与长期记忆命名空间。full / minimal 为代码内固定的锁定模式，其余为
 * `portable/agent/modes.json` 中的自定义模式（如 roleplay）。
 *
 * 数据分三处（职责分离，别合并）：
 *   - `modes.json`（**入库**）：`default` + 自定义模式定义 = 配置
 *   - `modes-sessions.json`（gitignored）：`<会话文件绝对路径> → 模式名` = **每会话**的运行时选择
 *   - 进程环境：`PI_AGENT_MODE`(+`PI_AGENT_MODE_SOURCE`) = 外部硬覆盖；
 *     `PI_SESSION_MODE` = 启动器按"本次要加载的会话"解析出来的结果
 *
 * 因 pi 在进程启动时注册工具、无法运行时卸载，功能/人设/命名空间的变更需重启生效
 * （`/mode` 会自动请求重启并续接当前会话）；思考档位可即时切换。
 *
 * 会话作用域（2026-10-06 起）：模式是**会话的属性**，不是本机的全局选择——
 * 新会话用 `modes.json` 的 default，续接会话用它自己记录的模式，`/mode` 只影响当前会话。
 * 为什么用旁路表而不是 `appendEntry`（pi 官方的"扩展按会话持久化"通道）：pi 的新会话
 * 文件**在首条 user/assistant 消息之前不落盘**（`SessionManager._persist` 的门控），
 * 而"刚开一个空会话就 /mode 然后自动重启"正是要覆盖的场景——那种情况下条目只在内存里，
 * 重启即丢。旁路表与会话文件解耦，空会话也可靠；键用**路径**而非 sessionId，因为空会话
 * 重启后 pi 会在同路径重建一个**新 id**，只有路径稳定。
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
 * 会话模式记录文件（gitignored，被 `portable/agent/*` 覆盖）。
 *
 * 为什么**不**放在入库的 `modes.json` 里（历史事故）：一次 `/mode roleplay` 只是把入库文件
 * 改脏，随后任何 git 操作（checkout / stash / restore / pull，含另一台设备拉下来的版本）
 * 都会把它静默退回 `full`——用户看到的就是"切了模式、重启后没生效"。
 */
function modeSessionsPath(): string {
  return join(getAgentDir(), 'modes-sessions.json');
}

/** 自愈重启的防环标记文件（gitignored）：记录"上次为哪个会话请求过哪个模式" */
function modeRestartGuardPath(): string {
  return join(getAgentDir(), 'mode-restart-guard.json');
}

export interface SessionModeRecord {
  /** 该会话上次选择的模式名 */
  mode: string;
  updatedAt: string;
}

/** 会话文件已删除后，记录最多再留这么久（避免 `modes-sessions.json` 无限增长） */
const SESSION_MODE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 同一（会话, 目标模式）在这个窗口内只自动重启一次，防"解决不了就无限重启" */
const MODE_RESTART_GUARD_MS = 120_000;

/** 读会话模式记录（缺失/损坏都返回空表，不抛） */
function loadSessionModes(): Record<string, SessionModeRecord> {
  try {
    const raw = JSON.parse(readFileSync(modeSessionsPath(), 'utf-8')) as Record<string, unknown>;
    const out: Record<string, SessionModeRecord> = {};
    for (const [file, v] of Object.entries(raw)) {
      if (!v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      if (typeof o.mode !== 'string' || !o.mode) continue;
      out[file] = { mode: o.mode, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '' };
    }
    return out;
  } catch {
    return {};
  }
}

function writeSessionModes(all: Record<string, SessionModeRecord>): void {
  const file = modeSessionsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all, null, 2), 'utf-8');
}

/** 清理"会话文件已不存在且已过保留期"的记录；刚写入的记录不会被误删（时间戳新） */
function pruneSessionModes(all: Record<string, SessionModeRecord>, now: number): void {
  for (const [file, rec] of Object.entries(all)) {
    if (existsSync(file)) continue;
    const ts = Date.parse(rec.updatedAt);
    if (!Number.isFinite(ts) || now - ts > SESSION_MODE_RETENTION_MS) delete all[file];
  }
}

/**
 * 该会话记录的模式；没有记录 / 模式名已不存在（配置里删了）都返回 null。
 *
 * null 的语义是"回落 default"——**不是**沿用上次的值：新会话、被删模式的会话都归默认档。
 */
export function getSessionMode(sessionFile: string | undefined | null): string | null {
  if (!sessionFile) return null;
  const rec = loadSessionModes()[sessionFile];
  if (!rec) return null;
  return rec.mode in loadModes().modes ? rec.mode : null;
}

/** 把模式记录到**指定会话**（只写旁路表，完全不碰入库的 modes.json） */
export function setSessionMode(sessionFile: string, modeName: string): void {
  const now = Date.now();
  const all = loadSessionModes();
  all[sessionFile] = { mode: modeName, updatedAt: new Date(now).toISOString() };
  pruneSessionModes(all, now);
  writeSessionModes(all);
}

/**
 * 启动自愈的防环判据：同一（会话, 模式）在窗口内只放行一次自动重启。
 *
 * 返回 false 有两种情况：刚刚已经为它重启过（说明重启没解决问题，应改为告知用户），
 * 或防环标记写不下去（宁可不动手，也不要陷入"重启—不生效—再重启"的循环）。
 */
export function shouldRequestModeRestart(sessionFile: string, modeName: string): boolean {
  const key = `${sessionFile}::${modeName}`;
  const file = modeRestartGuardPath();
  const now = Date.now();
  let last: { key?: unknown; ts?: unknown } = {};
  try {
    last = JSON.parse(readFileSync(file, 'utf-8')) as typeof last;
  } catch {
    /* 没有/损坏 → 视为从未尝试 */
  }
  if (last.key === key && typeof last.ts === 'number' && now - last.ts < MODE_RESTART_GUARD_MS) return false;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ key, ts: now }), 'utf-8');
  } catch {
    return false;
  }
  return true;
}

const DEFAULT_MODES: ModesFile = { default: 'full', modes: {} };

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
  return { default: def, modes };
}

export function loadModes(): ModesFile {
  const file = modesFilePath();
  let parsed: unknown = null;
  if (!existsSync(file)) {
    saveModes(DEFAULT_MODES); // 自愈：生成配置骨架
    parsed = { default: DEFAULT_MODES.default, modes: {} };
  } else {
    try {
      parsed = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      parsed = null; // 损坏 → 用默认值，不覆盖用户文件
    }
  }
  return normalizeModesFile(parsed ?? {});
}

/** 写配置：只保存 default 与自定义模式（锁定模式不入文件；会话模式不写这里） */
export function saveModes(modes: ModesFile): void {
  const file = modesFilePath();
  const custom: Record<string, ModeConfig> = {};
  for (const [name, cfg] of Object.entries(modes.modes)) {
    if (!(name in FIXED_MODES)) custom[name] = cfg;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ default: modes.default, modes: custom }, null, 2), 'utf-8');
}

export function getModeConfig(modeName: string): ModeConfig | undefined {
  return loadModes().modes[modeName];
}

export function listModeNames(): string[] {
  return Object.keys(loadModes().modes);
}

/** 新会话（以及没有会话记录的续接会话）使用的档位 */
export function getDefaultMode(): string {
  const modes = loadModes();
  return modes.modes[modes.default] ? modes.default : 'full';
}

export function isLockedMode(name: string): boolean {
  return name in FIXED_MODES;
}

/**
 * 生效模式：外部注入的 env 覆盖优先（启动器/测试），其次是启动器按会话解析的结果，
 * 最后回落 `modes.json` 的 default。
 *
 * 必须区分"外部注入"与"bootstrap 回写"：bootstrap 会把解析结果写回 `PI_AGENT_MODE`
 * 作为进程内标记。若不加区分，`/reload` 重跑 bootstrap 时会读到上一次的旧值，
 * 模式永远切不动。来源由 `resolveStartupMode()` 维护在 `PI_AGENT_MODE_SOURCE`；
 * 未设置时视为外部注入（兼容 launcher/测试直接注入）。
 *
 * `PI_SESSION_MODE` 是**软**来源（bash 侧按 `--session` 解析），与硬覆盖分开的理由：
 * 硬覆盖要跳过一致性校验（外部强制，不是异常），软来源必须继续受校验——bash 只认精确路径，
 * `-c`/`-r`/部分 uuid 等形态它解析不出来，得由 pi 侧 session_start 检测并自愈。
 */
export function resolveEffectiveMode(): string {
  const env = process.env.PI_AGENT_MODE;
  const source = process.env.PI_AGENT_MODE_SOURCE;
  const envAllowed = source === undefined || source === 'env';
  if (envAllowed && env && getModeConfig(env)) return env;
  const sessionMode = process.env.PI_SESSION_MODE;
  if (sessionMode && getModeConfig(sessionMode)) return sessionMode;
  return getDefaultMode();
}

/**
 * 启动期解析 + 进程内来源标记（**唯一写入点**，bootstrap 只调用它）。
 *
 * 回写的目的是让进程内的其它消费者（bash 工具、子进程）看到同一个值；代价是必须能区分
 * "外部注入"与"自己回写"。判据只能是 `PI_AGENT_MODE_SOURCE`：只看 `PI_AGENT_MODE` 非空
 * 会在第二次工厂执行时（/reload、/new、会话切换都会重跑工厂）把 `file` 翻成 `env`，
 * 于是第三次起把**第一次**的值当成外部注入钉死——实测：磁盘从 full 改成 minimal 后，
 * 第 2 轮正确解析为 minimal，第 3 轮起又变回 full，此后永不跟随。
 */
export function resolveStartupMode(): string {
  const src = process.env.PI_AGENT_MODE_SOURCE;
  const envAllowed = src === undefined || src === 'env';
  const envWasSet = envAllowed && Boolean(process.env.PI_AGENT_MODE);
  const mode = resolveEffectiveMode();
  if (envWasSet) {
    process.env.PI_AGENT_MODE_SOURCE = 'env'; // 外部注入：保持硬覆盖，别翻转成 file
  } else {
    process.env.PI_AGENT_MODE = mode;
    process.env.PI_AGENT_MODE_SOURCE = 'file';
  }
  return mode;
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
