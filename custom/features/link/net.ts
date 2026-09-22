/**
 * Link Feature — 局域网/WSL/Tailscale IP 探测（零 Pi 依赖）
 * 迁移自 pi-tools `pi-link/lanip.ts`。
 */

import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import type { IfaceInfo } from './types';

const PRIVATE_RE = /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./;
const PHYSICAL_RE = /wlan|wi-fi|wifi|ethernet|eth\d|en\d|以太网|无线/i;
const VIRTUAL_RE =
  /radmin|tailscale|zerotier|tun\d|tap\d|vpn|vethernet|wsl|docker|vmware|virtualbox|hyper-v|loopback|virbr|veth|br-/i;

export function isValidIpv4(v: string): boolean {
  const parts = v.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
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

export const ipv4Of = (raw: string): string | undefined =>
  raw.split(/\s+/).find((x) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x));

export function detectTailscaleIP(): string | undefined {
  try {
    const out = execSync('tailscale ip -4 2>/dev/null', { timeout: 3000 }).toString().trim();
    return ipv4Of(out);
  } catch {
    return undefined;
  }
}
