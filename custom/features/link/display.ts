/**
 * Link Feature — 展示辅助（结果格式化/设备清单/帮助文本，零 Pi 依赖）
 */

import type { LinkConfig } from './types';

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
