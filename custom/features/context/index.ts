/**
 * Context Feature
 *
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 *
 * 迁移自 pi-tools pi-context：使用真实 contextWindow/用量校准上下文预算。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerCommand, sendMessage } from '../../adapters/ui-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { applyToolLayering, dormantToolsActive, enableGroup, buildToolsReport, buildSleepingSummary } from './budget/tool-layering';
import { SLEEPING_GROUPS } from './budget/tool-groups';
import {
  createToolLifecycleState,
  EFFICIENCY_ADVICE,
  LOW_PRESSURE_DELEGATION,
  FULL_DELEGATION_ADVICE,
  hasInProgressTask,
} from './logic';
import { getTodos } from '../plan-mode/logic';
import {
  resetAllBudgets,
  setContextWindow,
  setUsedTokens,
  recordToolUsage,
  estimateTokens,
  getBudgetReport,
  pruneToolOutput,
} from './budget/budget';
import { pruneToolResults } from './budget/prune';
import type { PruneMessage } from './budget/prune';
import { makeCompactDecider, makeAutoContinueGate } from './budget/auto-compact';
import { snapshotBeforeCompact } from './budget/compression';
import { appendUsage } from './usage-stats';

export { EFFICIENCY_ADVICE, LOW_PRESSURE_DELEGATION, FULL_DELEGATION_ADVICE };

export function register(pi: ExtensionAPI): void {
  const toolState = createToolLifecycleState();
  const compactDecider = makeCompactDecider();
  const autoContinueGate = makeAutoContinueGate();
  let layeringApplied = false;
  let lastContextMessages: unknown[] | null = null;

  // 注册命令：/context - 上下文预算查看
  registerCommand(pi, 'context', {
    description: '查看上下文预算与 token 用量',
    getArgumentCompletions: (prefix) => {
      const subcommands = [
        { value: 'usage', label: 'usage', description: '显示 token 使用诊断' },
        { value: 'report', label: 'report', description: '显示预算报告' },
        { value: 'help', label: 'help', description: '显示用法' },
      ];
      const filtered = subcommands.filter((s) => s.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim() || 'usage';
      const helpText = '/context <子命令>\n  usage   显示 token 使用诊断\n  report  显示预算报告';
      if (subcommand === 'help') {
        ctx.ui.notify(helpText, 'info');
        return;
      }
      if (subcommand === 'usage' || subcommand === 'report') {
        const r = getBudgetReport();
        ctx.ui.notify(
          `Token 使用报告:
已使用: ${r.used.toLocaleString()} / ${r.total.toLocaleString()} (${(r.ratio * 100).toFixed(1)}%)
剩余: ${r.remaining.toLocaleString()} token
压力级别: ${r.pressure}
主要消耗: ${r.topConsumers.map((c) => `${c.tool} (${c.tokens.toLocaleString()} token)`).join(', ') || '无'}`,
          'info',
        );
        return;
      }
      ctx.ui.notify(`未知子命令: ${subcommand}\n${helpText}`, 'info');
    },
  });

  // 注册工具：enable_tool —— 启用休眠工具组（本会话内保持）
  registerTool(pi, {
    name: 'enable_tool',
    description: `启用休眠工具组（${SLEEPING_GROUPS.map((g) => g.name).join('/')}）。启用后工具列表更新一次（前缀缓存重算），本会话内保持，重启恢复默认；已启用组再次启用无副作用。`,
    parameters: {
      group: {
        type: 'string',
        enum: SLEEPING_GROUPS.map((g) => g.name),
        description: '要启用的休眠工具组名',
      },
    },
    execute: async (args) => {
      const group = typeof args.group === 'string' ? args.group : '';
      const r = enableGroup(pi, group);
      if (!r.ok) return r.message;
      return r.message;
    },
  });

  // 注册命令：/tools - 工具分层管理（list / enable <组> / help）
  registerCommand(pi, 'tools', {
    description: '工具分层：list 查看分组/状态，enable <组> 启用休眠组',
    getArgumentCompletions: (prefix) => {
      const trimmed = prefix.trim();
      const first = trimmed.split(/\s+/)[0] ?? '';
      if (!trimmed.includes(' ')) {
        const items = [
          { value: 'list', label: 'list - 查看分组/状态' },
          { value: 'enable ', label: 'enable - 启用休眠组' },
          { value: 'help', label: 'help - 显示用法' },
        ];
        return items.filter((i) => i.value.startsWith(first)) || null;
      }
      if (first === 'enable') {
        const arg = trimmed.split(/\s+/)[1] ?? '';
        return SLEEPING_GROUPS.filter((g) => g.name.startsWith(arg)).map((g) => ({
          value: 'enable ' + g.name,
          label: g.name,
          description: g.tools.join(', '),
        }));
      }
      return null;
    },
    handler: async (args, ctx) => {
      const [cmd, ...rest] = args.trim().split(/\s+/);
      if (cmd === 'enable' && rest[0]) {
        const r = enableGroup(pi, rest[0]);
        ctx.ui.notify(r.message, r.ok ? 'info' : 'warning');
        return;
      }
      if (cmd === 'help') {
        ctx.ui.notify(
          `工具分层命令:\n\n用法: /tools <子命令>\n\n子命令:\n  list          查看分组/状态\n  enable <组>   启用休眠组（${SLEEPING_GROUPS.map((g) => g.name).join('/')}）\n  help          显示此帮助`,
          'info',
        );
        return;
      }
      const report = buildToolsReport(pi);
      ctx.ui.notify(`tools: ${SLEEPING_GROUPS.length} 个休眠组`, 'info');
      sendMessage(pi, { customType: 'tools-report', content: report, display: true }, { triggerTurn: false });
    },
  });

  // 会话开始：重置预算
  registerHook(pi, {
    event: 'session_start',
    handler: async () => {
      resetAllBudgets();
    },
  });

  // 回合开始：应用工具分层 + 注入休眠组简介 + 用真实 contextWindow/用量校准预算
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async (event, ctx) => {
      if (!layeringApplied) {
        applyToolLayering(pi);
        layeringApplied = true;
      } else if (dormantToolsActive(pi)) {
        // 计划模式退出等会恢复全量工具，这里自愈回分层
        applyToolLayering(pi);
      }
      const usage = ctx.getContextUsage?.();
      if (usage) {
        setContextWindow(usage.contextWindow);
        if (usage.tokens != null) setUsedTokens(usage.tokens);
      }
      const e = event as { systemPrompt?: string };
      if (typeof e.systemPrompt !== 'string') return;
      return { systemPrompt: `${e.systemPrompt}\n\n${buildSleepingSummary()}` };
    },
  });

  // 工具调用开始：记录时间（Pi 的 tool_call 事件，见 hook-adapter 事件名说明）
  registerHook(pi, {
    event: 'tool_call',
    handler: async (event) => {
      const toolEvent = event as { toolName?: string };
      if (toolEvent.toolName) {
        toolState.toolCallStarts.set(toolEvent.toolName, Date.now());
      }
    },
  });

  // 上下文构建阶段：确定性去重（仅保留最新 compactionSummary）+ 工具输出分层擦除
  registerHook(pi, {
    event: 'context',
    handler: async (event) => {
      const e = event as { messages?: unknown[] };
      const messages = Array.isArray(e.messages) ? e.messages : [];
      if (!messages.length) return;
      lastContextMessages = messages;

      let latestSummary = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if ((messages[i] as { role?: string })?.role === 'compactionSummary') {
          latestSummary = i;
          break;
        }
      }

      let working = messages;
      let modified = false;
      if (
        latestSummary >= 0 &&
        messages.slice(0, latestSummary).some((m) => (m as { role?: string })?.role === 'compactionSummary')
      ) {
        working = messages.filter(
          (m, i) => !((m as { role?: string })?.role === 'compactionSummary' && i !== latestSummary),
        );
        modified = true;
      }

      const pruned = pruneToolResults(working as PruneMessage[]);
      if (pruned.modified) {
        working = pruned.messages as unknown[];
        modified = true;
      }

      if (modified) return { messages: working };
    },
  });

  // 工具结果写入阶段：按输出预算截断（R4）
  registerHook(pi, {
    event: 'tool_result',
    handler: async (event) => {
      const e = event as {
        toolName?: string;
        content?: unknown;
        details?: unknown;
        isError?: boolean;
        usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
      };
      let text = '';
      if (typeof e.content === 'string') {
        text = e.content;
      } else if (Array.isArray(e.content)) {
        text = (e.content as { type?: string; text?: string }[])
          .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string)
          .join('\n');
      }
      // 工具生命周期：结束计时、累计本轮工具调用与已进入上下文的输出估算
      const name = e.toolName ?? 'tool';
      const start = toolState.toolCallStarts.get(name);
      toolState.toolCallStarts.delete(name);
      toolState.runToolCount++;
      toolState.lastToolRecomputeTs = Date.now();
      if (text) recordToolUsage(name, estimateTokens(text));
      // 度量：记录 token/缓存（用量统计度量基建；无 usage 时以输出估算兜底）
      try {
        appendUsage({
          ts: new Date().toISOString(),
          tool: name,
          ok: !e.isError,
          input: e.usage?.input,
          output: e.usage?.output,
          cacheRead: e.usage?.cacheRead,
          cacheWrite: e.usage?.cacheWrite,
          outputTokens: e.usage?.output != null ? undefined : text ? estimateTokens(text) : 0,
          durationMs: start ? Date.now() - start : undefined,
        });
      } catch {
        /* fail-open */
      }
      if (!text) return;
      const pruned = pruneToolOutput(text, e.toolName ?? 'tool');
      if (pruned === text) return;
      return { content: [{ type: 'text', text: pruned }], details: e.details };
    },
  });

  // 回合结束：按窗口比例判定自动压缩（防抖 + 压缩后自动继续门）
  registerHook(pi, {
    event: 'turn_end',
    handler: async (_event, ctx) => {
      const usage = ctx.getContextUsage?.();
      if (!usage) return;
      setContextWindow(usage.contextWindow);
      if (usage.tokens != null) setUsedTokens(usage.tokens);
      // 门1：有进行中的计划任务时不自动压缩（避免打断多步任务；pi 硬溢出仍会压缩）
      if (hasInProgressTask(getTodos())) return;
      const decision = compactDecider.decide(usage.tokens ?? 0, usage.contextWindow);
      if (!decision.shouldCompact) return;
      // 压缩前快照（保留最近 8 份/7 天，失败不阻塞压缩）
      snapshotBeforeCompact(lastContextMessages, usage.tokens ?? 0, decision.threshold, 'threshold');
      autoContinueGate.arm();
      compactDecider.markCompact();
      ctx.compact?.();
    },
  });

  // 压缩完成：若为本扩展触发则注入继续指令
  registerHook(pi, {
    event: 'session_compact',
    handler: async () => {
      if (!autoContinueGate.shouldContinue()) return;
      sendMessage(
        pi,
        {
          customType: 'continue-after-compact',
          content:
            '上下文已自动压缩。如果你还有下一步行动，请继续执行；如果已完成或不确定，请停下来向用户说明。',
          display: true,
        },
        { triggerTurn: true },
      );
    },
  });
}

export { getBudgetReport };
