/**
 * Link Feature — 纯逻辑层（零 Pi 依赖）
 *
 * 迁移自 pi-tools `agent/extensions/pi-link/{config,card,lanip,guards,state,state-writer,active,outbox,helpers}.ts`。
 * 设备配置 / 设备卡片 / 局域网 IP / 并发去重 / 状态与活跃 / 信箱 / 帮助文本。
 *
 * 路径（my-pi）：配置与状态收敛到 `portable/agent/`；`PI_LINK_STATE_DIR` 可重定向（测试/多实例）。
 */

import { execSync, execFileSync } from 'node:child_process';
import { homedir, hostname, networkInterfaces } from 'node:os';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { getAgentDir } from '../../core/config';

function linkDir(): string {
  return getAgentDir();
}

// ── 配置 ──

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

export function defaultConfig(): LinkConfig {
  return { devices: {}, defaultTimeoutSec: 600 };
}

export function configPath(): string {
  const env = process.env.PI_LINK_CONFIG;
  if (env) return env;
  return join(linkDir(), 'pi-link.json');
}

// ── ssh 目标校验 + 设备卡片 ──

export function isValidUserHost(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 253 && /^[^\s][^\s]*$/.test(v) && !v.startsWith('-');
}

export interface AgentCard {
  name: string;
  skills: string[];
  host: string;
  user: string;
  port: number;
  pi?: boolean;
}

const PRIVATE_RE = /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./;
const PHYSICAL_RE = /wlan|wi-fi|wifi|ethernet|eth\d|en\d|以太网|无线/i;
const VIRTUAL_RE =
  /radmin|tailscale|zerotier|tun\d|tap\d|vpn|vethernet|wsl|docker|vmware|virtualbox|hyper-v|loopback|virbr|veth|br-/i;

export function isValidIpv4(v: string): boolean {
  const parts = v.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export interface IfaceInfo {
  name: string;
  address: string;
}

export function selectLanIPv4(interfaces: IfaceInfo[]): string | undefined {
  let best: { iface: IfaceInfo; score: number } | undefined;
  for (const it of interfaces) {
    if (it.address.startsWith('127.') || it.address.startsWith('169.254.')) continue;
    if (!isValidIpv4(it.address)) continue;
    let score = 0;
    if (PRIVATE_RE.test(it.address)) score += 100;
    if (PHYSICAL_RE.test(it.name)) score += 20;
    if (VIRTUAL_RE.test(it.name)) score -= 50;
    if (!best || score > best.score) best = { iface: it, score };
  }
  return best?.iface.address;
}

export function looksLikeWsl(procVersionText: string | undefined, env: NodeJS.ProcessEnv): boolean {
  const v = procVersionText?.toLowerCase();
  if (v && (v.includes('microsoft') || v.includes('wsl'))) return true;
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

function readProcVersion(): string | undefined {
  try {
    return readFileSync('/proc/version', 'utf8');
  } catch {
    return undefined;
  }
}

export function detectWsl(): boolean {
  return looksLikeWsl(readProcVersion(), process.env);
}

export function parseIpconfig(text: string): IfaceInfo[] {
  const out: IfaceInfo[] = [];
  for (const block of text.split(/\r?\n(?=\S)/)) {
    const lines = block.split(/\r?\n/);
    const title = (lines[0] ?? '').trim();
    if (!title || VIRTUAL_RE.test(title)) continue;
    for (const line of lines.slice(1)) {
      const m = line.match(/IPv4[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})/i);
      if (m && isValidIpv4(m[1])) out.push({ name: title, address: m[1] });
    }
  }
  return out;
}

export function windowsLanIPv4(): string | undefined {
  const candidates = ['ipconfig.exe', '/mnt/c/Windows/System32/ipconfig.exe'];
  for (const cmd of candidates) {
    try {
      const out = execFileSync(cmd, { timeout: 5000, windowsHide: true }).toString();
      const picked = selectLanIPv4(parseIpconfig(out));
      if (picked) return picked;
    } catch {
      /* 试下一个候选 */
    }
  }
  return undefined;
}

export function detectLanIPv4(): string | undefined {
  try {
    if (detectWsl()) {
      const wsl = windowsLanIPv4();
      if (wsl) return wsl;
    }
  } catch {
    /* 回退本机枚举 */
  }
  const interfaces: IfaceInfo[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a && a.family === 'IPv4' && a.address) interfaces.push({ name, address: a.address });
    }
  }
  return selectLanIPv4(interfaces);
}

