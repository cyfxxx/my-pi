/**
 * Tmux Feature — 纯逻辑层（零 Pi 依赖）
 *
 * 迁移自 pi-tools `agent/extensions/pi-tmux/{core,config}.ts`。
 * 职责：tmux CLI 封装、会话名规范化、日志尾部读取、注册表（并发写前重读）、
 * 完成等待、shutdown 清理。执行使用 node child_process（非 Pi API）。
 *
 * 数据落点：日志 `<memoryDir>/tmux/<name>.log`；注册表 `<memoryDir>/tmux-registry.json`。
 * 说明：pi-tools 的 Windows 原生模拟后端未迁移（my-pi 以 Linux/Termux 为目标）。
 */

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  rmSync,
  renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { writeJSONSync } from '../../core/atomic-write';
import { getMemoryDir } from '../../core/config';

export const SESSION_PREFIX = 'pi-';
const NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/;
export const TMUX_LOG_MAX_BYTES = 10 * 1024 * 1024;

export interface TmuxOpts {
  bin: string;
  logDir: string;
  prefix: string;
}

export interface TmuxConfig extends TmuxOpts {
  defaultLines: number;
  defaultTimeoutSec: number;
}

export interface TmuxRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type SessionProbe = 'alive' | 'gone' | 'unknown';

export interface SessionInfo {
  name: string;
  attached: boolean;
}

export interface ReadOutput {
  text: string;
  source: 'log' | 'capture';
  truncated: boolean;
}

export interface SendOpts {
  text?: string;
  ctrlKey?: string;
  enter?: boolean;
}

export interface WaitResult {
  outcome: 'exited' | 'pattern' | 'timeout';
  lastOutput: string;
}

export interface RegistryEntry {
  name: string;
  logPath: string;
  command: string;
  createdAt: string;
  owner?: string;
}

export interface Registry {
  sessions: Record<string, RegistryEntry>;
}

// ── 路径与配置 ──

/** 默认日志目录（my-pi：portable/memory/tmux） */
export function defaultLogDir(): string {
  return join(getMemoryDir(), 'tmux');
}

export function registryPath(): string {
  return process.env.PI_TMUX_REGISTRY || join(getMemoryDir(), 'tmux-registry.json');
}

function resolveDir(p: string): string {
  return isAbsolute(p) ? p : join(homedir(), p.replace(/^~(\/|$)/, ''));
}

export function loadTmuxConfig(): TmuxConfig {
  let bin = 'tmux';
  let prefix = SESSION_PREFIX;
  let logDir = defaultLogDir();
  let defaultLines = 100;
  let defaultTimeoutSec = 120;

  // settings.json（agentDir）可选配置："pi-tmux" 或 "tmux" 节
  try {
    const settings = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'settings.json');
    if (existsSync(settings)) {
      const raw = JSON.parse(readFileSync(settings, 'utf-8')) as Record<string, Record<string, unknown> | undefined>;
      const section = raw['pi-tmux'] ?? raw['tmux'];
      if (section && typeof section === 'object') {
        if (typeof section.bin === 'string') bin = section.bin;
        if (typeof section.prefix === 'string') prefix = section.prefix;
        if (typeof section.logDir === 'string') logDir = resolveDir(section.logDir);
        if (typeof section.defaultLines === 'number') defaultLines = section.defaultLines;
        if (typeof section.defaultTimeoutSec === 'number') defaultTimeoutSec = section.defaultTimeoutSec;
      }
    }
  } catch {
    /* 配置损坏则用默认 */
  }

  if (process.env.PI_TMUX_BIN) bin = process.env.PI_TMUX_BIN;
  if (process.env.PI_TMUX_PREFIX) prefix = process.env.PI_TMUX_PREFIX;
  if (process.env.PI_TMUX_LOG_DIR) logDir = resolveDir(process.env.PI_TMUX_LOG_DIR);
  if (process.env.PI_TMUX_LINES) {
    const n = parseInt(process.env.PI_TMUX_LINES, 10);
    if (!Number.isNaN(n) && n > 0) defaultLines = n;
  }
  if (process.env.PI_TMUX_TIMEOUT_SEC) {
    const n = parseInt(process.env.PI_TMUX_TIMEOUT_SEC, 10);
    if (!Number.isNaN(n) && n > 0) defaultTimeoutSec = n;
  }
  return { bin, prefix, logDir, defaultLines, defaultTimeoutSec };
}

