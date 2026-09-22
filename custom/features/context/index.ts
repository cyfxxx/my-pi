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
import { registerCommand, sendMessage, getAllToolNames, getThinkingLevel, setThinkingLevel } from '../../adapters/ui-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { applyToolLayering, dormantToolsActive, enableGroup, buildToolsReport, buildSleepingSummary } from './budget/tool-layering';
import { SLEEPING_GROUPS, groupsWithTools } from './budget/tool-groups';
import {
  createToolLifecycleState,
  EFFICIENCY_ADVICE,
  LOW_PRESSURE_DELEGATION,
  FULL_DELEGATION_ADVICE,
  hasInProgressTask,
  extractUserRequest,
} from './logic';
import { recordTaskRecord } from './budget/task-record';
import { buildPruneDumpRef, pruneRefsDir, PRUNE_REFS_RETENTION_DAYS } from './budget/prune-dump';
import {
  updateFailStreak,
  dehydrateErrorOutput,
  rebuildTextContent,
  DEHYDRATE_HINT,
  type TextBlockLike,
} from './budget/tool-health';
import {
  createState,
  tickThinkingLevel,
  proposeThinkingLevel,
  inferTaskType,
  type ThinkLevelState,
} from './budget/thinking-level';
import { getTodos } from '../plan-mode/logic';
import {
  resetAllBudgets,
  setContextWindow,
  setUsedTokens,
  recordToolUsage,
  estimateTokens,
  getBudgetReport,
  pruneToolOutput,
  getCacheStats,
} from './budget/budget';
import { pruneToolResults, sweepPruneRefs } from './budget/prune';
import type { PruneMessage } from './budget/prune';
import { makeCompactDecider, makeAutoContinueGate } from './budget/auto-compact';
import { snapshotBeforeCompact } from './budget/compression';
import { appendUsage } from './usage-stats';

export { EFFICIENCY_ADVICE, LOW_PRESSURE_DELEGATION, FULL_DELEGATION_ADVICE };

export function register(pi: ExtensionAPI): void {
  const toolState = createToolLifecycleState();
  // 连续失败熔断计数（进程内存态，成功即清零）
  const failStreak = new Map<string, number>();
  const compactDecider = makeCompactDecider();
  const autoContinueGate = makeAutoContinueGate();
  let layeringApplied = false;
  let lastContextMessages: unknown[] | null = null;
  let compactedThisSettlement = false;
  let thinkState: ThinkLevelState | null = null;
  const thinkingAutoEnabled = process.env.PI_CONTEXT_THINKING_AUTO !== 'off';

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

  // 注册工具：thinking_level —— 模型建议切档，规则审批（死区/压力方向）
  registerTool(pi, {
    name: 'thinking_level',
    description:
      '建议切换 thinking 档位（low/medium/high）。程序做防抖死区与压力方向审批：死区内或上下文压力 critical 时升档会被拒绝；通过后记账。默认由程序自动切档，本工具供模型在需要更强/更省推理时主动申请。',
    parameters: {
      level: { type: 'string', enum: ['low', 'medium', 'high'], description: '目标档位' },
      reason: { type: 'string', description: '切换理由（将记入审计日志）' },
    },
    execute: async (args) => {
      if (!thinkState) thinkState = createState(getThinkingLevel(pi));
      const r = proposeThinkingLevel(
        thinkState,
        String(args.level ?? ''),
        String(args.reason ?? ''),
        (l) => setThinkingLevel(pi, l),
      );
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
        return groupsWithTools(new Set(getAllToolNames(pi)))
          .filter((g) => g.name.startsWith(arg))
          .map((g) => ({
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

  // 会话开始：重置预算 + 清理过期擦除溯源
  registerHook(pi, {
    event: 'session_start',
    handler: async () => {
      resetAllBudgets();
      void sweepPruneRefs(pruneRefsDir(), { retentionDays: PRUNE_REFS_RETENTION_DAYS }).catch(() => {});
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
      return { systemPrompt: `${e.systemPrompt}\n\n${buildSleepingSummary(new Set(getAllToolNames(pi)))}` };
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
    handler: async (event, ctx) => {
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

      const dumpRef = buildPruneDumpRef(ctx as { sessionManager?: { getSessionId?: () => string | null } });
      const pruned = pruneToolResults(working as PruneMessage[], { dumpRef });
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
      // 熔断：同一工具连续失败达阈值时追加提示；错误输出先确定性脱水
      const { hint } = updateFailStreak(failStreak, name, !!e.isError);
      let out = text;
      const dehy = dehydrateErrorOutput(out);
      if (dehy !== undefined) out = dehy + DEHYDRATE_HINT;
      if (hint) out += hint;
      const pruned = pruneToolOutput(out, name);
      if (pruned === out && out === text) return;
      // 保留非文本块（图片等），原位回写文本（修复此前只返回单个 text 块丢块的问题）
      const content = Array.isArray(e.content)
        ? rebuildTextContent(e.content as TextBlockLike[], pruned)
        : [{ type: 'text' as const, text: pruned }];
      return { content, details: e.details };
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
      compactedThisSettlement = true;
      autoContinueGate.arm();
      compactDecider.markCompact();
      ctx.compact?.();
    },
  });

  // 任务完成：写一条结构化任务记录（供 scripts/task-summarizer.mjs 批量总结）
  registerHook(pi, {
    event: 'agent_settled',
    handler: async (_event, ctx) => {
      const req = extractUserRequest(lastContextMessages ?? []);
      const usage = ctx.getContextUsage?.();
      const cache = getCacheStats();
      recordTaskRecord({
        userRequest: req,
        contextTokens: usage?.tokens ?? 0,
        cacheHit: cache.cacheReadTokens,
        output: 0,
        tools: toolState.runToolCount,
        compacted: compactedThisSettlement,
        userSeq: 0,
      });
      toolState.runToolCount = 0;
      compactedThisSettlement = false;

      // 自适应 thinking 档位：按真实窗口比例升降（压缩后自然回落，可升回）
      if (thinkingAutoEnabled) {
        if (!thinkState) thinkState = createState(getThinkingLevel(pi));
        const window = usage?.contextWindow;
        const tokens = usage?.tokens;
        if (window && tokens != null && window > 0) {
          tickThinkingLevel(
            thinkState,
            tokens / window,
            (l) => setThinkingLevel(pi, l),
            Date.now(),
            inferTaskType(req),
          );
        }
      }
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