const ipv4Of = (raw: string): string | undefined => raw.split(/\s+/).find((x) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x));

export function detectTailscaleIP(): string | undefined {
  try {
    const out = execSync('tailscale ip -4 2>/dev/null', { timeout: 3000 }).toString().trim();
    return ipv4Of(out);
  } catch {
    return undefined;
  }
}

export function buildCard(cfg: LinkConfig): AgentCard {
  const name = cfg.selfName ?? process.env.HOSTNAME ?? 'pi-device';
  let host = detectTailscaleIP();
  if (!host) {
    try {
      host = detectLanIPv4();
    } catch {
      host = undefined;
    }
  }
  if (!host) {
    try {
      host = ipv4Of(execSync('hostname -I 2>/dev/null', { timeout: 3000 }).toString().trim());
    } catch {
      host = undefined;
    }
  }
  return {
    name,
    skills: ['pi agent（可执行跨设备指令、观察/介入远程会话）', 'pi-link: ssh 通道 RPC'],
    host: host ?? '请填写本机 IP',
    user: process.env.USER ?? 'root',
    port: 22,
    pi: true,
  };
}

export function validateCard(card: unknown): { ok: boolean; card?: AgentCard; detail?: string } {
  if (!card || typeof card !== 'object') return { ok: false, detail: '卡片不是对象' };
  const c = card as Record<string, unknown>;
  if (typeof c.name !== 'string' || !c.name) return { ok: false, detail: '卡片缺少 name' };
  if (c.name.length > 40 || !/^[\w.-]+$/.test(c.name)) {
    return { ok: false, detail: 'name 非法（≤40 字符，仅字母数字/下划线/点/连字符）' };
  }
  if (!isValidUserHost(c.host)) return { ok: false, detail: 'host 非法（拒绝 - 开头/空白/控制字符）' };
  if (!isValidUserHost(c.user)) return { ok: false, detail: 'user 非法（拒绝 - 开头/空白/控制字符）' };
  const port = typeof c.port === 'number' ? c.port : 22;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return { ok: false, detail: `端口非法: ${port}` };
  const skills = Array.isArray(c.skills) ? c.skills.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  return { ok: true, card: { name: c.name, skills, host: c.host, user: c.user, port, pi: c.pi !== false } };
}

export function cardToDevice(card: AgentCard): DeviceConfig {
  return { host: card.host, user: card.user, port: card.port };
}

// ── 配置读写 ──