// ── 会话名 ──

export function normalizeSessionName(raw: string, prefix = SESSION_PREFIX): string {
  let name = (raw || '').trim();
  if (!name) throw new Error('会话名为空');
  if (name.startsWith(prefix)) name = name.slice(prefix.length);
  if (!NAME_RE.test(name)) {
    throw new Error(`非法会话名 "${raw}"：仅允许字母/数字/下划线/中划线，长度 1-40`);
  }
  return prefix + name;
}

export function isPiSession(name: string, prefix = SESSION_PREFIX): boolean {
  return name.startsWith(prefix);
}

function shellSingleQuote(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ── 日志 ──

export function ensureLogDir(opts: TmuxOpts): string {
  mkdirSync(opts.logDir, { recursive: true });
  return opts.logDir;
}

export function logPathFor(opts: TmuxOpts, name: string): string {
  return join(opts.logDir, `${name}.log`);
}

/** 日志超限单代轮转：<log> → <log>.old（只保留一代历史），失败静默 */
export function rotateLogIfLarge(opts: TmuxOpts, name: string, maxBytes = TMUX_LOG_MAX_BYTES): boolean {
  const p = logPathFor(opts, name);
  try {
    if (!existsSync(p) || statSync(p).size <= maxBytes) return false;
    try {
      rmSync(p + '.old', { force: true });
    } catch {
      /* ignore */
    }
    renameSync(p, p + '.old');
    return true;
  } catch {
    return false;
  }
}

export function removeLog(opts: TmuxOpts, name: string): void {
  const p = logPathFor(opts, name);
  try {
    if (existsSync(p)) rmSync(p);
  } catch {
    /* ignore */
  }
}

// ── tmux 进程执行 ──

export function runTmux(opts: TmuxOpts, args: string[], timeoutMs = 15000): Promise<TmuxRunResult> {
  return new Promise((resolvePromise) => {
    const child = execFile(opts.bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) {
        resolvePromise({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        return;
      }
      const code = (err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean }).code;
      if (typeof code === 'number') {
        resolvePromise({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
        return;
      }
      if (err.message.includes('ENOENT')) {
        resolvePromise({ code: 127, stdout: '', stderr: `tmux: command not found (${opts.bin})` });
        return;
      }
      if ((err as NodeJS.ErrnoException & { killed?: boolean }).killed === true) {
        resolvePromise({ code: 124, stdout: stdout ?? '', stderr: `tmux timeout after ${timeoutMs}ms` });
        return;
      }
      resolvePromise({ code: 1, stdout: stdout ?? '', stderr: stderr ?? err.message });
    });
    void child;
  });
}

/** has-session 结果三态分类（纯函数） */
export function classifySessionProbe(r: TmuxRunResult): SessionProbe {
  if (r.code === 0) {
    if (/access not allowed/i.test(r.stderr)) return 'gone';
    return 'alive';
  }
  if (r.code === 1 && /can't find session/i.test(r.stderr)) return 'gone';
  return 'unknown';
}

export async function probeSession(opts: TmuxOpts, name: string): Promise<SessionProbe> {
  return classifySessionProbe(await runTmux(opts, ['has-session', '-t', name]));
}

export async function hasSession(opts: TmuxOpts, name: string): Promise<boolean> {
  return (await probeSession(opts, name)) === 'alive';
}

export async function listSessions(opts: TmuxOpts): Promise<SessionInfo[]> {
  const r = await runTmux(opts, ['list-sessions', '-F', '#{session_name}\t#{session_attached}']);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, attached] = line.split('\t');
      return { name, attached: attached === '1' };
    });
}

