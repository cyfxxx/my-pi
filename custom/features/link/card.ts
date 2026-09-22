/**
 * Link Feature — 设备卡片构建与校验（零 Pi 依赖）
 * 迁移自 pi-tools `pi-link/card.ts`。
 */

import { execSync } from 'node:child_process';
import { isValidUserHost } from './config';
import { detectLanIPv4, detectTailscaleIP, ipv4Of } from './net';
import type { AgentCard, DeviceConfig, LinkConfig } from './types';

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
