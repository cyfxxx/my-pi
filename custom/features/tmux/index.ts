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
import { createCompletionWatcher, createIdleGate, NOTIFY_CUSTOM_TYPE } from './watcher';
import type { WatcherHandle } from './watcher';
import {
  loadTmuxConfig,
  clampWaitTimeout,
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
  parseTimeoutSeconds,
  resolvePromoteCeil,
  wrapWithCeiling,
  promoteSessionName,
  promoteNotice,
} from './logic';
import type { TmuxConfig } from './logic';

export function register(pi: ExtensionAPI): void {
  const cfg: TmuxConfig = loadTmuxConfig();
  const handles = new Map<string, WatcherHandle>();

  // ── 空闲门：完成通知必须"**空闲**才 triggerTurn" ──────────────────────────────
  //
  // 为什么必须门（2026-10-07 无头实验结论，见 DECISIONS 的"空闲门"条）：pi 在 agent 忙碌时
  // 收到 `triggerTurn` 会**直接致命报错**（`Agent is already processing...`），扩展 catch 不住、
  // 进程 rc=1、什么都不落盘。而 tmux 会话**随时**可能结束——此前之所以没炸，是因为项目约定
  // "启动后台后立即结束回合"，通知到达时 agent 恰好空闲。一旦允许"等待期间继续做独立步骤"
  // （这正是"减少中断"要的那条改动），忙碌态通知就会变成随机崩溃。
  //
  // 纯逻辑在 `watcher.ts` 的 createIdleGate（可单测）；这里只把它接到 pi 的生命周期事件上。
  const idleGate = createIdleGate((text) => {
    try {
      sendMessage(pi, { customType: NOTIFY_CUSTOM_TYPE, content: text, display: true }, { triggerTurn: true });
    } catch {
      /* 会话可能已关闭：放弃这次唤醒（日志已落盘，用户下次看得到） */
    }
  });
  registerHook(pi, {
    event: 'turn_start',
    handler: async () => {
      idleGate.setBusy(true);
    },
  });
  registerHook(pi, {
    event: 'agent_settled',
    handler: async () => {
      idleGate.setBusy(false);
    },
  });

  const watcher = createCompletionWatcher({
    hasSession: (name) => hasSession(cfg, name),
    notify: async (text) => {
      idleGate.notify(text);
    },
    onDone: (name) => {
      handles.delete(name);
      unregisterSession(name);
    },
  });

  // ── bash 超时 → 转后台（编排优化第 2 项，2026-10-07）────────────────────────────
  //
  // 现状：my-pi 给未写 `timeout` 的 bash 注入 240s 上限，超时后 pi **杀掉整个进程树**
  // （`core/tools/bash.ts`：`throw new Error("timeout:<秒>")`）→ **工作直接丢失**，只剩一段
  // 不完整输出。对照 DSH：超时被**提升为后台 job**，结果可以事后收。
  //
  // 处置：在这里接住"超时失败"的 bash 结果，把**原命令**用 tmux 重跑并交给完成 watcher
  // （watcher 走空闲门，所以忙碌态也安全——见上面 createIdleGate 的说明）。
  //
  // 关键约束：转后台**必须再加一层硬上限**（`wrapWithCeiling`）。否则一个死循环会从
  // "240s 后被杀"变成"**永远占着机器**"——那比丢工作更糟。上限取 `PI_BASH_PROMOTE_CEIL_S`
  // （默认 3600s，<=0 表示不加，风险自负）。
  //
  // 不做 triggerTurn：这条消息是给**当前这一轮**看的（模型据此知道命令已在后台），
  // 会话真正结束时的唤醒由 watcher 负责。
  const promoteEnabled = process.env.PI_BASH_PROMOTE !== 'off';
  const promoteCeil = resolvePromoteCeil(process.env.PI_BASH_PROMOTE_CEIL_S);
  registerHook(pi, {
    event: 'tool_result',
    handler: async (event) => {
      if (!promoteEnabled) return;
      const e = event as {
        toolName?: string;
        input?: { command?: unknown; cwd?: unknown };
        content?: unknown;
        isError?: boolean;
      };
      if (e.toolName !== 'bash' || e.isError !== true) return;
      const command = typeof e.input?.command === 'string' ? e.input.command : '';
      if (!command.trim()) return;
      let text = '';
      if (typeof e.content === 'string') text = e.content;
      else if (Array.isArray(e.content)) {
        text = (e.content as { type?: string; text?: string }[])
          .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string)
          .join('\n');
      }
      const timedOutAt = parseTimeoutSeconds(text);
      if (timedOutAt === null) return;
      try {
        const wrapped = wrapWithCeiling(command, promoteCeil);
        const name = normalizeSessionName(promoteSessionName(Date.now()), cfg.prefix);
        const res = await startSession(cfg, name, wrapped, typeof e.input?.cwd === 'string' ? e.input.cwd : undefined);
        if (!res.started) return;
        registerSession({
          name: res.name,
          logPath: res.logPath,
          command: wrapped,
          createdAt: new Date().toISOString(),
          owner: process.env.PI_SESSION_ID || undefined,
        });
        handles.get(res.name)?.stop();
        handles.set(res.name, watcher.watch(res.name, res.logPath, true));
        sendMessage(pi, {
          customType: NOTIFY_CUSTOM_TYPE,
          content: promoteNotice(res.name, res.logPath, promoteCeil, timedOutAt),
          display: true,
        });
      } catch {
        /* 转后台只是补救手段：tmux 不可用等情况静默放弃（原始超时结果已在上下文里） */
      }
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
        // 截断原因分开写：长跑日志必然超过 lines 行，"省略前 N 行"与"又被字符窗口切"是两回事，
        // 只说"已截断"会让人以为工具坏了（此前长日志恒报一句无细节的 [输出已截断]）。
        const why = [out.omittedLines > 0 ? `省略前 ${out.omittedLines} 行` : '', out.cutByChars ? '仅保留末尾字符窗口' : '']
          .filter(Boolean)
          .join('，');
        const note = out.truncated ? `\n\n[输出已截断${why ? `：${why}` : ''}]` : '';
        return out.text ? `${out.text}${note}` : '(无输出)';
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
      timeout: {
        type: 'number',
        description:
          cfg.waitCeilSec > 0
            ? `超时秒数（默认 ${cfg.defaultTimeoutSec}；受硬上限 ${cfg.waitCeilSec}s 截断）`
            : `超时秒数（默认 ${cfg.defaultTimeoutSec}）`,
        optional: true,
      },
      until_exit: { type: 'boolean', description: '等待会话结束（默认 false；true 时 pattern 忽略）', optional: true },
    },
    execute: async (args) => {
      try {
        const name = normalizeSessionName(args.name as string, cfg.prefix);
        // 硬上限（P4）：同轮内阻塞等待被限制在 cfg.waitCeilSec（默认 60s，PI_TMUX_WAIT_CEIL_SEC 可调）。
        // 软引导"确需等待 timeout≤60s"此前只写在 AGENTS.md，实测未被稳定遵守。
        const wt = clampWaitTimeout(args.timeout as number | undefined, cfg.defaultTimeoutSec, cfg.waitCeilSec);
        const res = await waitSession(cfg, name, args.pattern as string | undefined, wt.seconds * 1000, Boolean(args.until_exit));
        const head = res.outcome === 'exited' ? '会话已结束' : res.outcome === 'pattern' ? '匹配到关键字' : '等待超时';
        const note = wt.clamped
          ? `\n\n[已按 ${wt.ceiling}s 硬上限截断（请求 ${wt.requested}s）。长任务请 tmux_run 后结束回合，会话结束会由 watcher 自动通知。]`
          : '';
        return `${head}。${note}\n\n${res.lastOutput.slice(-4000) || '(无输出)'}`;
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