export async function startSession(
  opts: TmuxOpts,
  rawName: string,
  command: string,
  cwd?: string,
): Promise<{ name: string; logPath: string; started: boolean }> {
  const name = normalizeSessionName(rawName, opts.prefix);
  if (!command || !command.trim()) throw new Error('命令为空');
  ensureLogDir(opts);
  const startDir = cwd ? resolve(cwd) : homedir();
  const logPath = logPathFor(opts, name);

  const create = await runTmux(opts, ['new-session', '-d', '-s', name, '-c', startDir], 30000);
  if (create.code !== 0) {
    if (/duplicate session/i.test(create.stderr)) {
      return { name, logPath, started: false };
    }
    throw new Error(`创建 tmux 会话失败: ${create.stderr || create.stdout || `code ${create.code}`}`);
  }

  rotateLogIfLarge(opts, name);
  const pipeCmd = `cat >> ${shellSingleQuote(logPath)}`;
  const pipeResult = await runTmux(opts, ['pipe-pane', '-t', name, '-o', pipeCmd], 10000);
  if (pipeResult.code !== 0) {
    throw new Error(`pipe-pane 设置失败: ${pipeResult.stderr || pipeResult.stdout}`);
  }

  const injected = `${command}; [ $? -ne 130 ] && exit`;
  await runTmux(opts, ['send-keys', '-t', name, '-l', injected], 10000);
  await runTmux(opts, ['send-keys', '-t', name, 'Enter'], 10000);

  return { name, logPath, started: true };
}

export async function readOutput(opts: TmuxOpts, name: string, lines = 100, maxChars = 12000): Promise<ReadOutput> {
  const logPath = logPathFor(opts, name);
  if (existsSync(logPath)) {
    const TAIL_BYTES = 512 * 1024;
    let content = '';
    let size = 0;
    let logOk = false;
    try {
      const fd = openSync(logPath, 'r');
      size = statSync(logPath).size;
      const len = Math.min(size, TAIL_BYTES);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      closeSync(fd);
      content = buf.toString('utf-8');
      logOk = true;
    } catch {
      try {
        content = readFileSync(logPath, 'utf-8');
        size = content.length;
        logOk = true;
      } catch {
        /* 日志不可得 → capture-pane 回退 */
      }
    }
    if (logOk) {
      const sliced = content.split('\n').slice(-lines).join('\n');
      const truncated = size > maxChars;
      return {
        text: truncated ? sliced.slice(-maxChars) : sliced,
        source: 'log',
        truncated: truncated || content.length > sliced.length,
      };
    }
  }
  const r = await runTmux(opts, ['capture-pane', '-t', name, '-p', '-S', String(-lines)]);
  const text = r.code === 0 ? r.stdout : '(日志文件不存在且 capture-pane 不可用)';
  return { text, source: 'capture', truncated: text.length > maxChars };
}

export async function sendKeys(opts: TmuxOpts, name: string, o: SendOpts): Promise<void> {
  if (o.ctrlKey) {
    const r = await runTmux(opts, ['send-keys', '-t', name, `C-${o.ctrlKey}`]);
    if (r.code !== 0) throw new Error(`发送按键失败: ${r.stderr}`);
  }
  if (o.text) {
    const r = await runTmux(opts, ['send-keys', '-t', name, '-l', o.text]);
    if (r.code !== 0) throw new Error(`发送文本失败: ${r.stderr}`);
  }
  if (o.enter) {
    const r = await runTmux(opts, ['send-keys', '-t', name, 'Enter']);
    if (r.code !== 0) throw new Error(`发送回车失败: ${r.stderr}`);
  }
}