export function loadConfig(path = configPath()): LinkConfig {
  const cfg = defaultConfig();
  if (!existsSync(path)) return cfg;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LinkConfig>;
    if (raw.devices) {
      for (const [name, d] of Object.entries(raw.devices)) {
        if (!d || !isValidUserHost(d.host)) {
          console.warn(`[link] 设备 "${name}" 的 host 非法，已跳过`);
          continue;
        }
        const dev = { ...d } as DeviceConfig;
        if (Array.isArray(dev.altHosts)) {
          dev.altHosts = dev.altHosts.filter((a) => {
            const ok = !!a && isValidUserHost(a.host);
            if (!ok) console.warn(`[link] 设备 "${name}" 存在非法 altHosts 条目，已丢弃`);
            return ok;
          });
        }
        if (
          dev.user === undefined ||
          typeof dev.user !== 'string' ||
          !/^[a-zA-Z0-9_.-]+$/.test(dev.user) ||
          dev.user.startsWith('-')
        ) {
          console.warn(`[link] 设备 "${name}" 缺少 user 或 user 非法，已跳过`);
          continue;
        }
        if (dev.port !== undefined && (typeof dev.port !== 'number' || !Number.isInteger(dev.port) || dev.port < 1 || dev.port > 65535)) {
          delete dev.port;
        }
        if (dev.sshArgs !== undefined && !Array.isArray(dev.sshArgs)) {
          delete dev.sshArgs;
        }
        cfg.devices[name] = dev;
      }
    }
    if (typeof raw.defaultTimeoutSec === 'number' && raw.defaultTimeoutSec > 0) cfg.defaultTimeoutSec = raw.defaultTimeoutSec;
    if (typeof raw.selfName === 'string' && raw.selfName) cfg.selfName = raw.selfName;
    if (typeof raw.allowUnattended === 'boolean') cfg.allowUnattended = raw.allowUnattended;
  } catch {
    /* 配置损坏按默认处理 */
  }
  return cfg;
}

export function getDevice(cfg: LinkConfig, name: string): DeviceConfig | undefined {
  return cfg.devices[name];
}

export function saveDevice(path: string, name: string, d: DeviceConfig): { ok: boolean; detail: string } {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return { ok: false, detail: `设备名 "${name}" 非法（仅字母数字-下划线）` };
  const cfg = loadConfig(path);
  const existed = name in cfg.devices;
  cfg.devices[name] = { ...d };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    renameSync(tmp, path);
  } catch (e) {
    return { ok: false, detail: `写入失败: ${(e as Error).message}` };
  }
  return { ok: true, detail: existed ? `已更新设备 "${name}"` : `已添加设备 "${name}"` };
}

export function describeDevice(name: string, d: DeviceConfig): string {
  const alts = Array.isArray(d.altHosts) && d.altHosts.length > 0 ? ` +${d.altHosts.length}备用` : '';
  return `${name} → ${d.user}@${d.host}:${d.port ?? 22}${alts}`;
}

export function deviceAddresses(d: DeviceConfig): DeviceAddr[] {
  const addrs: DeviceAddr[] = [{ host: d.host, port: d.port }];
  if (Array.isArray(d.altHosts)) {
    for (const a of d.altHosts) {
      if (a && typeof a.host === 'string' && a.host) addrs.push(a);
    }
  }
  return addrs;
}

// ── 并发与去重 ──

