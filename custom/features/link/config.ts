/**
 * Link Feature — 设备配置读写与 ssh 目标校验（零 Pi 依赖）
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAgentDir } from '../../core/config';
import type { DeviceAddr, DeviceConfig, LinkConfig } from './types';

function linkDir(): string {
  return getAgentDir();
}

export function defaultConfig(): LinkConfig {
  return { devices: {}, defaultTimeoutSec: 600 };
}

export function configPath(): string {
  const env = process.env.PI_LINK_CONFIG;
  if (env) return env;
  return join(linkDir(), 'pi-link.json');
}

export function isValidUserHost(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 253 && /^[^\s][^\s]*$/.test(v) && !v.startsWith('-');
}

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
        if (
          dev.port !== undefined &&
          (typeof dev.port !== 'number' || !Number.isInteger(dev.port) || dev.port < 1 || dev.port > 65535)
        ) {
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
