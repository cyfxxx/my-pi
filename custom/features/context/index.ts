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
import { registerCommand, getActiveTools, sendMessage } from '../../adapters/ui-adapter';
import {
  createToolLifecycleState,
  EFFICIENCY_ADVICE,
  LOW_PRESSURE_DELEGATION,
  FULL_DELEGATION_ADVICE,
} from './logic';
import {
  resetAllBudgets,
  setContextWindow,
  setUsedTokens,
  recordToolUsage,
  estimateTokens,
  getBudgetReport,
  pruneToolOutput,
} from './budget';
import { pruneToolResults } from './prune';
import type { PruneMessage } from './prune';
import { makeCompactDecider, makeAutoContinueGate } from './auto-compact';
import { appendUsage, readUsage, summarizeUsage, formatUsageSummary } from './usage-stats';

export { EFFICIENCY_ADVICE, LOW_PRESSURE_DELEGATION, FULL_DELEGATION_ADVICE };

export function register(pi: ExtensionAPI): void {
  const toolState = createToolLifecycleState();
  const compactDecider = makeCompactDecider();
  const autoContinueGate = makeAutoContinueGate();

  // 注册命令：/context - 上下文管理
  registerCommand(pi, 'context', {
    description: '上下文管理 (usage: /context <usage|reset|report|help>)',
    getArgumentCompletions: (prefix) => {
      const subcommands = [
        { value: 'usage', label: 'usage - 显示 token 使用诊断信息' },
        { value: 'reset', label: 'reset - 重置上下文预算' },
        { value: 'report', label: 'report - 显示详细报告' },
        { value: 'help', label: 'help - 显示帮助信息' },
      ];
      const filtered = subcommands.filter((s) => s.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim() || 'usage';
      
      // 帮助信息
      const helpText = `上下文管理命令:

用法: /context <子命令>

子命令:
  usage   显示 token 使用诊断信息
  reset   重置上下文预算
  report  显示详细报告
  help    显示此帮助信息

说明:
  此命令用于管理和查看 AI 助手的上下文使用情况。
  可以查看 token 使用量、剩余预算、压力级别等信息。
  
示例:
  /context usage   查看 token 使用情况
  /context reset   重置上下文预算`;
      
      switch (subcommand) {
        case 'help':
          ctx.ui.notify(helpText, 'info');
          break;
          
        case 'usage':
        case 'usage-diag':
          const report = getBudgetReport();
          const reportText = `Token 使用报告:
已使用: ${report.used.toLocaleString()} / ${report.total.toLocaleString()} (${(report.ratio * 100).toFixed(1)}%)
剩余: ${report.remaining.toLocaleString()} token
压力级别: ${report.pressure}
主要消耗: ${report.topConsumers.map(c => `${c.tool} (${c.tokens.toLocaleString()} token)`).join(', ') || '无'}`;
          ctx.ui.notify(reportText, 'info');
          break;
          
        case 'reset':
          resetAllBudgets();
          ctx.ui.notify('上下文预算已重置', 'info');
          break;
          
        case 'report': {
          const r = getBudgetReport();
          const fullReport = `上下文预算报告:
${r.used.toLocaleString()} / ${r.total.toLocaleString()} token
压力级别: ${r.pressure}`;
          ctx.ui.notify(fullReport, 'info');
          break;
        }
          
        default:
          ctx.ui.notify(`未知子命令: ${subcommand}\n\n${helpText}`, 'info');
      }
    },
  });

  // 注册命令：/usage-diag - 用量诊断（pi-tools 同名命令）
  registerCommand(pi, 'usage-diag', {
    description: '用量诊断 (usage: /usage-diag)',
    handler: async (_args, ctx) => {
      const report = getBudgetReport();
      const persisted = formatUsageSummary(summarizeUsage(readUsage()));
      ctx.ui.notify(
        `Token 用量诊断:
已使用: ${report.used.toLocaleString()} / ${report.total.toLocaleString()} (${(report.ratio * 100).toFixed(1)}%)
剩余: ${report.remaining.toLocaleString()} token
压力级别: ${report.pressure}
主要消耗: ${report.topConsumers.map(c => `${c.tool} (${c.tokens.toLocaleString()} token)`).join(', ') || '无'}

${persisted}`,
        'info',
      );
    },
  });

  // 注册命令：/tools - 查看活跃工具（pi-tools 同名命令）
  registerCommand(pi, 'tools', {
    description: '查看活跃工具 (usage: /tools [list])',
    getArgumentCompletions: (prefix) => {
      const subcommands = [{ value: 'list', label: 'list - 列出当前活跃工具' }];
      const filtered = subcommands.filter((s) => s.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (_args, ctx) => {
      const tools = getActiveTools(pi);
      ctx.ui.notify(
        tools.length ? `活跃工具 (${tools.length}):\n${tools.map(t => `- ${t}`).join('\n')}` : '无活跃工具',
        'info',
      );
    },
  });

  // 会话开始：重置预算
  registerHook(pi, {
    event: 'session_start',
    handler: async () => {
      resetAllBudgets();
    },
  });

  // 回合开始：用真实 contextWindow 与用量校准预算
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async (_event, ctx) => {
      const usage = ctx.getContextUsage?.();
      if (!usage) return;
      setContextWindow(usage.contextWindow);
      if (usage.tokens != null) setUsedTokens(usage.tokens);
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
      const decision = compactDecider.decide(usage.tokens ?? 0, usage.contextWindow);
      if (!decision.shouldCompact) return;
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