const inflight = new Map<string, boolean>();
const lastSends = new Map<string, { hash: string; ts: number }>();
export const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export function simpleHash(s: string): string {
  const str = s ?? '';
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function checkConcurrentAndDedup(deviceKey: string, message: string): { ok: boolean; detail?: string } {
  if (inflight.get(deviceKey)) return { ok: false, detail: '该设备已有进行中的调用，请等它完成后再发' };
  const hash = simpleHash(message);
  const prev = lastSends.get(deviceKey);
  if (prev && prev.hash === hash && Date.now() - prev.ts < DEDUP_WINDOW_MS) {
    const mins = Math.round((Date.now() - prev.ts) / 60000);
    return { ok: false, detail: `与 ${mins} 分钟前发送的完全相同消息，已去重` };
  }
  return { ok: true };
}

export function markSendStart(deviceKey: string): void {
  inflight.set(deviceKey, true);
}
export function markSendSuccess(deviceKey: string, message: string): void {
  lastSends.set(deviceKey, { hash: simpleHash(message), ts: Date.now() });
}
export function markSendEnd(deviceKey: string): void {
  inflight.delete(deviceKey);
}
export function resetSendGuards(): void {
  inflight.clear();
  lastSends.clear();
}

// ── 状态文件路径 ──

function stateDir(): string {
  return process.env.PI_LINK_STATE_DIR || linkDir();
}
export function stateFilePath(): string {
  return join(stateDir(), 'pi-link-state.json');
}
export function localStateFilePath(): string {
  return stateFilePath();
}
export function activeFilePath(): string {
  return join(stateDir(), 'pi-link-active.json');
}
export function outboxFilePath(): string {
  return join(stateDir(), 'pi-link-outbox.json');
}

// ── 状态解析/写入 ──

export interface DeviceState {
  device: string;
  status: 'idle' | 'busy';
  currentTask?: string;
  tmuxSession?: string;
  currentSessionFile?: string;
  updatedAt: number;
}

export function parseState(raw: string): DeviceState | null {
  try {
    const d = JSON.parse(raw) as Partial<DeviceState>;
    if (d.status !== 'idle' && d.status !== 'busy') return null;
    return {
      device: String(d.device ?? ''),
      status: d.status,
      currentTask: typeof d.currentTask === 'string' ? d.currentTask : undefined,
      tmuxSession: typeof d.tmuxSession === 'string' ? d.tmuxSession : undefined,
      currentSessionFile: typeof d.currentSessionFile === 'string' ? d.currentSessionFile : undefined,
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export interface LocalState {
  device: string;
  status: 'idle' | 'busy';
  currentTask?: string;
  tmuxSession?: string;
  currentSessionFile?: string;
  updatedAt: number;
}

const LOCK_TIMEOUT_MS = 500;
const LOCK_POLL_MS = 5;

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* 自旋兜底 */
    }
  }
}

export function withStateLock<T>(file: string, fn: () => T): T {
  const lockPath = `${file}.lock`;
  const start = Date.now();
  let fd: number | null = null;
  let owned = false;
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx');
      owned = true;
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') break;
      if (Date.now() - start >= LOCK_TIMEOUT_MS) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        try {
          fd = openSync(lockPath, 'wx');
          owned = true;
        } catch {
          /* ignore */
        }
        break;
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    if (owned) {
      try {
        unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }
  }
}

export function writeLocalState(partial: Partial<LocalState>): void {
  try {
    const file = localStateFilePath();
    mkdirSync(dirname(file), { recursive: true });
    withStateLock(file, () => {
      let cur: Partial<LocalState> = {};
      try {
        cur = JSON.parse(readFileSync(file, 'utf-8'));
      } catch {
        /* 首次写入 */
      }
      const next: LocalState = {
        device: partial.device ?? cur.device ?? '',
        status: partial.status ?? cur.status ?? 'idle',
        currentTask:
          partial.currentTask ?? ((partial.status ?? cur.status ?? 'idle') === 'idle' ? undefined : cur.currentTask),
        tmuxSession: partial.tmuxSession ?? cur.tmuxSession,
        currentSessionFile: partial.currentSessionFile ?? cur.currentSessionFile,
        updatedAt: Date.now(),
      };
      const tmp = file + '.tmp.' + process.pid;
      writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
      renameSync(tmp, file);
    });
  } catch {
    /* 写失败不影响主流程 */
  }
}

// ── 活跃状态 ──

export interface ActiveState {
  device: string;
  lastActiveAt: number;
  lastInput?: string;
  lastSendAt?: number;
}

export const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

export function isUnattendedEnv(): boolean {
  return process.env.PI_UNATTENDED === '1';
}

export function selfName(cfgName?: string): string {
  return cfgName || hostname();
}

export function readActive(file = activeFilePath()): ActiveState | null {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<ActiveState>;
    if (typeof raw.lastActiveAt !== 'number') return null;
    return { device: String(raw.device ?? ''), lastActiveAt: raw.lastActiveAt, lastInput: raw.lastInput, lastSendAt: raw.lastSendAt };
  } catch {
    return null;
  }
}

export function writeActive(state: Partial<ActiveState>, file = activeFilePath()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    withStateLock(file, () => {
      const cur = readActive(file);
      const tmp = file + '.tmp.' + process.pid;
      writeFileSync(tmp, JSON.stringify({ ...(cur ?? {}), ...state, device: state.device ?? cur?.device ?? '' }, null, 2), 'utf-8');
      renameSync(tmp, file);
    });
  } catch {
    /* 写失败不影响主流程 */
  }
}