export async function killSession(opts: TmuxOpts, name: string): Promise<void> {
  const r = await runTmux(opts, ['kill-session', '-t', name]);
  if (r.code !== 0) {
    if (/can't find session/i.test(r.stderr)) return;
    throw new Error(`结束会话失败: ${r.stderr}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitSession(
  opts: TmuxOpts,
  name: string,
  pattern: string | undefined,
  timeoutMs: number,
  untilExit: boolean,
): Promise<WaitResult> {
  const deadline = Date.now() + timeoutMs;
  let lastOutput = '';
  while (Date.now() < deadline) {
    const alive = await hasSession(opts, name);
    if (!alive) {
      const out = await readOutput(opts, name, 500, 20000);
      lastOutput = lastOutput.length >= out.text.length ? lastOutput : out.text;
      return { outcome: 'exited', lastOutput };
    }
    if (pattern) {
      const out = await readOutput(opts, name, 500, 20000);
      lastOutput = out.text;
      if (out.text.includes(pattern)) return { outcome: 'pattern', lastOutput };
    }
    if (untilExit && !pattern) {
      lastOutput = (await readOutput(opts, name, 500, 20000)).text;
    }
    await sleep(800);
  }
  if (pattern) lastOutput = (await readOutput(opts, name, 500, 20000)).text;
  return { outcome: 'timeout', lastOutput };
}

// ── 注册表 ──

export function loadRegistry(): Registry {
  try {
    if (existsSync(registryPath())) {
      return JSON.parse(readFileSync(registryPath(), 'utf-8')) as Registry;
    }
  } catch {
    /* 损坏则重建 */
  }
  return { sessions: {} };
}

export function saveRegistry(reg: Registry): void {
  writeJSONSync(registryPath(), reg);
}

export function registerSession(entry: RegistryEntry): void {
  const reg = loadRegistry();
  reg.sessions[entry.name] = entry;
  saveRegistry(reg);
}

export function unregisterSession(name: string): void {
  const reg = loadRegistry();
  delete reg.sessions[name];
  saveRegistry(reg);
}

export async function pruneRegistry(opts: TmuxOpts): Promise<number> {
  const probe = await runTmux(opts, ['-V'], 5000);
  if (probe.code !== 0) return 0;
  const reg = loadRegistry();
  const dead: string[] = [];
  for (const name of Object.keys(reg.sessions)) {
    const alive = await hasSession(opts, name);
    if (!alive) dead.push(name);
  }
  if (dead.length > 0) {
    const fresh = loadRegistry();
    for (const name of dead) delete fresh.sessions[name];
    saveRegistry(fresh);
  }
  return dead.length;
}

/** shutdown 清理：仅杀 owner===selfOwner 或无主的 pi- 会话 */
export async function shutdownCleanup(
  opts: TmuxOpts,
  reg: Registry,
  sessions: SessionInfo[],
  prefix: string,
  selfOwner: string,
  kill: (o: TmuxOpts, name: string) => Promise<void> = killSession,
): Promise<{ killed: string[]; skippedOthers: string[] }> {
  const killed: string[] = [];
  const skippedOthers: string[] = [];
  for (const s of sessions) {
    if (!isPiSession(s.name, prefix)) continue;
    const entry = reg.sessions[s.name];
    if (!entry) continue;
    if (entry.owner && entry.owner !== selfOwner) {
      skippedOthers.push(s.name);
      continue;
    }
    try {
      await kill(opts, s.name);
      killed.push(s.name);
    } catch {
      /* 单个失败不影响其余清理 */
    }
  }
  return { killed, skippedOthers };
}

export function tmuxMissingError(detail: string): string {
  return (
    `tmux 不可用：${detail}\n\n` +
    '请安装 tmux 后重试。按系统选择：\n' +
    '  Debian/Ubuntu:  sudo apt-get install -y tmux\n' +
    '  Termux:         pkg install tmux\n' +
    '  macOS (brew):   brew install tmux\n' +
    '安装完成后验证：tmux -V'
  );
}
