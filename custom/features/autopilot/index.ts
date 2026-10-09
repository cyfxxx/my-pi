/**
 * Autopilot Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/{index,commands,tools}.ts`（核心）。
 * 提供任务调度存储/策略/遥测/失败自愈判定，`/auto` 与 `/schedule` 命令。
 * 后台执行循环/watchdog/verifier/seeds/notifications/sessions 已实现；未迁移：Best-of-N 的 LLM 集成。
 * 会话切换/重启：admin_* 工具写 portable/agent/autopilot/state.json，由 scripts/pi-supervisor.sh 消费后以 --session 重拉。
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { registerCommand } from '../../adapters/ui-adapter';
import { sendMessage, sendMessageAfterRebind } from '../../adapters/ui-adapter';
import { getEffectiveModeConfig, resolveEffectiveMode } from '../mode/logic';
import { describeCheck, runCheckCommand } from './store/run-check';
import { runGoalJudge } from './run/goal-verdict';
import {
  advisoryCompletion,
  createGoal,
  declaredCompletion,
  judgeVerifiedCompletion,
  verifiedCompletion,
  continuePrompt,
  decideContinuation,
  goalStatusText,
  resolveGoalCap,
} from './store/goal';
import type { GoalState } from './store/goal';

import {
  formatRestartLine,
  logTargetsOtherSession,
  logWrittenAfterStart,
  normalizeResumeIntent,
  planRestartNotice,
  processStartedAtMs,
  tailKindFromSessionFile,
} from '../../core/restart-intent';
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
  consumeRestartLog,
  isModeOwnedNotice,
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
  selectDailyTasks,
  formatDailyOverview,
  formatDailyLine,
  formatDailyDetail,
  taskNameCompletions,
  editFieldCompletions,
  splitArgument,
} from './logic';
import type { TaskType, FallbackModel, Task } from './logic';
import { runTaskOnce } from './run/runner';
import { sendWebhook } from './store/webhook';
import { acquireSessionLock, releaseSessionLock } from './store/storage';
import { registerAdminTools } from './tools/admin-tools';
import { registerScheduleTool } from './tools/schedule-tool';

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

  // ── 工具：状态（只读诊断，合并为一个带 section 的工具）──────────────────────────
  //
  // 2026-10-07 合并：原 `autopilot_status` / `autopilot_stats` / `autopilot_failover` 三个工具
  // 的回答都是"现在什么状态"，30 天实测各只有 1–2 次调用，却让模型在三个近义名字之间猜。
  // 合并后一个入口 + `section` 参数，工具数 −2、声明体积 −约 0.8KB，且"该问哪个"不再需要判断。
  // 未被合并的兄弟工具（保持各自清晰动词，但描述里点明边界）：
  //   · `autopilot_policy`  → 自主运行**策略配置**的只读视图（不是运行态）
  //   · `admin_status`      → 当前 **Agent 运行时**（模型/会话文件/运行模式/待重启操作）
  //   · `schedule_task`     → 定时任务的增删改查
  const STATUS_SECTIONS = ['summary', 'stats', 'failover'] as const;
  registerTool(pi, {
    name: 'autopilot_status',
    description:
      '查看自主运行状态。section: summary(默认：自主运行开关、调度器任务数、预算)、stats(按模型/任务的运行统计)、failover(模型故障转移预览；execute=true 才真的写入切换请求)。策略配置看 autopilot_policy，Agent 运行时看 admin_status，定时任务用 schedule_task。',
    parameters: {
      section: {
        type: 'string',
        enum: [...STATUS_SECTIONS],
        description: '要看哪一块（默认 summary）',
        optional: true,
      },
      execute: {
        type: 'boolean',
        description: '仅 section=failover 有意义：true 实际写入切换请求（默认 false 仅预览）',
        optional: true,
      },
    },
    execute: async (args, ctx) => {
      const section = (args.section as string) ?? 'summary';
      if (section === 'stats') {
        const runs = readTelemetry();
        const models = statsByModel(runs).slice(0, 5);
        const tasks = statsByTask(runs).slice(0, 5);
        const fmtR = (n: number): string => `${(n * 100).toFixed(0)}%`;
        return [
          '按模型:',
          ...(models.length
            ? models.map((m) => `  ${m.provider}/${m.model}: ${m.runs} 次, 成功率 ${fmtR(m.successRate)}, $${m.totalCost.toFixed(4)}`)
            : ['  (无)']),
          '按任务:',
          ...(tasks.length ? tasks.map((t) => `  ${t.taskName}: ${t.runs} 次, 成功率 ${fmtR(t.successRate)}`) : ['  (无)']),
        ].join('\n');
      }
      if (section === 'failover') {
        const c = readAutopilotConfig();
        const cm = currentModel();
        const plan = planFailover(c.fallbackModels, cm.provider, cm.model);
        if (!plan.target) return `无法转移: ${plan.reason}`;
        return executeFailover(plan.target, plan.reason, !(args.execute === true), ctx?.sessionFile);
      }
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

  // ── 工具：会话列表/切换、重启（admin 组）──
  registerTool(pi, {
    name: 'admin_list_sessions',
    description: '列出历史会话文件（可按工作目录过滤，按修改时间倒序）。',
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
    // 共享状态（重启/配置/待办）必须与其它工具调用一个一个来：并发会得到错误结果（后写覆盖/语义竞态）。
    executionMode: 'sequential',
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
      // 用户驱动的会话切换：新会话不该自动跑起来（判据见 custom/core/restart-intent.ts）
      try {
        writeRestartRequest('switch_session', {
          targetSession: session.path,
          reason: reason || `切换到会话 ${session.id}`,
          intent: 'none',
        });
      } catch {
        // 写盘失败**不要 shutdown**：否则就是"进程没了、会话也没切"的静默退出
        return `切换请求写盘失败，未重启（仍停留在当前会话）。请检查 PI_ADMIN_STATE_FILE 指向的路径与磁盘状态。`;
      }
      ctx.shutdown?.();
      return `正在切换到会话 ${session.id}...`;
    },
  });

  registerTool(pi, {
    name: 'admin_restart',
    // 共享状态（重启/配置/待办）必须与其它工具调用一个一个来：并发会得到错误结果（后写覆盖/语义竞态）。
    executionMode: 'sequential',
    description:
      '重启 Agent 程序（写重启请求，由 supervisor 重新拉起；当前会话会自动保存）。如不需要重启请拒绝调用。' +
      '重启后默认由会话盘面判断要不要继续执行任务：若你还有下一步要做，传 resume=continue；' +
      '若重启就是你这一步的最后动作、之后等用户指示，传 resume=none。',
    parameters: {
      reason: { type: 'string', description: '重启原因（可选）', optional: true },
      resume: {
        type: 'string',
        description: "重启后是否继续执行任务：'continue'（我还有下一步）/'none'（重启即收尾）/'auto'（默认，由盘面判断）",
        optional: true,
      },
    },
    execute: async (args, ctx) => {
      const reason = typeof args.reason === 'string' ? args.reason : undefined;
      // 显式带上当前会话：supervisor 用 --session 重拉，不依赖「最近会话」推断
      // （多会话并存/子代理会话更新时间更晚时会续错会话）。
      try {
        writeRestartRequest('restart', {
          targetSession: ctx?.sessionFile,
          reason: reason || '手动重启',
          // 让模型在**它能知情的这一刻**声明意图：比"重启后先跑一个回合再让它自己判断"省一次全量请求
          intent: normalizeResumeIntent(args.resume),
        });
      } catch {
        // 写盘失败**不要 shutdown**：那会变成"进程没了、也没有重启"的静默退出（2026-10-06 修 mode 的同款纪律）
        return '重启请求写盘失败，未重启。请检查 PI_ADMIN_STATE_FILE 指向的路径与磁盘状态后重试。';
      }
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
        { value: 'run ', label: 'run', description: '立即执行（/schedule run <名>）' },
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
      const { sub, rest, hasTrailingSpace } = splitArgument(prefix);
      if (!prefix.includes(' ')) {
        const f = filterCompletions(subs, sub);
        return f.length ? f : null;
      }
      // 第二段是任务名（列表来自 tasks.json）；`edit <名> ` 之后补字段
      const tasks = listTasks();
      if (sub === 'edit') {
        const parts = rest.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return editFieldCompletions(sub, parts[0], parts.slice(1).join(' '));
        if (parts.length === 1 && hasTrailingSpace) return editFieldCompletions(sub, parts[0], '');
        return taskNameCompletions(tasks, sub, rest);
      }
      if (['run', 'delete', 'enable', 'disable', 'history'].includes(sub)) {
        return taskNameCompletions(tasks, sub, rest);
      }
      return null;
    },
    handler: async (args, ctx) => {
      const { sub: subRaw, rest } = parseSubcommand(args);
      const sub = subRaw || 'list';
      const help =
        '/schedule list                        列出任务\n' +
        '/schedule run <名>                    立即执行一次（后台；忽略 enabled 与每日预算）\n' +
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
        if (sub === 'run') {
          const name = rest.join(' ');
          if (!name) {
            ctx.ui.notify('用法: /schedule run <名>', 'info');
            return;
          }
          const targets = listTasks().filter((t) => t.name === name || t.id === name);
          if (targets.length === 0) {
            ctx.ui.notify(`未找到任务: ${name}`, 'warning');
            return;
          }
          startManualRun(targets, ctx);
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

  // ── /daily 命令：每日任务视图（tags 含 daily，渲染逻辑在 daily.ts）──
  registerCommand(pi, 'daily', {
    description: '每日任务：查看执行情况与启停',
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: 'list', label: 'list', description: '逐条列出每日任务' },
        { value: 'run ', label: 'run', description: '立即执行（/daily run <名|all>）' },
        { value: 'show ', label: 'show', description: '任务详情与最近执行（/daily show <名>）' },
        { value: 'on ', label: 'on', description: '启用（/daily on <名|all>）' },
        { value: 'off ', label: 'off', description: '禁用（/daily off <名|all>）' },
        { value: 'help', label: 'help', description: '显示用法' },
      ];
      const { sub, rest } = splitArgument(prefix);
      if (!prefix.includes(' ')) {
        const f = filterCompletions(subs, sub);
        return f.length ? f : null;
      }
      // 任务名补全：/daily 的目标集合 = daily 标签（无标签时降级为全部任务）
      const tasks = selectDailyTasks(listTasks()).tasks;
      if (sub === 'run' || sub === 'on' || sub === 'off') {
        return taskNameCompletions(tasks, sub, rest, ['all']);
      }
      if (sub === 'show') return taskNameCompletions(tasks, sub, rest);
      return null;
    },
    handler: async (args, ctx) => {
      const { sub: subRaw, rest } = parseSubcommand(args);
      const sub = subRaw || 'overview';
      const now = new Date();
      const usage =
        '/daily                    每日任务概览（含今日进度）\n' +
        '/daily list               逐条列出（时间/上次结果/下次/成功失败）\n' +
        '/daily run <名|all>       立即执行（后台；忽略 enabled 与每日预算）\n' +
        '/daily show <名>          详情：调度、统计、最近 5 次执行、提示词\n' +
        '/daily on|off <名|all>    启用/禁用（all = 全部每日任务）\n' +
        '/daily help               显示本帮助\n' +
        '说明：每日任务 = tasks.json 中 tags 含 daily 的任务；无标签时显示全部调度任务。';

      if (sub === 'help') {
        ctx.ui.notify(usage, 'info');
        return;
      }

      const sel = selectDailyTasks(listTasks());

      if (sub === 'run') {
        const name = rest.join(' ');
        if (!name) {
          ctx.ui.notify('用法: /daily run <名|all>', 'info');
          return;
        }
        const targets =
          name === 'all' ? sel.tasks : sel.tasks.filter((t) => t.name === name || t.id === name);
        if (targets.length === 0) {
          ctx.ui.notify(`未找到每日任务: ${name}`, 'warning');
          return;
        }
        startManualRun(targets, ctx);
        return;
      }

      if (sub === 'list') {
        ctx.ui.notify(
          sel.tasks.length ? sel.tasks.map((t) => formatDailyLine(t, now)).join('\n') : '暂无每日任务',
          'info',
        );
        return;
      }

      if (sub === 'on' || sub === 'off') {
        const name = rest.join(' ');
        if (!name) {
          ctx.ui.notify(`用法: /daily ${sub} <名|all>`, 'info');
          return;
        }
        const enabled = sub === 'on';
        const targets =
          name === 'all' ? sel.tasks : sel.tasks.filter((t) => t.name === name || t.id === name);
        if (targets.length === 0) {
          ctx.ui.notify(`未找到每日任务: ${name}`, 'warning');
          return;
        }
        // 只改 enabled、不重算 nextRun：已错过的触发点会在下一个调度轮次立即补跑
        // （与 /schedule enable 语义一致；重算会静默吞掉一次本应补上的执行）
        const changed: string[] = [];
        for (const t of targets) {
          if (t.enabled === enabled) continue;
          await updateTask(t.id, { enabled });
          changed.push(t.name);
        }
        ctx.ui.notify(
          changed.length
            ? `已${enabled ? '启用' : '禁用'} ${changed.length} 个：${changed.join('、')}`
            : `无需改动：${targets.length} 个任务已是${enabled ? '启用' : '禁用'}状态`,
          'info',
        );
        return;
      }

      if (sub === 'show') {
        const name = rest.join(' ');
        if (!name) {
          ctx.ui.notify('用法: /daily show <名>', 'info');
          return;
        }
        const t = sel.tasks.find((x) => x.name === name || x.id === name);
        if (!t) {
          ctx.ui.notify(`未找到每日任务: ${name}`, 'warning');
          return;
        }
        ctx.ui.notify(formatDailyDetail(t, now), 'info');
        return;
      }

      if (sub === 'overview' || sub === 'status') {
        const ov = schedulerOverview();
        ctx.ui.notify(
          formatDailyOverview(
            sel.tasks,
            { autopilotEnabled: readAutopilotConfig().enabled, paused: ov.paused, byTag: sel.byTag },
            now,
          ),
          'info',
        );
        return;
      }

      ctx.ui.notify(`未知子命令: ${sub}\n\n${usage}`, 'info');
    },
  });

  // ── 执行循环：每分钟检查到期任务并运行（子进程隔离）──
  let running = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  // 重启通知在同一进程内只消费一次（restartLog 已被 consumeRestartLog 清空，
  // 此标志防多个 session_start 钩子/重入重复注入）
  let restartNoticeShown = false;

  type NotifyLevel = 'info' | 'warning' | 'error';
  type TaskOutcome = 'success' | 'failed' | 'skipped';

  /**
   * 执行单个任务并落账（遥测/历史/失败策略），供定时轮次与手动执行共用，避免两套逻辑漂移。
   *
   * `enforceBudget=false` 供手动执行显式跳过每日预算（用户主动触发）；无论是否跳过，
   * 运行都会写入遥测，因此仍计入当日用量。`announce=false` 时由调用方自己汇报结果。
   */
  const runTaskWithPolicy = async (
    task: Task,
    ctx: ExtensionContext,
    cfg: ReturnType<typeof readAutopilotConfig>,
    notify: (text: string, level: NotifyLevel) => void,
    opts: { enforceBudget?: boolean; announce?: boolean } = {},
  ): Promise<TaskOutcome> => {
    const { provider, model } = currentModel();
    if (opts.enforceBudget !== false) {
      const budget = checkBudget(cfg.budget, `${provider}/${model}`);
      if (!budget.allowed) {
        notify(`autopilot: 跳过 ${task.name}（${budget.reason}）`, 'info');
        return 'skipped';
      }
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
      // updateTaskAfterRun 已把 failCount 落盘：用最新任务状态决策，避免读到自增前的计数（off-by-one）
      const fresh = listTasks().find((t) => t.id === task.id) ?? task;
      const decision = decide(fresh, errClass, cfg.policy, cfg.fallbackModels, {
        stderr: r.stderr || r.output,
        exitCode: r.exitCode,
        promptLen: task.prompt.length,
        outputLen: r.output.length,
        durationMs: r.durationMs,
      });
      notify(`autopilot 任务 ${task.name} 失败：${decision.note}`, 'warning');
      // 执行决策（此前只通知不执行，暂停/熔断/切换全部失效）
      if (decision.type === 'suspend_task') {
        await updateTask(task.id, { enabled: false });
        notify(`autopilot: 任务 ${task.name} 已自动暂停（${decision.note}）`, 'warning');
      } else if (decision.type === 'failover') {
        let sessionFile: string | undefined;
        try {
          sessionFile = ctx.sessionManager.getSessionFile();
        } catch {
          /* stale ctx */
        }
        const text = executeFailover(decision.target, decision.note, false, sessionFile);
        await updateTask(task.id, { failoverCount: (fresh.failoverCount ?? 0) + 1 });
        notify(`autopilot: ${text}`, 'warning');
      }
      return 'failed';
    }
    if (opts.announce !== false) notify(`autopilot 任务 ${task.name} 完成`, 'info');
    return 'success';
  };

  const runDueTasks = async (ctx: ExtensionContext): Promise<void> => {
    if (running) return;
    const c = readAutopilotConfig();
    if (!c.enabled) return;
    const due = listTasks().filter((t) => t.enabled && isDue(t));
    if (due.length === 0) return;
    // 跨进程互斥：另一实例（多开会话 / supervisor 重拉窗口）正在执行时让出本轮
    if (!acquireSessionLock()) return;
    running = true;
    setBackgroundBusy(true);
    const notify = (t: string, l: NotifyLevel): void => {
      try {
        if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(t, l);
      } catch {
        /* stale ctx */
      }
    };
    try {
      // 拿到锁后重新读盘：持锁前的 due 快照可能已过期（另一实例刚完成同一任务并推进了 nextRun）
      const dueNow = listTasks().filter((t) => t.enabled && isDue(t));
      for (const task of dueNow) {
        await runTaskWithPolicy(task, ctx, c, notify);
      }
    } finally {
      running = false;
      releaseSessionLock();
      setBackgroundBusy(false);
    }
  };

  /**
   * 手动执行（`/daily run`、`/schedule run`）：忽略调度时间与 enabled（显式动作），
   * 但仍走同一套落账与失败策略。后台串行执行、不阻塞命令；持调度器锁避免与定时轮次并发。
   */
  const startManualRun = (targets: Task[], ctx: ExtensionCommandContext): void => {
    if (targets.length === 0) return;
    if (!acquireSessionLock()) {
      ctx.ui.notify('已有任务正在执行（调度轮次或上一次手动执行），请稍后再试', 'warning');
      return;
    }
    const cfg = readAutopilotConfig();
    setBackgroundBusy(true);
    const notify = (text: string, level: NotifyLevel): void => {
      try {
        if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(text, level);
      } catch {
        /* stale ctx */
      }
    };
    notify(`手动执行 ${targets.length} 个任务：${targets.map((t) => t.name).join('、')}（后台运行，完成后通知）`, 'info');
    void (async () => {
      const outcomes: string[] = [];
      try {
        for (const task of targets) {
          const outcome = await runTaskWithPolicy(task, ctx, cfg, notify, { enforceBudget: false, announce: false });
          if (outcome !== 'skipped') {
            const fresh = listTasks().find((t) => t.id === task.id) ?? task;
            const out = (fresh.lastOutput || '').replace(/\s+/g, ' ').trim();
            const preview = out ? `\n${out.slice(0, 300)}${out.length > 300 ? '…' : ''}` : '';
            notify(`${task.name} ${outcome === 'success' ? '成功' : '失败'}${preview}`, outcome === 'success' ? 'info' : 'warning');
          }
          outcomes.push(`${task.name}: ${outcome === 'success' ? '成功' : outcome === 'failed' ? '失败' : '跳过'}`);
        }
      } catch (e) {
        notify(`手动执行异常：${(e as Error).message}`, 'error');
      } finally {
        releaseSessionLock();
        setBackgroundBusy(false);
        notify(`手动执行结束 —— ${outcomes.join('；')}`, 'info');
      }
    })();
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
      // 调度器**只在交互会话**里跑。`-p` 一次性运行（含 golden 的无头冒烟、临时提问）会在启动时
      // 立刻跑 `runDueTasks`，而逾期的每日任务每个都是一次完整子代理会话（数分钟）——
      // 于是"问一句就退出"会变成长期挂起，且**凭空触发若干不该发生的后台任务**（实测：一次
      // 验收运行就触发了 tool-stats-daily，留下被 git add 的计数文件）。
      // 无头会话只做种子对账（幂等、零 LLM），不启动调度器、也不消费通知（否则会把该给交互
      // 会话看的未读报告标记成已读而丢失）。调度器自己的工作进程走 `--no-extensions -p`，
      // 不加载扩展、不会回到这个钩子，故无副作用。
      if (!ctx.hasUI) {
        await syncSeedTasks();
        return;
      }
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
      // ── 重启恢复通知（对齐 pi-tools pi-autopilot 的 consumeRestartLog）──
      // supervisor 以 --session 续接会话后**只恢复历史**，模型无从得知"进程刚重启、
      // 为什么重启、该继续做什么"。原项目在 session_start 消费 restartLog 并注入一条
      // 用户消息；迁移时漏了消费端（restartLog 写入但无人读），表现为"重启后没有任何提示"。
      // 网关：仅交互会话消费，否则 headless/-p 子进程会先把它吃掉。
      // 例外：`notice: 'mode'` 的重启由 mode 功能自己注入（它要说明新模式的人设/功能/命名空间，
      // 通用措辞既说不清、又会在**旧模式**的进程里落一条）：这里既不注入也不消费，原样留给它。
      //
      // 2026-10-06：注入**分两条通道**——"要不要继续执行任务"由 core/restart-intent.ts 判：
      //   resume=true  → triggerTurn 的真回合（接上被中断的工作，成本换连续性）
      //   resume=false → deliverAs:'nextTurn' 的上下文备注（不触发回合、不写会话文件、零成本；
      //                  等下一次真正要跑时与用户消息一起出现）
      // 旧行为是无条件 sendUserMessage（无条件触发一个回合），切模式/换模型这类没有在途任务的
      // 重启也白烧一次"重启后首轮全量重放"（仓库既有实测 ≈80k），还可能让模型凭空编任务。
      const pendingLog = ctx.hasUI && !restartNoticeShown ? readState().restartLog : null;
      // 归属判据（与 features/mode 的兜底消费同一套，见 core/restart-intent.ts）：
      //   ① 写在**本进程启动之后**的日志属于下一个进程——本进程正是即将被重启的那一个，
      //      吃掉它会让重拉起来的新进程无续跑可注入（2026-10-07 真 pty 场景实测的静默丢续跑）；
      //   ② `targetSession` 指向别的会话/实例的日志不该注入到本会话里（多实例串扰）。
      const belongsToMe =
        !logWrittenAfterStart(pendingLog, processStartedAtMs()) &&
        !logTargetsOtherSession(pendingLog, ctx.sessionManager?.getSessionFile?.());
      if (ctx.hasUI && !restartNoticeShown && !isModeOwnedNotice(pendingLog) && belongsToMe) {
        const log = consumeRestartLog();
        if (log && log.action && log.action !== 'none') {
          restartNoticeShown = true;
          ctx.ui.notify(formatRestartLine(log), 'info');
          // 通道选择与文案由 core 统一算（features/mode 在没有 autopilot 的模式里做同样的兜底）
          const plan = planRestartNotice({
            log,
            tail: tailKindFromSessionFile(ctx.sessionManager?.getSessionFile?.()),
            env: process.env.PI_RESTART_RESUME,
          });
          if (plan.channel === 'turn') {
            // 延后触发：避开 pi 会话替换的 rebind 竞态（见 adapters/ui-adapter.ts 的注释）
            sendMessageAfterRebind(
              pi,
              { customType: plan.customType, content: plan.content, display: true },
              { isIdle: () => ctx.isIdle() },
            );
          } else {
            sendMessage(pi, { customType: plan.customType, content: plan.content, display: false }, { deliverAs: 'nextTurn' });
          }
        }
      }
    },
  });

  // ── 目标级自动续跑（编排优化第 4 项）──────────────────────────────────────────
  //
  // 为什么放在 autopilot：它本来就在做"自主运行"（调度器/遥测/failover），且已经注册了
  // `agent_settled` —— 那一刻是**唯一可安全 triggerTurn 的时刻**（忙碌态会致命报错）。
  // **会话态、不落盘**：DSH 的 goal 在 resume/fork 后也是 disarmed 的，本来就是会话内概念；
  // 不落盘同时避免引入"运行时状态入库"的风险。停止条件见 store/goal.ts 的文档。
  let goal: GoalState | null = null;
  /** 本轮（自 turn_start 起）的工具调用数，**不含 goal 自身**（否则反复查状态会被当成有推进） */
  let toolCallsThisRound = 0;
  const GOAL_CUSTOM_TYPE = 'my-pi-goal';

  registerTool(pi, {
    name: 'goal',
    description:
      '声明/查看/结束一个目标；声明后每轮结束会**自动续跑**，直到完成、受阻或达到轮次上限。action: set(objective 必填)/status/complete/blocked/pause/resume。**完成分三态**：带 `check`（只读检查命令）且由 my-pi 跑通 = verified；`verify:true` 时由独立评审判定（第二来源，优先级低于 check）；两者都没有只能是 declared（声称完成）；blocked/pause 是 advisory。上限按当前模式配置（full 256、其余默认 16、可被模式覆盖）；连续 3 轮无工具调用会自动判定受阻并停止。',
    parameters: {
      action: {
        type: 'string',
        enum: ['set', 'status', 'complete', 'blocked', 'pause', 'resume'],
        description: '操作类型',
      },
      objective: { type: 'string', description: '目标描述（set 必填）', optional: true },
      note: { type: 'string', description: '结论或受阻原因', optional: true },
      evidence: { type: 'string', description: 'complete 的结论/证据说明', optional: true },
      verify: { type: 'boolean', description: '可选：由独立评审子代理判定是否真的完成（第二来源）', optional: true },
      check: {
        type: 'string',
        description:
          '可选：一条**只读**检查命令。由 my-pi 实际执行，exit 0 才记为已校验；非 0 则**不标记完成**并把输出尾部回给你。',
        optional: true,
      },
    },
    // 目标状态是共享可变的：与其它工具并发会得到错误结果
    executionMode: 'sequential',
    execute: async (args, ctx) => {
      const action = String(args.action ?? 'status');
      if (action === 'set') {
        const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
        if (!objective) return 'action=set 需要 objective。';
        const cap = resolveGoalCap(resolveEffectiveMode(), getEffectiveModeConfig().goalMaxRounds);
        if (cap <= 0) return '当前模式已禁用自动续跑（goalMaxRounds<=0），未声明目标。';
        goal = createGoal(objective, cap);
        return `已声明目标（上限 ${cap} 轮）：${objective}
每轮结束会自动续跑；完成时用 goal complete，推不动时用 goal blocked。`;
      }
      if (!goal) return goalStatusText(null);
      if (action === 'complete') {
        const evidence = typeof args.evidence === 'string' ? args.evidence.trim() : '';
        const check = typeof args.check === 'string' ? args.check.trim() : '';
        if (check) {
          // 独立校验：模型给判据，**harness 实际跑**（这才是 declared 与 verified 的区别）
          const r = await runCheckCommand(check);
          if (r.ok) {
            goal = verifiedCompletion(goal, {
              command: check,
              outputTail: r.outputTail,
              at: new Date().toISOString(),
            });
          } else {
            // 不标记完成：模型自己要求了判据，就该按判据说话（这是新 opt-in 路径内的语义，不改旧默认）
            goal = { ...goal, note: `${describeCheck(check, r)}${evidence ? `｜结论：${evidence}` : ''}` };
            return `目标**未**标记完成——${describeCheck(check, r)}\n\n输出尾部：\n${r.outputTail.slice(-1200)}\n\n修好后重试 complete，或调用 goal blocked 说明卡点。`;
          }
        } else if (args.verify === true) {
          // **第二校验来源**：独立上下文的评审子代理（见 run/goal-verdict.ts）。
          // 判定由 harness 跑、且评审看不到本会话的自我叙述 ⇒ 比"问模型自己"硬。
          const judged = await runGoalJudge(ctx?.executeTool, { objective: goal.objective, note: evidence });
          if (judged.done === true) {
            goal = judgeVerifiedCompletion(goal, { reason: judged.reason, at: new Date().toISOString() });
          } else {
            // 评审未通过 / 认不出 / 没跑成：**都退回 declared**，并把原因写清（fail-open，不阻塞完成）
            goal = declaredCompletion(goal, evidence);
            goal = {
              ...goal,
              note: `${goal.note}｜独立评审未通过：${judged.skipped ?? (judged.reason || '评审判为未达成')}`,
            };
          }
        } else {
          // 没有判据 ⇒ 只能是"声称完成"。模型**无法自己升级到 verified**（结构上由构造器保证）
          goal = declaredCompletion(goal, evidence);
        }
      } else if (action === 'blocked' || action === 'pause') {
        goal = advisoryCompletion(goal, action === 'blocked' ? 'blocked' : 'paused', typeof args.note === 'string' ? args.note : '');
      } else if (action === 'resume') {
        goal = { ...goal, status: 'active', note: '' };
      }
      return goalStatusText(goal);
    },
  });

  // ── 看门狗活动信号 ──
  registerHook(pi, {
    event: 'turn_start',
    handler: async () => {
      setTurnBusy(true);
      touchActivity();
      toolCallsThisRound = 0;
    },
  });
  // 计数本轮工具调用（排除 goal 自身）：判"有没有推进"的唯一依据
  registerHook(pi, {
    event: 'tool_call',
    handler: async (event) => {
      const name = (event as { toolName?: string }).toolName;
      if (name && name !== 'goal') toolCallsThisRound++;
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
      if (!goal || goal.status !== 'active') return;
      const d = decideContinuation(goal, toolCallsThisRound);
      goal = d.next;
      try {
        if (d.action === 'continue') {
          // agent_settled = 已空闲 → 这是**唯一**可安全 triggerTurn 的时刻
          sendMessage(pi, { customType: GOAL_CUSTOM_TYPE, content: continuePrompt(goal), display: true }, { triggerTurn: true });
        } else {
          sendMessage(pi, {
            customType: GOAL_CUSTOM_TYPE,
            content: `[目标结束：${d.reason}]\n${goalStatusText(goal)}`,
            display: true,
          });
        }
      } catch {
        /* 会话可能已关闭：目标状态仍在，下次轮次会再判 */
      }
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
