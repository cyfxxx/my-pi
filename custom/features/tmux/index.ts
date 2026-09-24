/**
 * Tmux Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-tmux/{index,tools}.ts`。
 * 会话统一 pi- 前缀；退出时仅清理本扩展注册表内、owner 匹配的 pi- 会话。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { sendMessage } from '../../adapters/ui-adapter';
import { createCompletionWatcher, NOTIFY_CUSTOM_TYPE } from './watcher';
import type { WatcherHandle } from './watcher';
import {
  loadTmuxConfig,
  normalizeSessionName,
  startSession,
  listSessions,
  probeSession,
  readOutput,
  sendKeys,
  killSession,
  waitSession,
  loadRegistry,
  registerSession,
  unregisterSession,
  hasSession,
  removeLog,
  shutdownCleanup,
  tmuxMissingError,
} from './logic';
import type { TmuxConfig } from './logic';

export function register(pi: ExtensionAPI): void {
  const cfg: TmuxConfig = loadTmuxConfig();
  // 完成自动唤醒：tmux 会话结束后注入通知并触发新回合（实现见 ./watcher）
  const handles = new Map<string, WatcherHandle>();
  const watcher = createCompletionWatcher({
    hasSession: (name) => hasSession(cfg, name),
    notify: async (text) => {
      sendMessage(pi, { customType: NOTIFY_CUSTOM_TYPE, content: text, display: true }, { triggerTurn: true });
    },
    onDone: (name) => {
      handles.delete(name);
      unregisterSession(name);
    },
  });

  const fail = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e);
    return /ENOENT|command not found/i.test(msg) ? tmuxMissingError(msg) : `错误: ${msg}`;
  };

  registerTool(pi, {
    name: 'tmux_run',
    description:
      '在后台 tmux 会话中运行 shell 命令（长任务/dev server/交互程序）。会话持久，输出落日志；用 tmux_read 查看、tmux_wait 等待完成。',
    parameters: {
      name: { type: 'string', description: '会话名（仅字母数字下划线中划线，自动加 pi- 前缀）' },
      command: { type: 'string', description: '要执行的 shell 命令' },
      cwd: { type: 'string', description: '工作目录（默认 ~）', optional: true },
    },
    execute: async (args) => {
      try {
        const name = normalizeSessionName(args.name as string, cfg.prefix);
        const res = await startSession(cfg, name, args.command as string, args.cwd as string | undefined);
        if (res.started) {
          registerSession({
            name: res.name,
            logPath: res.logPath,
            command: args.command as string,
            createdAt: new Date().toISOString(),
            owner: process.env.PI_SESSION_ID || undefined,
          });
          // 注册完成自动唤醒：会话结束即通知并触发新回合（不必等用户下轮才发现结果）
          handles.get(res.name)?.stop();
          handles.set(res.name, watcher.watch(res.name, res.logPath, true));
          return `已在 tmux 会话 ${res.name} 后台启动。\n日志: ${res.logPath}\n用 tmux_read 查看输出，tmux_wait 等待完成。`;
        }
        return `会话 ${res.name} 已存在，未重复启动。日志: ${res.logPath}`;
      } catch (e) {
        return fail(e);
      }
    },
  });

  registerTool(pi, {
    name: 'tmux_status',
    description: '列出所有 tmux 会话（含非 pi- 前缀的用户会话），标注是否附加；可指定会话名查看单个。',
    parameters: {
      name: { type: 'string', description: '可选：指定会话名，仅查该会话是否存活', optional: true },
    },
    execute: async (args) => {
      try {
        if (args.name) {
          const name = normalizeSessionName(args.name as string, cfg.prefix);
          const probe = await probeSession(cfg, name);
          return `会话 ${name}: ${probe === 'alive' ? '存活' : probe === 'gone' ? '不存在' : '探测失败（tmux 不可用？）'}`;
        }
        const sessions = await listSessions(cfg);
        if (!sessions.length) return '当前没有 tmux 会话。';
        return sessions.map((s) => `${s.name}${s.attached ? ' (attached)' : ''}`).join('\n');
      } catch (e) {
        return fail(e);
      }
    },
  });

  registerTool(pi, {
    name: 'tmux_read',
    description: '读取 tmux 会话最近的输出（优先日志尾部 N 行，缺失时回退 capture-pane 当前屏幕）。',
    parameters: {
      name: { type: 'string', description: '会话名' },
      lines: { type: 'number', description: `读取尾部行数（默认 ${cfg.defaultLines}）`, optional: true },
    },
    execute: async (args) => {
      try {
        const name = normalizeSessionName(args.name as string, cfg.prefix);
        const out = await readOutput(cfg, name, (args.lines as number) ?? cfg.defaultLines);
        // 用户已人工查看：该会话完成时不再重复通知
        watcher.ack(name);
        return out.truncated ? `${out.text}\n\n[输出已截断]` : out.text || '(无输出)';
      } catch (e) {
        return fail(e);
      }
    },
  });

  registerTool(pi, {
    name: 'tmux_send',
    description: '向 tmux 会话发送文本/按键：文本默认回车执行，或发送 Ctrl 组合键（如 c=Ctrl+C 中断）。',
    parameters: {
      name: { type: 'string', description: '会话名' },
      text: { type: 'string', description: '要输入的文本', optional: true },
      ctrl_key: { type: 'string', description: 'Ctrl 组合键字母，如 "c"=Ctrl+C；与 text 二选一', optional: true },
      enter: { type: 'boolean', description: '发送后是否回车（默认 text 时 true）', optional: true },
    },
    execute: async (args) => {
      try {
        const name = normalizeSessionName(args.name as string, cfg.prefix);
        const text = args.text as string | undefined;
        const enter = args.enter === undefined ? Boolean(text) : Boolean(args.enter);
        await sendKeys(cfg, name, { text, ctrlKey: args.ctrl_key as string | undefined, enter });
        return `已向 ${name} 发送${args.ctrl_key ? ` Ctrl+${args.ctrl_key}` : ''}${text ? ' 文本' : ''}${enter ? ' + 回车' : ''}。`;
      } catch (e) {
        return fail(e);
      }
    },
  });

  registerTool(pi, {
    name: 'tmux_stop',
    description: '结束 tmux 会话（kill-session）。可选删除日志文件。',
    parameters: {
      name: { type: 'string', description: '会话名' },
      remove_log: { type: 'boolean', description: '是否同时删除日志文件（默认 false）', optional: true },
    },
    execute: async (args) => {
      try {
        const name = normalizeSessionName(args.name as string, cfg.prefix);
        // 主动结束：丢弃监听器与待发通知
        handles.get(name)?.stop();
        handles.delete(name);
        await killSession(cfg, name);
        unregisterSession(name);
        if (args.remove_log) removeLog(cfg, name);
        return `会话 ${name} 已结束。`;
      } catch (e) {
        return fail(e);
      }
    },
  });

  registerTool(pi, {
    name: 'tmux_wait',
    description:
      '轮询等待会话结束/日志出现 pattern/超时返回。阻塞式；仅本轮必须拿结果时才用，否则 tmux_run 后直接结束回合，下轮 tmux_read 查看。',
    parameters: {
      name: { type: 'string', description: '会话名' },
      pattern: { type: 'string', description: '等待日志中出现的关键字（可选）', optional: true },
      timeout: { type: 'number', description: `超时秒数（默认 ${cfg.defaultTimeoutSec}）`, optional: true },
      until_exit: { type: 'boolean', description: '等待会话结束（默认 false；true 时 pattern 忽略）', optional: true },
    },
    execute: async (args) => {
      try {
        const name = normalizeSessionName(args.name as string, cfg.prefix);
        const timeoutSec = (args.timeout as number) ?? cfg.defaultTimeoutSec;
        const res = await waitSession(cfg, name, args.pattern as string | undefined, timeoutSec * 1000, Boolean(args.until_exit));
        const head = res.outcome === 'exited' ? '会话已结束' : res.outcome === 'pattern' ? '匹配到关键字' : '等待超时';
        return `${head}。\n\n${res.lastOutput.slice(-4000) || '(无输出)'}`;
      } catch (e) {
        return fail(e);
      }
    },
  });

  // 退出清理：仅清理 pi- 前缀且在本扩展注册表中的会话（owner 匹配或无主），不碰用户会话
  registerHook(pi, {
    event: 'session_shutdown',
    handler: async () => {
      // 完成唤醒监听器随会话结束清理（定时器已 unref，这里显式停止防跨会话残留）
      watcher.stopAll();
      handles.clear();
      try {
        const reg = loadRegistry();
        const sessions = await listSessions(cfg);
        await shutdownCleanup(cfg, reg, sessions, cfg.prefix, process.env.PI_SESSION_ID || '');
      } catch {
        /* 清理失败不影响退出 */
      }
    },
  });
}