export function touchActive(device: string, inputText?: string): void {
  writeActive({ device, lastActiveAt: Date.now(), lastInput: inputText?.slice(0, 100) });
}

export function isActive(st?: ActiveState | null, windowMs = ACTIVE_WINDOW_MS): boolean {
  if (!st) return false;
  return Date.now() - st.lastActiveAt < windowMs;
}

// ── 信箱 ──

export interface OutboxEntry {
  ts: number;
  text: string;
}

export const OUTBOX_MAX = 10;

export function readOutbox(): OutboxEntry[] {
  try {
    const d = JSON.parse(readFileSync(outboxFilePath(), 'utf8'));
    return Array.isArray(d?.entries) ? d.entries : [];
  } catch {
    return [];
  }
}

export function appendOutbox(device: string, text: string): void {
  try {
    mkdirSync(dirname(outboxFilePath()), { recursive: true });
    const entries = readOutbox();
    entries.push({ ts: Date.now(), text });
    while (entries.length > OUTBOX_MAX) entries.shift();
    const p = outboxFilePath();
    const tmp = `${p}.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify({ device, entries }, null, 2));
    renameSync(tmp, p);
  } catch {
    /* 静默失败 */
  }
}

/** 提取 assistant 消息文本（兼容 string 与 content blocks 两种形态） */
function assistantMessageText(m: unknown): string | undefined {
  const msg = m as { role?: string; content?: unknown };
  if (msg?.role !== 'assistant') return undefined;
  if (typeof msg.content === 'string') return msg.content.trim() || undefined;
  if (Array.isArray(msg.content)) {
    const text = (msg.content as Array<{ type?: string; text?: string }>)
      .filter((c) => c?.type === 'text' && typeof c.text === 'string' && c.text.trim())
      .map((c) => c.text as string)
      .join('\n')
      .trim();
    return text || undefined;
  }
  return undefined;
}

export function extractFinalReply(messages: unknown[]): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = assistantMessageText(messages[i]);
    if (text) return text;
  }
  return undefined;
}

// ── 展示辅助 ──

export function fmtResult(r: {
  ok: boolean;
  reply?: string;
  turns: number;
  tools: number;
  durationSec: number;
  error?: string;
  model?: string;
}): string {
  const head = `[完成] ${r.durationSec}s, ${r.turns} 轮工具交互, ${r.tools} 次工具调用${r.model ? `, 模型 ${r.model}` : ''}`;
  if (!r.ok) return `${head}\n错误: ${r.error}`;
  return `${head}\n${r.reply}`;
}

export function listDevices(cfg: LinkConfig): string {
  return Object.keys(cfg.devices).join(', ') || '(无)';
}

export function helpText(): string {
  return [
    'pi-link 多设备互联：让本机 pi 与其他设备（局域网/Tailscale）的 pi 通信',
    '',
    '用法:',
    '  /link send <设备> <消息>   向目标设备的 pi 发送消息并等待回复（无人值守拒绝）',
    '  /link watch <设备> [--lines N]   观察远程 pi 会话尾部',
    '  /link attach <设备> [--force] <文本>   介入远程 pi 输入框（busy 拒绝/--force）',
    '  /link status               设备清单与连通性探测',
    '  /link inbox <设备>         读取远程信箱',
    '  /link export-card         生成本机设备卡片（含 IP/用户）',
    '  /link import-card <JSON>  导入设备卡片并写入配置',
    '  /link help                 本帮助',
    '',
    '工具: link_send(device, message, timeoutSec?) / link_status()',
    '配置 portable/agent/pi-link.json',
    '安全: 走 SSH 密钥认证；远程默认 --no-extensions 启动',
  ].join('\n');
}
