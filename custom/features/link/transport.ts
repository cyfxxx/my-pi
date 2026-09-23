import { spawn } from 'node:child_process';
import type { DeviceAddr, DeviceConfig } from './logic';
import { deviceAddresses } from './logic';

export interface RpcEvent {
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

export function probeAddr(device: DeviceConfig, addr: DeviceAddr, signal?: AbortSignal): Promise<{ ok: boolean; detail?: string }> {
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

export const homeCat = (rel: string): string => `F="$HOME/${rel}"; [ -f "$F" ] || F=/root/${rel}; cat "$F" 2>/dev/null`;
