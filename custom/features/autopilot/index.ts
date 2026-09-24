/**
 * Autopilot Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/{index,commands,tools}.ts`（核心）。
 * 提供任务调度存储/策略/遥测/失败自愈判定，`/auto` 与 `/schedule` 命令。
 * 后台执行循环/watchdog/verifier/seeds/notifications/sessions 已实现；未迁移：Best-of-N 的 LLM 集成。
 * 会话切换/重启：admin_* 工具写 portable/agent/autopilot/state.json，由 scripts/pi-supervisor.sh 消费后以 --session 重拉。
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { registerCommand } from '../../adapters/ui-adapter';
import { parseSubcommand, filterCompletions } from '../../core/cli';
import { listSessions, resolveSession } from '../../adapters/session-adapter';
import { formatSessionList } from './store/sessions';
import { syncSeedTasks } from './store/seeds';
import { collectUnread, formatSummary, writeSeenTs } from './store/notifications';
import {
  readAutopilotConfig,
  writeAutopilotConfig,
  readTelemetry,
  statsByModel,
  statsByTask,
  formatBudgetUsage,
  planFailover,
  executeFailover,
  checkBudget,
  schedulerOverview,
  currentModel,
  isLocalModel,
  readState,
  writeRestartRequest,
  listTasks,
  addTask,
  deleteTask,
  updateTask,
  updateTaskAfterRun,
  previewCron,
  renderPrompt,
  formatInterval,
  parseIntervalToMs,
  computeNextRun,
  isDue,
  decide,
  classifyError,
  appendRun,
  estimateCost,
  touchActivity,
  setTurnBusy,
  setBackgroundBusy,
  isHanging,
  isStuckTurn,
  triggerHangRecovery,
  resetWatchdogState,
  collectMetrics,
  formatMetrics,
} from './logic';
import type { TaskType, FallbackModel, Task } from './logic';
import { runTaskOnce } from './run/runner';
import { sendWebhook } from './store/webhook';
import { registerAdminTools } from './tools/admin-tools';
import { registerScheduleTool } from './tools/schedule-tool';
import { registerVerifyTools } from './tools/verify-tools';

function fmtTask(t: Task): string {
  const flag = t.enabled ? '●' : '○';
  const next = t.nextRun ? new Date(t.nextRun).toLocaleString() : '-';
  const result = t.lastResult ? ` last=${t.lastResult}` : '';
  return `${flag} ${t.name} [${t.type}:${t.schedule}] next=${next} runs=${t.runCount}${result}`;
}

export function register(pi: ExtensionAPI): void {
  // ── 工具：admin（状态/模型/配置）、autopilot_policy、schedule_task、verify_* ──
  registerAdminTools(pi);
  registerScheduleTool(pi);
  registerVerifyTools(pi);

  // ── 工具：状态/统计/失败转移 ──
  registerTool(pi, {
    name: 'autopilot_status',
    description: '查看自动驾驶/调度器状态与预算使用',
    parameters: {},
    execute: async () => {
      const ov = schedulerOverview();
      const runs = readTelemetry();
      const cm = currentModel();
      return [
        `自动驾驶: ${readAutopilotConfig().enabled ? '已启用' : '已禁用'}`,
        `调度器: 任务 ${ov.total}（启用 ${ov.enabled}）${ov.paused ? ' [已暂停]' : ''}`,
        `当前模型: ${cm.provider}/${cm.model}${isLocalModel() ? '（本地）' : ''}`,
        formatBudgetUsage(runs),
      ].join('\n');
    },
  });

  registerTool(pi, {
    name: 'autopilot_stats',
    description: '查看按模型/任务的运行统计',
    parameters: {},
    execute: async () => {
      const runs = readTelemetry();
      const models = statsByModel(runs).slice(0, 5);
      const tasks = statsByTask(runs).slice(0, 5);
      const fmtR = (n: number): string => `${(n * 100).toFixed(0)}%`;
      return [
        '按模型:',
        ...(models.length ? models.map((m) => `  ${m.provider}/${m.model}: ${m.runs} 次, 成功率 ${fmtR(m.successRate)}, $${m.totalCost.toFixed(4)}`) : ['  (无)']),
        '按任务:',
        ...(tasks.length ? tasks.map((t) => `  ${t.taskName}: ${t.runs} 次, 成功率 ${fmtR(t.successRate)}`) : ['  (无)']),
      ].join('\n');
    },
  });

  registerTool(pi, {
    name: 'autopilot_failover',
    description: '查看/触发模型故障转移（默认 dry-run 预览）',
    parameters: {
      execute: { type: 'boolean', description: 'true 时实际写入切换请求（默认 false 仅预览）', optional: true },
    },
    execute: async (args, ctx) => {
      const c = readAutopilotConfig();
      const cm = currentModel();
      const plan = planFailover(c.fallbackModels, cm.provider, cm.model);
      if (!plan.target) return `无法转移: ${plan.reason}`;
      return executeFailover(plan.target, plan.reason, !(args.execute === true), ctx?.sessionFile);
    },
  });

  // ── 工具：会话列表/切换、重启（admin 组）──
  registerTool(pi, {
    name: 'admin_list_sessions',
    description: '列出会话文件（可按工作目录过滤），按修改时间倒序。',
    parameters: {
      cwd: { type: 'string', description: '工作目录（可选），不传时列出全部会话', optional: true },
    },
    execute: async (args) => {
      const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : undefined;
      const result = await listSessions(cwd);
      if (!result.success) return `列出会话失败：${result.error ?? '未知错误'}`;
      const rows = result.data ?? [];
      return cwd && rows.length === 0 ? `(未找到会话 在 ${cwd})` : formatSessionList(rows);
    },
  });

  registerTool(pi, {
    name: 'admin_switch_session',
    description: '切换到指定会话文件（按 sessionId 前缀或路径）。将写入重启请求并由 supervisor 以 --session 重新启动。',
    parameters: {
      target: { type: 'string', description: '会话 ID（支持前缀匹配）或 .jsonl 文件路径' },
      reason: { type: 'string', description: '切换原因（可选）', optional: true },
    },
    execute: async (args, ctx) => {
      const target = String(args.target ?? '').trim();
      if (!target) return '缺少 target（会话 ID 前缀或路径）。';
      const session = await resolveSession(target);
      if (!session) return `未找到匹配的会话: ${target}`;
      if (!ctx?.hasUI) {
        return '无 UI 环境禁止直接切换会话（会重启 Agent）。请在 TUI 会话中执行，或设置 PI_AUTOPILOT_ALLOW_HEADLESS=1 显式放行。';
      }
      const confirmed = await ctx.confirm?.('切换会话', `将切换到会话 ${session.id}，需要重启 Agent。是否继续？`);
      if (!confirmed) return '已取消会话切换';
      const reason = typeof args.reason === 'string' ? args.reason : undefined;
      writeRestartRequest('switch_session', { targetSession: session.path, reason: reason || `切换到会话 ${session.id}` });
      ctx.shutdown?.();
      return `正在切换到会话 ${session.id}...`;
    },
  });

  registerTool(pi, {
    name: 'admin_restart',
    description: '重启 Agent 程序（写重启请求，由 supervisor 重新拉起；当前会话会自动保存）。如不需要重启请拒绝调用。',
    parameters: {
      reason: { type: 'string', description: '重启原因（可选）', optional: true },
    },
    execute: async (args, ctx) => {
      const reason = typeof args.reason === 'string' ? args.reason : undefined;
      // 显式带上当前会话：supervisor 用 --session 重拉，不依赖「最近会话」推断
      // （多会话并存/子代理会话更新时间更晚时会续错会话）。
      writeRestartRequest('restart', { targetSession: ctx?.sessionFile, reason: reason || '手动重启' });
      ctx?.shutdown?.();
      return '已提交重启请求，Agent 即将重启。';
    },
  });

  // ── /auto 命令 ──
  registerCommand(pi, 'auto', {
    description: '自动驾驶状态与策略管理',
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: 'status', label: 'status', description: '运行状态与调度概览' },
        { value: 'stats', label: 'stats', description: '按模型的运行统计' },
        { value: 'metrics', label: 'metrics', description: '运行质量指标' },
        { value: 'policy', label: 'policy', description: '查看策略与预算' },
        { value: 'failover', label: 'failover', description: '故障转移（加 --exec 执行）' },
        { value: 'pause', label: 'pause', description: '暂停自动驾驶' },
        { value: 'resume', label: 'resume', description: '恢复自动驾驶' },
        { value: 'help', label: 'help', description: '显示用法' },
      ];
      const f = filterCompletions(subs, prefix);
      return f.length ? f : null;
    },
    handler: async (args, ctx) => {
      const { sub, rest } = parseSubcommand(args);
      const c = readAutopilotConfig();
      const cm = currentModel();
      const runs = readTelemetry();

      if (!sub || sub === 'help') {
        ctx.ui.notify(
          '/auto <子命令>\n  status   运行状态与调度概览\n  stats    按模型的运行统计\n  metrics  运行质量指标\n  policy   查看策略与预算\n  failover 故障转移（加 --exec 执行）\n  pause    暂停自动驾驶\n  resume   恢复自动驾驶',
          'info',
        );
        return;
      }
      if (sub === 'status') {
        const ov = schedulerOverview();
        ctx.ui.notify(
          `自动驾驶: ${c.enabled ? '启用' : '禁用'}\n调度器: ${ov.total} 任务（启用 ${ov.enabled}）${ov.paused ? ' [暂停]' : ''}\n当前模型: ${cm.provider}/${cm.model}\n${formatBudgetUsage(runs)}`,
          'info',
        );
        return;
      }
      if (sub === 'stats') {
        const models = statsByModel(runs).slice(0, 5);
        ctx.ui.notify(models.length ? models.map((m) => `${m.provider}/${m.model}: ${m.runs} 次, 成功率 ${(m.successRate * 100).toFixed(0)}%`).join('\n') : '暂无遥测数据', 'info');
        return;
      }
      if (sub === 'metrics') {
        ctx.ui.notify(formatMetrics(collectMetrics()), 'info');
        return;
      }
      if (sub === 'policy') {
        ctx.ui.notify(
          `failoverAfter=${c.policy.failoverAfter} suspendAfter=${c.policy.suspendAfter} timeoutFactor=${c.policy.timeoutFactor}\nfallbackModels: ${c.fallbackModels.map((f) => `${f.provider}/${f.model}`).join(', ') || '(无)'}\n预算: ${c.budget.maxRunsPerDay} 次/日, $${c.budget.maxCostPerDay ?? 0}/日`,
          'info',
        );
        return;
      }
      if (sub === 'failover') {
        const plan = planFailover(c.fallbackModels, cm.provider, cm.model);
        if (!plan.target) {
          ctx.ui.notify(`无法转移: ${plan.reason}`, 'info');
          return;
        }
        const dry = !rest.includes('--exec');
        ctx.ui.notify(executeFailover(plan.target, plan.reason, dry), 'info');
        return;
      }
      if (sub === 'pause') {
        writeAutopilotConfig({ ...c, enabled: false });
        ctx.ui.notify('自动驾驶已暂停', 'info');
        return;
      }
      if (sub === 'resume') {
        writeAutopilotConfig({ ...c, enabled: true });
        ctx.ui.notify('自动驾驶已恢复', 'info');
        return;
      }
      ctx.ui.notify(`未知子命令: ${sub}`, 'info');
    },
  });

  // ── /schedule 命令 ──
  registerCommand(pi, 'schedule', {
    description: '定时任务管理',
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: 'list', label: 'list', description: '列出所有任务' },
        { value: 'loop ', label: 'loop', description: '固定间隔任务（如 loop 5m <任务>）' },
        { value: 'remind ', label: 'remind', description: '一次性提醒（如 remind +30m <任务>）' },
        { value: 'cron ', label: 'cron', description: 'cron 任务（如 cron "0 9 * * 1-5" <任务>）' },
        { value: 'edit ', label: 'edit', description: '修改任务字段' },
        { value: 'delete ', label: 'delete', description: '删除任务' },
        { value: 'enable ', label: 'enable', description: '启用任务' },
        { value: 'disable ', label: 'disable', description: '禁用任务' },
        { value: 'preview ', label: 'preview', description: '预览 cron 下次触发' },
        { value: 'history ', label: 'history', description: '查看执行历史' },
        { value: 'help', label: 'help', description: '显示用法' },
      ];
      const first = (prefix.split(/\s+/)[0] ?? '');
      if (!prefix.includes(' ')) {
        const f = filterCompletions(subs, first);
        return f.length ? f : null;
      }
      return null;
    },
    handler: async (args, ctx) => {
      const { sub: subRaw, rest } = parseSubcommand(args);
      const sub = subRaw || 'list';
      const help =
        '/schedule list                        列出任务\n' +
        '/schedule loop <间隔> <任务>          固定间隔（如 5m/1h）\n' +
        '/schedule remind <时间> <任务>        一次性（如 +30m 或 ISO）\n' +
        '/schedule cron <表达式> <任务>        POSIX cron（如 "0 9 * * 1-5"）\n' +
        '/schedule edit <名> <字段> <值>       修改（schedule/type/enabled/prompt）\n' +
        '/schedule delete <名>                 删除\n' +
        '/schedule enable|disable <名>         启用/禁用\n' +
        '/schedule preview <cron>              预览 cron 下次触发\n' +
        '/schedule history <名>                查看执行历史';

      try {
        if (sub === 'help' || (sub !== 'list' && rest.length === 0 && sub !== 'help')) {
          if (sub === 'help' || !['list'].includes(sub)) {
            ctx.ui.notify(help, 'info');
            return;
          }
        }
        if (sub === 'list') {
          const tasks = listTasks();
          ctx.ui.notify(tasks.length ? tasks.map(fmtTask).join('\n') : '暂无调度任务', 'info');
          return;
        }
        if (sub === 'preview') {
          if (!rest[0]) {
            ctx.ui.notify('用法: /schedule preview <cron 表达式>', 'info');
            return;
          }
          ctx.ui.notify(previewCron(rest.join(' '), 5).join('\n'), 'info');
          return;
        }
        if (sub === 'history') {
          const name = rest.join(' ');
          const t = listTasks().find((x) => x.name === name);
          if (!t) {
            ctx.ui.notify(`未找到任务: ${name}`, 'warning');
            return;
          }
          ctx.ui.notify(
            t.history.length
              ? t.history.map((h) => `[${h.time}] ${h.result}: ${h.output.slice(0, 120)}`).join('\n')
              : '暂无历史',
            'info',
          );
          return;
        }
        if (sub === 'delete' || sub === 'enable' || sub === 'disable') {
          const name = rest.join(' ');
          if (!name) {
            ctx.ui.notify(`用法: /schedule ${sub} <名>`, 'info');
            return;
          }
          if (sub === 'delete') {
            const ok = await deleteTask(name);
            ctx.ui.notify(ok ? `已删除 ${name}` : `未找到 ${name}`, ok ? 'info' : 'warning');
          } else {
            const t = await updateTask(name, { enabled: sub === 'enable' });
            ctx.ui.notify(t ? `已${sub === 'enable' ? '启用' : '禁用'} ${name}` : `未找到 ${name}`, t ? 'info' : 'warning');
          }
          return;
        }
        if (sub === 'edit') {
          const [name, field, ...valParts] = rest;
          if (!name || !field || valParts.length === 0) {
            ctx.ui.notify('用法: /schedule edit <名> <schedule|type|enabled|prompt> <值>', 'info');
            return;
          }
          const raw = valParts.join(' ');
          const updates: Record<string, unknown> = {};
          if (field === 'enabled') updates.enabled = raw === 'true' || raw === '1';
          else if (field === 'schedule' || field === 'type' || field === 'prompt') updates[field] = raw;
          else {
            ctx.ui.notify(`不支持的字段: ${field}`, 'warning');
            return;
          }
          const t = await updateTask(name, updates as never);
          ctx.ui.notify(t ? `已更新 ${name}` : `未找到 ${name}`, t ? 'info' : 'warning');
          return;
        }
        if (sub === 'loop' || sub === 'remind' || sub === 'cron') {
          let type: TaskType;
          let schedule: string;
          let prompt: string;
          if (sub === 'cron') {
            type = 'cron';
            // cron 表达式 5 字段
            schedule = rest.slice(0, 5).join(' ');
            prompt = rest.slice(5).join(' ');
          } else {
            type = sub === 'remind' ? 'once' : 'interval';
            schedule = rest[0];
            prompt = rest.slice(1).join(' ');
          }
          if (!schedule || !prompt) {
            ctx.ui.notify(`用法: /schedule ${sub} ${sub === 'cron' ? '"<表达式>" ' : '<时间> '}<任务>`, 'info');
            return;
          }
          const name = `task-${Date.now().toString(36)}`;
          const task = await addTask({ name, type, schedule: schedule.replace(/^"|"$/g, ''), prompt });
          ctx.ui.notify(`已创建任务 ${name}\n${fmtTask(task)}`, 'info');
          return;
        }
        ctx.ui.notify(help, 'info');
      } catch (e) {
        ctx.ui.notify(`调度错误: ${(e as Error).message}`, 'error');
      }
    },
  });

  // ── 执行循环：每分钟检查到期任务并运行（子进程隔离）──
  let running = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const runDueTasks = async (ctx: ExtensionContext): Promise<void> => {
    if (running) return;
    const c = readAutopilotConfig();
    if (!c.enabled) return;
    const due = listTasks().filter((t) => t.enabled && isDue(t));
    if (due.length === 0) return;
    running = true;
    setBackgroundBusy(true);
    const notify = (t: string, l: 'info' | 'warning' | 'error'): void => {
      try {
        if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(t, l);
      } catch {
        /* stale ctx */
      }
    };
    try {
      for (const task of due) {
        const { provider, model } = currentModel();
        const budget = checkBudget(c.budget, `${provider}/${model}`);
        if (!budget.allowed) {
          notify(`autopilot: 跳过 ${task.name}（${budget.reason}）`, 'info');
          continue;
        }
        const r = await runTaskOnce(task, process.cwd());
        await appendRun({
          ts: new Date().toISOString(),
          taskId: task.id,
          taskName: task.name,
          model,
          provider,
          result: r.result,
          durationMs: r.durationMs,
          outputLen: r.output.length,
          estCost: estimateCost(provider, model, task.prompt.length, r.output.length),
          errClass: r.result === 'failed' ? classifyError(r.stderr || r.output, r.exitCode) : null,
        });
        await updateTaskAfterRun(task.id, r.result, r.output, r.durationMs);
        // 完成通知：任务显式开启 notifyOnCompletion 且配了 webhookUrl/PI_SCHEDULER_WEBHOOK 时发送
        if (task.notifyOnCompletion) {
          void sendWebhook(task, r.result, r.output);
        }
        if (r.result === 'failed') {
          const errClass = classifyError(r.stderr || r.output, r.exitCode);
          const decision = decide(task, errClass, c.policy, c.fallbackModels, {
            stderr: r.stderr || r.output,
            exitCode: r.exitCode,
            promptLen: task.prompt.length,
            outputLen: r.output.length,
            durationMs: r.durationMs,
          });
          notify(`autopilot 任务 ${task.name} 失败：${decision.note}`, 'warning');
        } else {
          notify(`autopilot 任务 ${task.name} 完成`, 'info');
        }
      }
    } finally {
      running = false;
      setBackgroundBusy(false);
    }
  };

  let hangNotified = false;
  let hangRecovering = false;
  const checkHang = (ctx: ExtensionContext): void => {
    const c = readAutopilotConfig();

    // 回合卡死（busyTurn 超过 2×maxIdleMinutes 仍无活动）：这是「真卡住」，不是用户空闲。
    // 仅在此时按配置自动请求重启；会话由 supervisor 以 --session 恢复。
    if (isStuckTurn(c.maxIdleMinutes)) {
      if (c.watchdogAutoRestart && !hangRecovering) {
        let sessionFile: string | undefined;
        try {
          sessionFile = ctx.sessionManager.getSessionFile();
        } catch {
          /* stale ctx */
        }
        if (triggerHangRecovery(c.maxIdleMinutes, Date.now(), sessionFile)) {
          hangRecovering = true;
          try {
            if (ctx.hasUI) {
              ctx.ui.notify('autopilot: 回合卡死超过宽限期，已请求重启恢复（会话自动恢复）', 'warning');
            }
          } catch {
            /* stale ctx */
          }
          ctx.shutdown?.();
          return;
        }
      }
      if (!hangNotified) {
        hangNotified = true;
        try {
          if (ctx.hasUI) {
            ctx.ui.notify(`autopilot: 回合卡死超过 ${c.maxIdleMinutes * 2} 分钟，建议手动重启`, 'warning');
          }
        } catch {
          /* stale ctx */
        }
      }
      return;
    }
    hangNotified = false;

    // 其余挂死信号（含长时间空闲）仅提示，不自动重启：避免惩罚用户正常离开。
    if (isHanging(c.maxIdleMinutes)) {
      if (!hangNotified) {
        hangNotified = true;
        try {
          if (ctx.hasUI) ctx.ui.notify(`autopilot: 会话疑似挂死（>${c.maxIdleMinutes} 分钟无活动），建议检查或重启`, 'warning');
        } catch {
          /* stale ctx */
        }
      }
    } else {
      hangNotified = false;
    }
  };

  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      resetWatchdogState();
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => {
        void runDueTasks(ctx);
        checkHang(ctx);
        void syncSeedTasks();
      }, 60000);
      tickTimer.unref?.();
      void runDueTasks(ctx);
      const sync = await syncSeedTasks();
      if ((sync.added || sync.drifted.length) && ctx.hasUI) {
        ctx.ui.notify(
          `种子任务对账: 新增 ${sync.added}${sync.drifted.length ? `，与种子不一致: ${sync.drifted.join('；')}` : ''}`,
          sync.drifted.length ? 'warning' : 'info',
        );
      }
      // 离线期间任务执行报告（报告后更新已读标记）
      const unread = collectUnread();
      if (unread.length) {
        if (ctx.hasUI) ctx.ui.notify(formatSummary(unread), unread.some((e) => e.result !== 'success') ? 'warning' : 'info');
        writeSeenTs(Date.now());
      }
    },
  });

  // ── 看门狗活动信号 ──
  registerHook(pi, {
    event: 'turn_start',
    handler: async () => {
      setTurnBusy(true);
      touchActivity();
    },
  });
  registerHook(pi, {
    event: 'turn_end',
    handler: async () => {
      setTurnBusy(false);
      touchActivity();
    },
  });
  registerHook(pi, {
    event: 'agent_settled',
    handler: async () => {
      setTurnBusy(false);
      touchActivity();
    },
  });
  registerHook(pi, {
    event: 'input',
    handler: async () => {
      touchActivity();
    },
  });

  registerHook(pi, {
    event: 'session_shutdown',
    handler: async () => {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
    },
  });

  // ── 会话启动摘要 ──
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      const ov = schedulerOverview();
      if (ov.total > 0 && ctx.hasUI) {
        const due = listTasks().filter((t) => t.enabled && t.nextRun && new Date(t.nextRun).getTime() <= Date.now());
        ctx.ui.notify(`自动驾驶: ${ov.total} 任务（启用 ${ov.enabled}）${due.length ? `，${due.length} 个已到期` : ''}`, 'info');
      }
    },
  });
}

export { updateTaskAfterRun, renderPrompt, formatInterval, parseIntervalToMs, computeNextRun, readState, checkBudget };
export type { FallbackModel };
