/**
 * Link Feature — SSH/RPC 核心（纯逻辑，零 Pi 依赖）
 *
 * 迁移自 pi-tools `agent/extensions/pi-link/link.ts`。
 * 链路：spawn ssh → 远程 `pi --mode rpc`（stdin/stdout JSONL）；完成判定 agent_settled。
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { DeviceConfig, DeviceAddr, OutboxEntry } from './logic';
import {
  deviceAddresses,
  parseState,
  selfName,
  checkConcurrentAndDedup,
  markSendStart,
  markSendSuccess,
  markSendEnd,
} from './logic';

export interface LinkResult {
  ok: boolean;
  reply?: string;
  turns: number;
  tools: number;
  model?: string;
  durationSec: number;
  error?: string;
  truncated?: boolean;
  resumed?: boolean;
  elapsedMs?: number;
}

interface RpcEvent {
  type: string;
  [k: string]: unknown;
}

export interface SendOptions {
  timeoutSec?: number;
  extensions?: boolean;
  sessionDir?: string;
  cwd?: string;
  sshArgs?: string[];
  sessionPolicy?: 'continue' | 'fresh';
  onEvent?: (ev: RpcEvent) => void;
  wrapTask?: boolean;
  fromName?: string;
  signal?: AbortSignal;
}


export function wrapTaskMessage(message: string, fromName?: string): string {
  const from = fromName ? `（发起设备: ${fromName}）` : '';
  return [
    '[远程执行任务] 你正在远程设备上作为执行代理处理来自本机 pi 的任务指令' + from + '。',
    '规则：',
    '1. 直接执行任务并完成任务本身，回复中输出任务结果/结论',
    '2. 不要询问"回复给谁/通过什么通道"——你的回复会自动回传给发起方',
    '3. 不要寒暄、不要提及本提示',
    '',
    '任务指令：',
    message,
  ].join('\n');
}

export function extractReply(events: RpcEvent[]): { text: string; model?: string } {
  let text = '';
  let model: string | undefined;
  for (const ev of events) {
    if (ev.type !== 'message_end') continue;
    const m = (ev.message ?? {}) as { role?: string; content?: unknown; model?: string };
    if (m.role !== 'assistant') continue;
    model = m.model ?? model;
    if (Array.isArray(m.content)) {
      const parts: string[] = [];
      for (const b of m.content as Array<{ type?: string; text?: string }>) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text) parts.push(b.text);
      }
      if (parts.length) text = parts.join('\n');
    } else if (typeof m.content === 'string' && m.content) {
      text = m.content;
    }
  }
  return { text, model };
}

export function shellSingleQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`;
}

export function buildRemoteCommand(d: DeviceConfig, opts: SendOptions): string {
  const parts = ['--mode', 'rpc'];
  if (!(opts.extensions ?? d.extensions ?? false)) parts.push('--no-extensions');
  const sdir = opts.sessionDir ?? '~/.pi/agent/sessions/pi-link';
  parts.push('--session-dir', shellSingleQuote(sdir));
  const args = parts.join(' ');
  const sdirAssign = sdir.startsWith('~') ? `$HOME${shellSingleQuote(sdir.slice(1))}` : shellSingleQuote(sdir);
  const policy = opts.sessionPolicy ?? d.sessionPolicy ?? 'continue';
  const resumeProbe =
    policy === 'fresh'
      ? ''
      : `SDIR=${sdirAssign}; ` +
        `F=$(ls -t "$SDIR"/*.jsonl 2>/dev/null | head -1); ` +
        `if [ -n "$F" ]; then SZ=$(stat -c%s "$F" 2>/dev/null || stat -f%z "$F" 2>/dev/null || echo 1048577); ` +
        `if [ "$SZ" -lt 1048576 ]; then echo "PI_LINK_LAST_SESSION=$F"; fi; fi; `;
  const launch =
    `JS=$(readlink -f "$(command -v pi-original 2>/dev/null || command -v pi 2>/dev/null || echo "$HOME/.local/share/pi-node/current/bin/pi-original")" 2>/dev/null); ` +
    `NODE_BIN="$(command -v node 2>/dev/null || echo "$HOME/.local/share/pi-node/current/bin/node")"; ` +
    `[ -f "$JS" ] && [ -f "$NODE_BIN" ] && exec "$NODE_BIN" "$JS" ${args}; ` +
    `exec pi ${args}`;
  let cmd = resumeProbe + launch;
  const cwd = opts.cwd ?? d.cwd;
  cmd = `unset LD_PRELOAD 2>/dev/null; ${cmd}`;
  if (cwd) {
    const cdir = cwd.startsWith('~') ? `$HOME${shellSingleQuote(cwd.slice(1))}` : shellSingleQuote(cwd);
    cmd = `CDIR=${cdir}; cd "$CDIR" && ${cmd}`;
  }
  return cmd;
}

export async function sendToDevice(
  device: DeviceConfig,
  message: string,
  opts: SendOptions = {},
  defaultTimeoutSec?: number,
): Promise<LinkResult> {
  const started = Date.now();
  const timeoutSec = opts.timeoutSec ?? device.timeoutSec ?? defaultTimeoutSec ?? 600;
  const key = `${device.user}@${device.host}:${device.port ?? 22}`;
  const guard = checkConcurrentAndDedup(key, message);
  if (!guard.ok) {
    return { ok: false, error: guard.detail ?? '发送被拒绝', turns: 0, tools: 0, durationSec: 0, elapsedMs: Date.now() - started };
  }
  markSendStart(key);
  const done = (r: LinkResult): LinkResult => {
    if (r.ok) markSendSuccess(key, message);
    markSendEnd(key);
    return r;
  };
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let switchTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    let target: DeviceAddr = { host: device.host, port: device.port };
    const addrs = deviceAddresses(device);
    let cancelledBySignal = false;
    let timedOut = false;
    let proc: ReturnType<typeof spawn> | undefined;
    const onAbort = (): void => {
      cancelledBySignal = true;
      timedOut = true;
      try {
        proc?.kill('SIGKILL');
      } catch {
        /* 进程可能已退出 */
      }
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (addrs.length > 1 && !cancelledBySignal) {
      for (const a of addrs) {
        const r = await probeAddr(device, a, opts.signal);
        if (r.ok) {
          target = a;
          break;
        }
        if (cancelledBySignal || opts.signal?.aborted) break;
      }
    }
    if (cancelledBySignal) {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      return done({
        ok: false,
        turns: 0,
        tools: 0,
        durationSec: Math.round((Date.now() - started) / 1000),
        error: '调用已被取消（工具中止）',
        resumed: false,
      });
    }

    const sshArgs = [
      ...(target.port ? ['-p', String(target.port)] : []),
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      ...(device.sshArgs ?? []),
      `${device.user}@${target.host}`,
      buildRemoteCommand(device, opts),
    ];

    proc = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let turnsCount = 0;
    let toolsCount = 0;
    let replyText = '';
    let replyModel: string | undefined;
    const observe = (ev: RpcEvent): void => {
      if (ev.type === 'turn_end') {
        turnsCount++;
        return;
      }
      if (ev.type === 'tool_execution_end') {
        toolsCount++;
        return;
      }
      if (ev.type !== 'message_end') return;
      const m = (ev.message ?? {}) as { role?: string; content?: unknown; model?: string };
      if (m.role !== 'assistant') return;
      replyModel = m.model ?? replyModel;
      if (Array.isArray(m.content)) {
        const parts: string[] = [];
        for (const b of m.content as Array<{ type?: string; text?: string }>) {
          if (b.type === 'text' && typeof b.text === 'string' && b.text) parts.push(b.text);
        }
        if (parts.length) replyText = parts.join('\n');
      } else if (typeof m.content === 'string' && m.content) {
        replyText = m.content;
      }
    };
    let settled = false;
    let userInteraction = false;
    let stderr = '';
    let lastSession: string | undefined;
    let spawnFailed = '';

    proc.stderr!.setEncoding('utf-8');
    proc.stderr!.on('data', (c: string) => {
      stderr = (stderr + c).slice(-2000);
    });
    proc.on('error', (e: Error) => {
      spawnFailed = e.message;
      rl.close();
    });
    proc.stdin!.on('error', () => {
      /* 已退出 */
    });

    let handshakeResolve!: () => void;
    const handshakeP = new Promise<void>((resolve) => {
      handshakeResolve = resolve;
    });
    handshakeTimer = setTimeout(() => handshakeResolve(), 3000);
    let switchResolve!: () => void;
    const switchP = new Promise<void>((resolve) => {
      switchResolve = resolve;
    });
    let switchResponded = false;
    let switchFailed = false;
    switchTimer = setTimeout(() => switchResolve(), 20000);

    const rl = createInterface({ input: proc.stdout! });
    const settledP = new Promise<void>((resolve) => {
      rl.on('line', (line) => {
        let ev: RpcEvent;
        try {
          ev = JSON.parse(line) as RpcEvent;
        } catch {
          const m = /^PI_LINK_LAST_SESSION=(.+)$/.exec(line.trim());
          if (m) {
            lastSession = m[1];
            clearTimeout(handshakeTimer);
            handshakeResolve();
          }
          return;
        }
        observe(ev);
        try {
          opts.onEvent?.(ev);
        } catch (e) {
          console.error(`[link] onEvent 回调异常: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (ev.type === 'agent_settled') {
          settled = true;
          resolve();
        } else if (ev.type === 'extension_ui_request') {
          userInteraction = true;
        } else if (ev.type === 'response' && (ev as { id?: unknown }).id === 'pi-link-0') {
          switchResponded = true;
          switchFailed = ev.success !== true;
          clearTimeout(switchTimer);
          switchResolve();
        }
      });
      rl.on('close', () => resolve());
    });
    proc.on('exit', () => {
      rl.close();
    });

    const finalMessage = (opts.wrapTask ?? true) ? wrapTaskMessage(message, opts.fromName) : message;
    await handshakeP;
    if (opts.signal?.aborted) throw new Error('aborted by caller before handshake completed');
    if (lastSession) {
      proc.stdin!.write(JSON.stringify({ type: 'switch_session', sessionPath: lastSession, id: 'pi-link-0' }) + '\n');
      await switchP;
      if (!switchResponded || switchFailed) lastSession = undefined;
    }
    proc.stdin!.write(JSON.stringify({ type: 'prompt', message: finalMessage, id: 'pi-link-1' }) + '\n');

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutSec * 1000);

    await settledP;

    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    proc.stdin!.end();
    proc.kill();

    const durationSec = Math.round((Date.now() - started) / 1000);
    const turns = turnsCount;
    const tools = toolsCount;
    const resumed = lastSession !== undefined;

    if (spawnFailed) return done({ ok: false, turns, tools, model: replyModel, durationSec, error: `ssh 启动失败: ${spawnFailed}（本机 ssh 缺失？）`, resumed });
    if (userInteraction) return done({ ok: false, turns, tools, model: replyModel, durationSec, error: '远程 agent 请求用户交互（ask_user/UI），无法自动应答。', resumed });
    if (cancelledBySignal) return done({ ok: false, reply: replyText || undefined, turns, tools, model: replyModel, durationSec, error: '调用已被取消（工具中止）', resumed });
    if (timedOut) return done({ ok: false, reply: replyText || undefined, turns, tools, model: replyModel, durationSec, error: `远程会话未在 ${timeoutSec}s 超时内结束`, truncated: true, resumed });
    if (!settled) return done({ ok: false, reply: replyText || undefined, turns, tools, model: replyModel, durationSec, error: '远程会话结束但未收到 agent_settled，输出可能不完整', truncated: true, resumed });
    if (!replyText) {
      const why = stderr.trim() ? `远程 stderr: ${stderr.trim().slice(0, 300)}` : '远程未返回文本回复';
      return done({ ok: false, turns, tools, model: replyModel, durationSec, error: why, resumed });
    }
    return done({ ok: true, reply: replyText, turns, tools, model: replyModel, durationSec, resumed });
  } catch (e) {
    return done({
      ok: false,
      turns: 0,
      tools: 0,
      durationSec: Math.round((Date.now() - started) / 1000),
      error: `pi-link 内部异常: ${e instanceof Error ? e.message : String(e)}`,
      resumed: false,
    });
  } finally {
    if (handshakeTimer) clearTimeout(handshakeTimer);
    if (switchTimer) clearTimeout(switchTimer);
    markSendEnd(key);
  }
}

export function probeDevice(device: DeviceConfig, signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  return new Promise((resolve) => {
    void (async () => {
      const addrs = deviceAddresses(device);
      const started = Date.now();
      let last: { detail?: string } = {};
      for (const addr of addrs) {
        const r = await probeAddr(device, addr, signal);
        if (r.ok) {
          resolve({ ok: true, latencyMs: Date.now() - started });
          return;
        }
        if (signal?.aborted) break;
        last = { detail: r.detail };
      }
      resolve({ ok: false, latencyMs: Date.now() - started, detail: last.detail });
    })();
  });
}

function probeAddr(device: DeviceConfig, addr: DeviceAddr, signal?: AbortSignal): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, detail: '探测前已取消' });
      return;
    }
    const args = [
      ...(addr.port ? ['-p', String(addr.port)] : []),
      ...(device.sshArgs ?? []),
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=3',
      `${device.user}@${addr.host}`,
      'echo pi-link-ok',
    ];
    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let failed = '';
    const finish = (v: { ok: boolean; detail?: string }): void => {
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const onAbort = (): void => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* 进程可能已退出 */
      }
      finish({ ok: false, detail: '探测已被取消' });
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    proc.stdout!.setEncoding('utf-8');
    proc.stdout!.on('data', (c: string) => {
      out += c;
    });
    proc.stderr!.setEncoding('utf-8');
    proc.stderr!.on('data', (c: string) => {
      err += c;
    });
    proc.on('error', (e: Error) => {
      failed = e.message;
      finish({ ok: false, detail: failed });
    });
    proc.on('exit', (code) => {
      if (code === 0 && out.trim() === 'pi-link-ok') {
        finish({ ok: true });
      } else {
        finish({ ok: false, detail: failed || (err || out).trim().slice(0, 200) || `exit ${code}` });
      }
    });
    const t = setTimeout(() => {
      proc.kill('SIGKILL');
      finish({ ok: false, detail: failed || 'probe timeout' });
    }, 8000);
  });
}

export function remoteExec(device: DeviceConfig, cmd: string, timeoutMs = 15000): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    void (async () => {
      const addrs = deviceAddresses(device);
      let last: { code: number | null; out: string; err: string } = { code: null, out: '', err: '无可用地址' };
      for (const addr of addrs) {
        const r = await remoteExecAddr(device, addr, cmd, timeoutMs);
        if (r.code === 0) {
          resolve(r);
          return;
        }
        last = r;
      }
      resolve(last);
    })();
  });
}

function remoteExecAddr(device: DeviceConfig, addr: DeviceAddr, cmd: string, timeoutMs: number): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const args = [
      ...(addr.port ? ['-p', String(addr.port)] : []),
      ...(device.sshArgs ?? []),
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=5',
      `${device.user}@${addr.host}`,
      cmd,
    ];
    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout!.setEncoding('utf-8');
    proc.stdout!.on('data', (c: string) => {
      out += c;
    });
    proc.stderr!.setEncoding('utf-8');
    proc.stderr!.on('data', (c: string) => {
      err += c;
    });
    proc.on('error', (e: Error) => {
      clearTimeout(t);
      resolve({ code: null, out, err: err + e.message });
    });
    proc.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code, out, err });
    });
    const t = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ code: null, out, err });
    }, timeoutMs);
  });
}

const homeCat = (rel: string): string => `F="$HOME/${rel}"; [ -f "$F" ] || F=/root/${rel}; cat "$F" 2>/dev/null`;

export async function readRemoteState(device: DeviceConfig): Promise<{ state: ReturnType<typeof parseState> | null; detail?: string }> {
  const r = await remoteExec(device, homeCat('.pi/pi-link-state.json'));
  if (r.code !== 0 || !r.out.trim()) return { state: null, detail: r.err.trim().slice(0, 200) || undefined };
  const state = parseState(r.out.trim());
  return { state, detail: state ? undefined : '远程状态文件格式无效' };
}

export async function watchRemote(device: DeviceConfig, lines = 30): Promise<{ ok: boolean; text: string; error?: string }> {
  const { state } = await readRemoteState(device);
  const sessionFile = state?.currentSessionFile;
  const glob = `(ls -t "$HOME/.pi/agent/sessions/"*/*.jsonl 2>/dev/null || ls -t /root/.pi/agent/sessions/*/*.jsonl 2>/dev/null) | head -1`;
  const cmd = sessionFile
    ? `tail -n ${lines} '${String(sessionFile).replace(/'/g, `'\\''`)}' 2>/dev/null || F=$(${glob}); [ -n "$F" ] && tail -n ${lines} "$F" || echo '(无会话文件)'`
    : `F=$(${glob}); [ -n "$F" ] && tail -n ${lines} "$F" || echo '(无会话文件)'`;
  const r = await remoteExec(device, cmd, 20000);
  if (r.code !== 0 && !r.out) return { ok: false, text: '', error: r.err.trim().slice(0, 200) || '读取失败' };
  const rows: string[] = [];
  for (const line of r.out.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t) as RpcEvent;
      if (ev.type === 'message') {
        const m = (ev.message ?? {}) as { role?: string; content?: unknown };
        let body = '';
        if (Array.isArray(m.content)) {
          for (const b of m.content as Array<{ type?: string; text?: string; id?: string }>) {
            if (b.type === 'text' && b.text) body += b.text;
            else if (b.type === 'toolCall') body += `[工具调用 ${String(b.id ?? '')}]`;
          }
        } else if (typeof m.content === 'string') body = m.content;
        rows.push(`${m.role === 'assistant' ? '🤖' : '👤'} ${body.slice(0, 150)}`);
      } else if (ev.type === 'turn_start') {
        rows.push('🔄 新一轮开始');
      } else if (ev.type === 'agent_settled') {
        rows.push('✅ 任务完成');
      }
    } catch {
      /* 非 JSON 行忽略 */
    }
  }
  return { ok: true, text: rows.join('\n') || '(会话为空)' };
}

export async function readRemoteOutbox(device: DeviceConfig): Promise<{ ok: boolean; entries?: OutboxEntry[]; detail?: string }> {
  const r = await remoteExec(device, homeCat('.pi/pi-link-outbox.json'));
  if (r.code !== 0 || !r.out.trim()) {
    return { ok: false, detail: r.err.trim().slice(0, 200) || '远程信箱为空或不可读' };
  }
  try {
    const d = JSON.parse(r.out.trim());
    if (!Array.isArray(d?.entries)) return { ok: false, detail: '远程信箱格式无效' };
    const entries = (d.entries as unknown[])
      .filter((e): e is OutboxEntry => !!e && typeof e === 'object' && typeof (e as OutboxEntry).text === 'string' && typeof (e as OutboxEntry).ts === 'number')
      .slice(-10);
    return { ok: true, entries };
  } catch {
    return { ok: false, detail: '远程信箱格式无效' };
  }
}

const attachLocks = new Map<string, Promise<unknown>>();
async function withAttachLock<T>(deviceKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = attachLocks.get(deviceKey) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  run.catch(() => {});
  attachLocks.set(deviceKey, run);
  try {
    return await run;
  } finally {
    if (attachLocks.get(deviceKey) === run) attachLocks.delete(deviceKey);
  }
}

export async function attachToRemote(device: DeviceConfig, text: string, tmuxSession?: string, force = false, fromName?: string): Promise<{ ok: boolean; detail: string }> {
  const dk = `${device.user}@${device.host}:${device.port ?? 22}`;
  return withAttachLock(dk, () => attachToRemoteInner(device, text, tmuxSession, force, fromName));
}

async function attachToRemoteInner(device: DeviceConfig, text: string, tmuxSession?: string, force = false, fromName?: string): Promise<{ ok: boolean; detail: string }> {
  const { state } = await readRemoteState(device);
  if (!/^\[来自 .+\]/.test(text)) {
    const who = fromName || selfName();
    text = `[来自 ${who}] ${text}`;
  }
  const sess = tmuxSession ?? state?.tmuxSession;
  if (!sess) {
    return { ok: false, detail: '无法确定远程 pi 的 tmux 会话（状态文件无 tmuxSession）' };
  }
  if (state?.status === 'busy' && !force) {
    return { ok: false, detail: `远程正在执行任务（${state.currentTask ?? '未知'}），已拒绝介入。加 --force 强制打断。` };
  }
  const s = `'${String(sess).replace(/'/g, `'\\''`)}'`;
  const b64 = Buffer.from(text, 'utf-8').toString('base64');
  const busyMark = 'PI_LINK_INPUT_BUSY';
  const tryPaste = async (enter: boolean): Promise<'sent' | 'busy' | 'failed'> => {
    const tmp = `$HOME/.pi-link-msg.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const tmuxProbe =
      `TMUX_FB=0; tmux_cmd() { if [ "$TMUX_FB" = 1 ]; then LD_PRELOAD= /lib/ld-linux-aarch64.so.1 /usr/bin/tmux "\\$@"; else tmux "\\$@"; fi; }; ` +
      `if ! tmux ls >/dev/null 2>&1; then ` +
      `if LD_PRELOAD= /lib/ld-linux-aarch64.so.1 /usr/bin/tmux ls >/dev/null 2>&1; then TMUX_FB=1; else TMUX_FB=2; fi; fi; ` +
      `[ "$TMUX_FB" != 2 ] || exit 4; `;
    const buf = 'pi-link-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const paste =
      `${tmuxProbe}` +
      `printf %s ${b64} | base64 -d > ${tmp} 2>/dev/null && ` +
      `tmux_cmd load-buffer -b ${buf} ${tmp} 2>&1 && ` +
      `tmux_cmd paste-buffer -b ${buf} -t ${s} 2>&1 && ` +
      (enter ? `sleep 0.5 && tmux_cmd send-keys -t ${s} Enter 2>&1 && ` : '') +
      `rm -f ${tmp}` +
      `; rm -f ${tmp} 2>/dev/null`;
    const probe =
      `${tmuxProbe}` +
      `P=$(tmux_cmd display-message -p -t ${s} '#{cursor_y}' 2>/dev/null); ` +
      `[ -z "$P" ] && P=$(tmux_cmd capture-pane -p -t ${s} 2>/dev/null | wc -l); ` +
      `L=$(tmux_cmd capture-pane -p -t ${s} 2>/dev/null | sed -n "$((P+1))p" | tr -d '\\x1b' | sed 's/\\r$//'); ` +
      `T=$(printf '%s' "$L" | tr -d '[:space:]'); ` +
      `if [ -n "$T" ] && [ "$T" != "~" ]; then echo '${busyMark}'; exit 3; fi; ` +
      paste;
    const r = await remoteExec(device, probe, 15000);
    if (r.out.includes(busyMark)) return 'busy';
    if (r.code !== 0) return 'failed';
    return 'sent';
  };

  const first = await tryPaste(true);
  if (first === 'sent') return { ok: true, detail: `已发送到远程 ${sess} 输入框并回车` };
  if (first === 'failed') return { ok: false, detail: 'tmux 操作失败（远程命令异常退出）' };
  const attachDeadline = Date.now() + 60000;
  while (Date.now() < attachDeadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const again = await tryPaste(false);
    if (again === 'sent') return { ok: true, detail: `已粘贴到远程 ${sess} 输入框（请远程用户回车发送）` };
    if (again === 'failed') return { ok: false, detail: 'tmux 操作失败（远程命令异常退出）' };
  }
  return { ok: false, detail: '远程输入框持续有内容，未发送。' };
}
