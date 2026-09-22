/**
 * Link Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-link/{index,tools,commands}.ts`。
 * 工具 link_send/link_status；命令 /link；状态钩子（input/turn_start/agent_settled/agent_end）。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { execSync } from 'node:child_process';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { registerCommand, sendMessage } from '../../adapters/ui-adapter';
import {
  loadConfig,
  configPath,
  getDevice,
  describeDevice,
  saveDevice,
  buildCard,
  validateCard,
  cardToDevice,
  readActive,
  isActive,
  isUnattendedEnv,
  selfName,
  writeLocalState,
  touchActive,
  appendOutbox,
  extractFinalReply,
  fmtResult,
  listDevices,
  helpText,
  OUTBOX_MAX,
} from './logic';
import type { LinkConfig, DeviceConfig } from './logic';
import { probeDevice, sendToDevice, watchRemote, readRemoteOutbox, attachToRemote } from './protocol';
import type { SendOptions } from './protocol';

export function register(pi: ExtensionAPI): void {
  let cfg: LinkConfig = loadConfig();
  const me = selfName(cfg.selfName);
  const refreshCfg = (): void => {
    cfg = loadConfig();
  };

  let tmuxFailCache = 0;
  const TMUX_FAIL_TTL_MS = 60_000;
  const detectTmuxSession = (): string | undefined => {
    if (Date.now() - tmuxFailCache < TMUX_FAIL_TTL_MS) return undefined;
    try {
      if (process.env.TMUX) {
        const out = execSync('tmux display-message -p "#S" 2>/dev/null', { timeout: 3000 }).toString().trim();
        if (out) return out;
      }
    } catch {
      if (process.env.TMUX) tmuxFailCache = Date.now();
    }
    return undefined;
  };

  // ── link_send ──
  registerTool(pi, {
    name: 'link_send',
    description:
      '向其他设备（局域网/Tailscale）上的 pi 发送消息并等待处理完成。用于跨设备委派/查询。设备清单在 portable/agent/pi-link.json，/link help 查看用法。',
    parameters: {
      device: { type: 'string', description: '目标设备别名（pi-link.json 中的键）' },
      message: { type: 'string', description: '要发送给远程 pi 的消息/任务指令' },
      timeoutSec: { type: 'number', description: '覆盖默认超时（秒），默认 600', optional: true },
    },
    execute: async (params) => {
      refreshCfg();
      const name = String(params.device ?? '');
      const message = String(params.message ?? '');
      if (!name) return '缺少 device 参数';
      if (!message) return '缺少 message 参数';
      const dev = getDevice(cfg, name);
      if (!dev) return `未知设备 "${name}"。已配置: ${listDevices(cfg)}`;
      const active = readActive();
      if ((isUnattendedEnv() || !isActive(active)) && !(cfg.allowUnattended ?? false)) {
        const why = isUnattendedEnv()
          ? '当前是无人值守执行（定时任务）'
          : `本机最近用户交互在 ${active ? Math.round((Date.now() - active.lastActiveAt) / 60000) : '未知'} 分钟前`;
        return `${why}，跨设备指令已拒绝（防无人值守乱指挥）。可在 pi-link.json 设 allowUnattended: true。`;
      }
      const t = params.timeoutSec;
      const sendOpts: SendOptions = { fromName: me };
      if (typeof t === 'number' && t > 0) sendOpts.timeoutSec = Math.max(60, t);
      try {
        const r = await sendToDevice(dev, message, sendOpts, cfg.defaultTimeoutSec);
        return fmtResult(r);
      } catch (e) {
        return `link_send 失败: ${(e as Error).message}`;
      }
    },
  });

  // ── link_status ──
  registerTool(pi, {
    name: 'link_status',
    description: '查看 pi-link 设备清单与连通性（探测失败仅表示目标离线或 ssh 不可达，不影响本机）',
    parameters: {},
    execute: async () => {
      refreshCfg();
      const names = Object.keys(cfg.devices);
      if (names.length === 0) return '未配置任何设备。在 portable/agent/pi-link.json 添加后重试。';
      const lines: string[] = [`已配置 ${names.length} 台设备:`];
      const results = await Promise.allSettled(names.map((n) => probeDevice(cfg.devices[n])));
      names.forEach((n, i) => {
        const d = cfg.devices[n];
        const r =
          results[i].status === 'fulfilled'
            ? (results[i] as PromiseFulfilledResult<{ ok: boolean; latencyMs: number; detail?: string }>).value
            : { ok: false, latencyMs: 0, detail: String((results[i] as PromiseRejectedResult).reason) };
        lines.push(`  ${r.ok ? '●' : '○'} ${describeDevice(n, d)} — ${r.ok ? `可达 ${r.latencyMs}ms` : `不可达: ${r.detail ?? ''}`}`);
      });
      return lines.join('\n');
    },
  });

  // ── /link 命令 ──
  registerCommand(pi, 'link', {
    description: '多设备互联：发送/监听/收件箱',
    getArgumentCompletions: (prefix) => {
      const p = prefix ?? '';
      const parts = p.trim().split(/\s+/);
      const first = parts[0] ?? '';
      if (!p.includes(' ')) {
        return [
          { value: 'send ', label: 'send', description: '发送消息到设备' },
          { value: 'status', label: 'status', description: '查看设备状态' },
          { value: 'watch ', label: 'watch', description: '监听设备消息' },
          { value: 'inbox', label: 'inbox', description: '查看收件箱' },
          { value: 'attach ', label: 'attach', description: '附加文件并发送' },
          { value: 'export-card', label: 'export-card', description: '导出互联卡片' },
          { value: 'import-card ', label: 'import-card', description: '导入互联卡片' },
          { value: 'help', label: 'help', description: '显示用法' },
        ].filter((c) => c.value.startsWith(first));
      }
      if ((first === 'send' || first === 'watch') && parts.length === 2) {
        const sub = parts[1] ?? '';
        return Object.keys(cfg.devices)
          .filter((d) => d.startsWith(sub))
          .map((d) => ({ value: d + ' ', label: d, description: describeDevice(d, cfg.devices[d]) }));
      }
      return [];
    },
    handler: async (args, ctx) => {
      refreshCfg();
      const parts = (args ?? '').trim().split(/\s+/).filter(Boolean);
      const sub = parts[0] ?? 'help';
      const output = (text: string): void => {
        sendMessage(pi, { customType: 'pi-link', content: text, display: true }, { triggerTurn: false });
      };

      if (sub === 'help' || sub === '-h' || sub === '--help') {
        output(helpText());
        return;
      }
      if (sub === 'status') {
        const names = Object.keys(cfg.devices);
        if (names.length === 0) {
          ctx.ui.notify('未配置任何设备。编辑 portable/agent/pi-link.json 添加（见 /link help）。', 'info');
          return;
        }
        const lines = [`已配置 ${names.length} 台设备:`];
        const results = await Promise.allSettled(names.map((n) => probeDevice(cfg.devices[n])));
        names.forEach((n, i) => {
          const d = cfg.devices[n];
          const r =
            results[i].status === 'fulfilled'
              ? (results[i] as PromiseFulfilledResult<{ ok: boolean; latencyMs: number; detail?: string }>).value
              : { ok: false, latencyMs: 0, detail: String((results[i] as PromiseRejectedResult).reason) };
          lines.push(`  ${r.ok ? '●' : '○'} ${describeDevice(n, d)} — ${r.ok ? `可达 ${r.latencyMs}ms` : `不可达: ${r.detail ?? ''}`}`);
        });
        output(lines.join('\n'));
        return;
      }
      if (sub === 'send') {
        const device = parts[1];
        const message = parts.slice(2).join(' ');
        if (!device || !message) {
          ctx.ui.notify('用法: /link send <设备> <消息>', 'warning');
          return;
        }
        const dev = getDevice(cfg, device);
        if (!dev) {
          ctx.ui.notify(`未知设备 "${device}"。已配置: ${listDevices(cfg)}`, 'warning');
          return;
        }
        const active = readActive();
        if ((isUnattendedEnv() || !isActive(active)) && !(cfg.allowUnattended ?? false)) {
          ctx.ui.notify('无人值守环境或本机长时间无交互，跨设备指令已拒绝', 'warning');
          return;
        }
        const r = await sendToDevice(dev, message, { fromName: me }, cfg.defaultTimeoutSec);
        output(fmtResult(r));
        return;
      }
      if (sub === 'watch') {
        const device = parts[1];
        const rawLines = parts.includes('--lines') ? parseInt(parts[parts.indexOf('--lines') + 1] ?? '30', 10) : 30;
        const lines = Number.isNaN(rawLines) || rawLines < 1 ? 30 : Math.min(rawLines, 200);
        const dev = device ? getDevice(cfg, device) : undefined;
        if (!device || !dev) {
          ctx.ui.notify(`用法: /link watch <设备> [--lines N]。已配置: ${listDevices(cfg)}`, 'warning');
          return;
        }
        const r = await watchRemote(dev, lines);
        output(r.ok ? `远程 ${device} 会话尾部（${lines} 行）:\n\n${r.text}` : `观察失败: ${r.error}`);
        return;
      }
      if (sub === 'inbox') {
        const device = parts[1];
        const dev = device ? getDevice(cfg, device) : undefined;
        if (!device || !dev) {
          ctx.ui.notify(`用法: /link inbox <设备>。已配置: ${listDevices(cfg)}`, 'warning');
          return;
        }
        const r = await readRemoteOutbox(dev);
        if (!r.ok) {
          output(`读取失败: ${r.detail}`);
          return;
        }
        const entries = r.entries ?? [];
        const body =
          entries.length === 0
            ? '（空）'
            : entries.map((en) => `[${new Date(en.ts).toLocaleTimeString()}] ${en.text.slice(0, 300)}`).join('\n\n');
        output(`远程 ${device} 信箱（${entries.length}/${OUTBOX_MAX} 条）：\n${body}`);
        return;
      }
      if (sub === 'export-card') {
        output('本机设备卡片（复制给其他设备 import-card）：\n' + JSON.stringify(buildCard(cfg), null, 2));
        return;
      }
      if (sub === 'import-card') {
        const raw = (args ?? '').trim().slice(sub.length).trim();
        if (!raw) {
          ctx.ui.notify('用法: /link import-card <卡片JSON>', 'warning');
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          ctx.ui.notify('卡片不是合法 JSON', 'warning');
          return;
        }
        const v = validateCard(parsed);
        if (!v.ok || !v.card) {
          ctx.ui.notify(`卡片无效: ${v.detail}`, 'warning');
          return;
        }
        const r = saveDevice(configPath(), v.card.name, cardToDevice(v.card));
        output(r.detail);
        return;
      }
      if (sub === 'attach') {
        const force = parts.includes('--force');
        const rest = parts.filter((x) => x !== '--force');
        const device = rest[1];
        const text = rest.slice(2).join(' ');
        if (!device || !text) {
          ctx.ui.notify('用法: /link attach <设备> [--force] <要输入的文本>', 'warning');
          return;
        }
        const dev = getDevice(cfg, device);
        if (!dev) {
          ctx.ui.notify(`未知设备 "${device}"。已配置: ${listDevices(cfg)}`, 'warning');
          return;
        }
        const r = await attachToRemote(dev, text, undefined, force, me);
        output(r.ok ? r.detail : `介入失败: ${r.detail}`);
        return;
      }
      ctx.ui.notify(`未知子命令 "${sub}"。用法见 /link help`, 'warning');
    },
  });

  // ── 状态钩子 ──
  registerHook(pi, {
    event: 'input',
    handler: async (event) => {
      const e = event as { text?: string };
      touchActive(me, typeof e?.text === 'string' ? e.text : '');
    },
  });
  registerHook(pi, {
    event: 'agent_end',
    handler: async (event) => {
      const e = event as { messages?: unknown[] };
      const text = extractFinalReply(e?.messages ?? []);
      if (text) appendOutbox(me, text);
    },
  });
  writeLocalState({ device: me, status: 'idle', tmuxSession: detectTmuxSession() });
  registerHook(pi, {
    event: 'turn_start',
    handler: async () => {
      writeLocalState({ device: me, status: 'busy', tmuxSession: detectTmuxSession() });
    },
  });
  registerHook(pi, {
    event: 'agent_settled',
    handler: async () => {
      writeLocalState({ device: me, status: 'idle', tmuxSession: detectTmuxSession() });
    },
  });
}

export type { DeviceConfig, LinkConfig };
