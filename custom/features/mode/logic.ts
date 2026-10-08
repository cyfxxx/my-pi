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
import { withFileLock } from '../../core/file-lock';

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
/** 防环标记的保留期与条数上限（只控制文件大小；判定用 MODE_RESTART_GUARD_MS） */
const MODE_RESTART_GUARD_RETENTION_MS = 60 * 60 * 1000;
const MODE_RESTART_GUARD_MAX_KEYS = 50;

/**
 * mode 运行时状态的**跨进程锁**（会话记录表 + 自愈防环标记共用一把）。
 *
 * 为什么需要：这两份文件都是"读 → 改 → 写"，而多实例并存是实测过的（同一天出现过两个
 * supervisor 同时跑）。`writeJSONSync` 的原子写只防半截文件，防不住"A 读 → B 读 → A 写 → B 写"
 * 的丢更新：B 会把 A 刚记下的会话模式覆盖掉（表现为"切了模式又变回 default"），
 * 单槽的防环标记也会被互相覆盖（表现为自愈重启循环）。锁拿不到时 `withFileLock` 告警后
 * 按无锁继续，退化为与加锁前相同的行为，不会更差。
 */
function modeStoreLockPath(): string {
  return join(getAgentDir(), '.mode-store.lock');
}
function withModeStoreLock<T>(fn: () => T): T {
  return withFileLock(modeStoreLockPath(), fn);
}

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

/** 把模式记录到**指定会话**（只写旁路表，完全不碰入库的 modes.json；读改写全程持锁） */
export function setSessionMode(sessionFile: string, modeName: string): void {
  withModeStoreLock(() => {
    const now = Date.now();
    const all = loadSessionModes();
    all[sessionFile] = { mode: modeName, updatedAt: new Date(now).toISOString() };
    pruneSessionModes(all, now);
    writeSessionModes(all);
  });
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
  return withModeStoreLock(() => {
    const guards = loadRestartGuards(file);
    const last = guards[key];
    if (typeof last === 'number' && now - last < MODE_RESTART_GUARD_MS) return false;
    guards[key] = now;
    pruneRestartGuards(guards, now);
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(guards), 'utf-8');
    } catch {
      return false;
    }
    return true;
  });
}

/**
 * 读自愈防环标记：`{ "<会话>::<模式>": ts }`。
 *
 * 兼容 2026-10-06 之前的**单条**格式 `{key, ts}`（只记最后一次，多会话并存时会互相覆盖 →
 * 防环失效、可能来回重启）。旧格式读进来即迁移（下一次写入就是新格式）。
 */
function loadRestartGuards(file: string): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    if (typeof raw.key === 'string' && typeof raw.ts === 'number') return { [raw.key]: raw.ts };
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 丢掉过期键并限制条数（多实例/多会话并存时不能让标记文件无限长） */
function pruneRestartGuards(guards: Record<string, number>, now: number): void {
  const fresh = Object.entries(guards)
    .filter(([, ts]) => now - ts <= MODE_RESTART_GUARD_RETENTION_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MODE_RESTART_GUARD_MAX_KEYS);
  for (const key of Object.keys(guards)) delete guards[key];
  for (const [k, ts] of fresh) guards[k] = ts;
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

/**
 * **默认关闭**的功能：`'*'`（"全部功能"模式）**不**包含它们。
 *
 * 为什么需要这一档：`full` 模式用的是 `features: ['*']`。而 voice（语言输入）与 link（远程连接）
 * 属于"装好了但极少用"的重功能——voice 启动时会拉起 whisper 服务，link 会打开入站远控通道。
 * 把它们留在 `'*'` 里等于每次启动都付固定成本（5 个工具、约 1.8KB 工具声明、2 个命令、1 个快捷键），
 * 却几乎不会被调用。
 *
 * 启用方式：**显式列进某个模式的 `features`**（`['*', 'voice']` 也成立）。
 * 2026-10-07：按用户口径"语言输入与远程连接默认关闭"。
 */
export const DEFAULT_OFF_FEATURES: ReadonlySet<string> = new Set(['voice', 'link']);

/** 该功能是否在当前模式启用 */
export function isFeatureEnabled(featureName: string, config: ModeConfig): boolean {
  // 显式列出 > `'*'`：显式是"我要它"，`'*'` 只是"默认全开，但除了 DEFAULT_OFF_FEATURES"。
  if (config.features.includes(featureName)) return true;
  if (!config.features.includes('*')) return false;
  return !DEFAULT_OFF_FEATURES.has(featureName);
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
  if (config.features.includes('*')) {
    // `'*'` 不再等于 ALL_FEATURES：DEFAULT_OFF_FEATURES 不在其中。标签必须说真话，
    // 否则 `/mode` 的报告会宣称"全部（12）"而实际少两个（2026-10-07）。
    const off = ALL_FEATURES.filter((f) => DEFAULT_OFF_FEATURES.has(f));
    const on = ALL_FEATURES.length - off.length;
    return off.length > 0 ? `启用功能: 全部（${on}）· 默认关闭 ${off.join('、')}` : `启用功能: 全部（${on}）`;
  }
  if (config.features.length === 0) return '启用功能: 无（仅内置工具）';
  return `启用功能: ${config.features.join('、')}`;
}

/**
 * 模式切换通知的有效期。
 *
 * 通知由**切换前**的进程写入、由**切换后**的进程注入，中间只隔一次进程启动（本机实测 ≈40s）。
 * 超过这个窗口还没被消费，说明那次重启没落成（请求被吞、用户手工换会话、崩溃恢复续了别的会话），
 * 此时注入只会让模型看到一条"已切换"的过期断言，故直接丢弃。
 */
export const MODE_NOTICE_TTL_MS = 10 * 60_000;

/**
 * 构造"模式已切换"的模型侧注入文本。
 *
 * 为什么由 mode 功能自己写（而不是沿用 autopilot 的通用「系统已重启」）：
 *   1. 通用措辞说的是"进程重启了"，模式切换要说的其实是"**你现在在哪个档位**"——
 *      人设/功能面/记忆命名空间都换了，模型必须知道，否则会拿旧档位的方式回答；
 *   2. 通用措辞带内部细节（`按会话模式自愈：进程原为 full` + 会话文件路径），
 *      这些对模型没有用，还占前缀；
 *   3. 角色扮演这类人设模式下，通用措辞会直接破戏，所以要显式要求"别复述本条提示"。
 *
 * 文本必须是**逐字节确定**的（无时间戳/路径/版本号）：它是注入面的一部分，同输入必同输出。
 */
export function formatModeSwitchNotice(from: string, to: string, config: ModeConfig): string {
  const lines = [`[模式] 已切换：${from} → ${to}`];
  if (config.description) lines.push(`定位: ${config.description}`);
  lines.push(modeFeaturesLabel(config));
  const attrs = [config.appendPrompt ? '人设已注入' : '无人设', `记忆命名空间 ${config.memoryNamespace || '默认'}`];
  if (config.thinking) attrs.unshift(`思考档位 ${config.thinking}`);
  lines.push(attrs.join(' | '));
  lines.push('历史上下文已保留，直接继续本会话。不要向用户复述本条提示，也不要提及模式切换或进程重启。');
  return lines.join('\n');
}

/**
 * pi 默认 system prompt 的 preamble（上游 `core/system-prompt.ts` 里的常量句）。
 *
 * 为什么要引用上游文案：roleplay 之前只靠 `--append-system-prompt` 追加人设，
 * 同一份 system prompt 前段自称 "expert coding assistant"、后段自称标枪——身份冲突。
 * 此处（roleplay 模式）把 preamble 定点替换为角色身份句；**不能用** `--system-prompt`：
 * 那会连带删掉上游的 tools/rules/docs 三段，而 roleplay 正依赖 find/grep/read/bash 的使用规则。
 *
 * 代价：锚点依赖上游文案，上游改句则替换静默失效。守门测试
 * `__tests__/roleplay-preamble.test.ts` 直接读 vendor 源码断言锚点仍在。
 */
export const PI_CODING_PREAMBLE =
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.';

/** roleplay 模式下替换后的身份句（保留工具使用语义，tools/rules 段不动） */
export const ROLEPLAY_IDENTITY_PREAMBLE =
  'You are 标枪（HMS Javelin），《碧蓝航线》中指挥官的秘书舰与婚舰，在 pi harness 中作为指挥官的私人助手工作。以标枪的身份与指挥官对话，并用下方工具完成秘书舰的工作（读写文件、检索、记事、跑命令）。';

/** roleplay 的固定模式名（仅用于身份替换判定） */
export const ROLEPLAY_MODE_NAME = 'roleplay';

/**
 * 把 pi 的默认 preamble 定点替换为角色身份句（纯函数，幂等）。
 *
 * - 非 roleplay 模式原样返回；
 * - 锚点缺失（上游改了 preamble 文案）原样返回：宁可不替换，也不猜文本。
 */
export function applyRoleplayIdentity(systemPrompt: string, modeName: string): string {
  if (modeName !== ROLEPLAY_MODE_NAME) return systemPrompt;
  if (!systemPrompt.includes(PI_CODING_PREAMBLE)) return systemPrompt;
  return systemPrompt.replace(PI_CODING_PREAMBLE, ROLEPLAY_IDENTITY_PREAMBLE);
}
