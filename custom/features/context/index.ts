/**
 * Context Feature
 *
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 *
 * 迁移自 pi-tools pi-context：使用真实 contextWindow/用量校准上下文预算。
 */

import { join, dirname } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerCommand, sendMessage, getAllToolNames, getThinkingLevel, setThinkingLevel } from '../../adapters/ui-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { parseSubcommand, filterCompletions } from '../../core/cli';
import { appendJSONLRotating, ensureDir } from '../../core/fs-json';
import { getMemoryDir } from '../../core/config';
import { fingerprintRequest, formatFingerprint, type PrefixFingerprint } from './budget/prefix-fingerprint';
import { applyToolLayering, dormantToolsActive, enableGroup, buildToolsReport, buildSleepingSummary } from './budget/tool-layering';
import { SLEEPING_GROUPS, groupsWithTools } from './budget/tool-groups';
import {
  createToolLifecycleState,
  EFFICIENCY_ADVICE,
  LOW_PRESSURE_DELEGATION,
  FULL_DELEGATION_ADVICE,
  hasInProgressTask,
  passesIdleGateAtTurnEnd,
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
  setCompactThreshold,
  recordToolUsage,
  estimateTokens,
  getBudgetReport,
  pruneToolOutput,
  getCacheStats,
} from './budget/budget';
import { pruneToolResults, pruneThinkingBudget, sweepPruneRefs } from './budget/prune';
import { sweepArchive } from './budget/output-archive';
import type { PruneMessage } from './budget/prune';
import { makeCompactDecider, makeAutoContinueGate, computeCompactThreshold } from './budget/auto-compact';
import { createSpeedTracker, formatSpeedCompact } from './budget/token-speed';
import { recordUsage, loadDiagLines, formatUsageSummary } from './usage-diag/diag';
import {
  ABSOLUTE_TOKENS,
  RESTART_TOKENS,
  COMPACT_COOLDOWN_MS,
  IDLE_MS,
  TASK_GATE,
  PRUNE_PROTECT,
  PRUNE_MINIMUM,
  KEEP_THINKING_TOKENS,
  PER_TURN_ERASE,
  TOOL_LAYERING,
  readEnvRatio,
  resolveContext,
  hasBackgroundTask,
} from './budget/task-gate';
import { snapshotBeforeCompact } from './budget/compression';
import {
  createWarmPrefixState,
  saveMainRequestPayload,
  buildReplayedPayload,
  isSummarizationMessage,
} from './budget/warm-prefix';
import { appendUsage } from './usage-stats';



/** 易变运行时提示（压力档/休眠工具摘要/重启提示）的消息类型；仅内容变化时追加 */
const VOLATILE_ADVICE_TAG = 'my-pi-context-advice';

export function register(pi: ExtensionAPI): void {
  const toolState = createToolLifecycleState();
  // 连续失败熔断计数（进程内存态，成功即清零）
  const failStreak = new Map<string, number>();
  const compactDecider = makeCompactDecider(COMPACT_COOLDOWN_MS, {
    largeRatio: readEnvRatio('PI_CONTEXT_COMPACT_LARGE_RATIO'),
    smallRatio: readEnvRatio('PI_CONTEXT_COMPACT_SMALL_RATIO'),
    absoluteTokens: ABSOLUTE_TOKENS,
  });
  const autoContinueGate = makeAutoContinueGate();
  // 暖前缀重放（deepseek/qwen/gemini 等自动前缀缓存模型）：保存主请求 payload，压缩摘要请求
  // 时复用同一前缀（含 tools），使摘要请求命中前缀缓存——压缩一次要求代几十 K token 全量
  // 未命中（$0.15/M），重放后大部分转为 cacheRead（$0.003/M）。
  const warmState = createWarmPrefixState();
  warmState.compactWarmAllowed = true;
  // 运行时前缀指纹（逐请求）：定位"整段缓存失效"发生在 system / tools / 消息序列哪一段。  // 纯诊断，PI_PREFIX_FINGERPRINT=off 可关；只写本地 JSONL，不进 LLM 上下文。
  const fingerprintEnabled = process.env.PI_PREFIX_FINGERPRINT !== 'off';
  const fingerprintFile =
    process.env.PI_PREFIX_FINGERPRINT_FILE || join(getMemoryDir(), 'logs', 'prefix-fingerprints.jsonl');
  let lastFingerprint: PrefixFingerprint | null = null;
  // 上一次追加的易变运行时提示内容（仅变化时追加，避免每轮重插导致的消息序列位移）
  let lastVolatileContext: string | null = null;
  const recordFingerprint = (payload: { messages?: unknown[]; tools?: unknown }): void => {
    try {
      const fp = fingerprintRequest(payload, lastFingerprint);
      lastFingerprint = fp;
      ensureDir(dirname(fingerprintFile));
      appendJSONLRotating(fingerprintFile, fp, 1_000_000);
    } catch {
      /* 诊断失败不影响请求 */
    }
  };
  /** 最近一次请求的前缀指纹（供 /context fingerprint 查看） */
  const lastFingerprintLine = (): string =>
    lastFingerprint ? formatFingerprint(lastFingerprint) : '(尚未记录到请求)';
  const fallbackContextWindow = (() => {
    const n = Number(process.env.PI_CONTEXT_WINDOW_FALLBACK);
    return Number.isFinite(n) && n > 0 ? n : 1_000_000;
  })();
  let lastProviderContextTokens = 0;
  let layeringApplied = false;
  let lastContextMessages: unknown[] | null = null;
  let compactedThisSettlement = false;
  // 自动阈值路径已写快照的标记：session_before_compact 据此避免重复快照，
  // 而手动 /compact（不经过本路径）仍会走 session_before_compact 落快照。
  let snapshotDoneForCompact = false;
  let thinkState: ThinkLevelState | null = null;
  const thinkingAutoEnabled = process.env.PI_CONTEXT_THINKING_AUTO !== 'off';
  const speedTracker = createSpeedTracker();
  let lastSpeedUiAt = 0;
  // 门3（空闲判定）状态：用户上次输入时刻、任务忙→闲的转折时刻、上轮任务是否忙
  let lastUserActivityTs = 0;
  // 本回合开始前的活动锚点（input 钩子在覆盖 lastUserActivityTs 之前捕获），
  // 用于 turn_end 判定“用户在本回合开始前是否已离开足够久”（见 passesIdleGateAtTurnEnd）
  let preTurnIdleAnchor = 0;
  let taskDoneAt = 0;
  let taskBusyPrev: boolean | null = null;

  // 注册命令：/context - 上下文预算查看
  // 命令：/usage-diag — 会话用量诊断汇总（不进 LLM 上下文）
  registerCommand(pi, 'usage-diag', {
    description: '显示会话 LLM 用量诊断（每轮 input/缓存/输出汇总）',
    handler: async (_args, ctx) => {
      const content = formatUsageSummary(loadDiagLines());
      ctx?.ui?.notify?.(`usage-diag: ${content.split('\n').length} 行，已发送到聊天（不进 LLM 上下文）。`, 'info');
      sendMessage(pi, { customType: 'usage-diag', content, display: true }, { triggerTurn: false });
    },
  });

  registerCommand(pi, 'context', {
    description: '查看上下文预算与 token 用量',
    getArgumentCompletions: (prefix) => {
      const subcommands = [
        { value: 'usage', label: 'usage', description: '显示 token 使用诊断' },
        { value: 'report', label: 'report', description: '显示预算报告' },
        { value: 'fingerprint', label: 'fingerprint', description: '显示最近一次请求的前缀指纹' },
        { value: 'help', label: 'help', description: '显示用法' },
      ];
      const filtered = filterCompletions(subcommands, prefix);
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim() || 'usage';
      const helpText =
        '/context <子命令>\n  usage        显示 token 使用诊断\n  report       显示预算报告\n  fingerprint  显示最近一次请求的前缀指纹';
      if (subcommand === 'help') {
        ctx.ui.notify(helpText, 'info');
        return;
      }
      if (subcommand === 'fingerprint') {
        ctx.ui.notify(
          `最近一次请求前缀指纹:\n  ${lastFingerprintLine()}\n逐请求日志: ${fingerprintFile}` +
            (fingerprintEnabled ? '' : '\n（PI_PREFIX_FINGERPRINT=off，本次未记录）'),
          'info',
        );
        return;
      }
      if (subcommand === 'usage' || subcommand === 'report') {
        const r = getBudgetReport();
        ctx.ui.notify(
          `Token 使用报告:
已使用: ${r.used.toLocaleString()} / ${r.total.toLocaleString()} 窗口 (${(r.ratio * 100).toFixed(1)}%)
压缩阈值: ${r.budgetBase.toLocaleString()} token（压力 ${(r.pressureRatio * 100).toFixed(1)}%）
压力级别: ${r.pressure}
主要消耗: ${r.topConsumers.map((c) => `${c.tool} (${c.tokens.toLocaleString()} token)`).join(', ') || '无'}`,
          'info',
        );
        return;
      }
      ctx.ui.notify(`未知子命令: ${subcommand}\n${helpText}`, 'info');
    },
  });

  // 注册工具：enable_tool —— 仅在按需加载开启时有意义（默认全部常驻，见 TOOL_LAYERING）
  registerTool(pi, {
    name: 'enable_tool',
    description: TOOL_LAYERING
      ? `启用休眠工具组（${SLEEPING_GROUPS.map((g) => g.name).join('/')}）。启用后工具列表更新一次（前缀缓存重算），本会话内保持，重启恢复默认；已启用组再次启用无副作用。`
      : '工具按需加载已关闭（默认）：全部工具 schema 已常驻，无需调用本工具。',
    parameters: {
      group: {
        type: 'string',
        enum: SLEEPING_GROUPS.map((g) => g.name),
        description: '要启用的休眠工具组名（按需加载关闭时无操作）',
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
    description: '工具状态：list 查看分组/状态；按需加载开启时 enable <组> 可启用休眠组',
    getArgumentCompletions: (prefix) => {
      const trimmed = prefix.trim();
      const first = trimmed.split(/\s+/)[0] ?? '';
      if (!trimmed.includes(' ')) {
        const items = [
          { value: 'list', label: 'list - 查看分组/状态' },
          ...(TOOL_LAYERING ? [{ value: 'enable ', label: 'enable - 启用休眠组' }] : []),
          { value: 'help', label: 'help - 显示用法' },
        ];
        return filterCompletions(items, first) || null;
      }
      if (first === 'enable' && TOOL_LAYERING) {
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
      const { sub: cmd, rest } = parseSubcommand(args);
      if (cmd === 'enable' && rest[0]) {
        const r = enableGroup(pi, rest[0]);
        ctx.ui.notify(r.message, r.ok ? 'info' : 'warning');
        return;
      }
      if (cmd === 'help') {
        const enableLine = TOOL_LAYERING
          ? `  enable <组>   启用休眠组（${SLEEPING_GROUPS.map((g) => g.name).join('/')}）\n`
          : '  （按需加载已关闭：全部工具常驻，enable 无操作）\n';
        ctx.ui.notify(
          `工具命令:\n\n用法: /tools <子命令>\n\n子命令:\n  list          查看分组/状态\n${enableLine}  help          显示此帮助`,
          'info',
        );
        return;
      }
      const report = buildToolsReport(pi);
      ctx.ui.notify(
        TOOL_LAYERING ? `tools: ${SLEEPING_GROUPS.length} 个休眠组` : 'tools: 全部工具常驻',
        'info',
      );
      sendMessage(pi, { customType: 'tools-report', content: report, display: true }, { triggerTurn: false });
    },
  });

  // 会话开始：重置预算 + 清理过期擦除溯源
  registerHook(pi, {
    event: 'session_start',
    handler: async () => {
      resetAllBudgets();
      void sweepPruneRefs(pruneRefsDir(), { retentionDays: PRUNE_REFS_RETENTION_DAYS }).catch(() => {});
      // 工具输出归档目录此前无任何清理（实测 442 文件已无上限增长）；按 14 天/200MB 回收，
      // 保留窗口比 prune-refs 宽，因为归档是"凭路径读回原文"的凭据。
      void sweepArchive().catch(() => {});
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
      let compactThreshold: number | null = null;
      if (usage) {
        setContextWindow(usage.contextWindow);
        if (usage.tokens != null) setUsedTokens(usage.tokens);
        // 压缩阈值同时作为"压力分档基准"：窗口 1M 而阈值 256K 时，按窗口比例分档
        // 永远到不了高档，模型会在压缩前收不到任何预警。
        compactThreshold = computeCompactThreshold(usage.contextWindow, {
          absoluteTokens: ABSOLUTE_TOKENS,
          largeRatio: readEnvRatio('PI_CONTEXT_COMPACT_LARGE_RATIO'),
          smallRatio: readEnvRatio('PI_CONTEXT_COMPACT_SMALL_RATIO'),
        });
        if (compactThreshold) setCompactThreshold(compactThreshold);
      }
      const e = event as { systemPrompt?: string };
      if (typeof e.systemPrompt !== 'string') return;
      // 压力提示：按"距压缩阈值"的比例分档（静态文本，仅跨档时变化，缓存友好；禁止注入精确数值）
      const ratio =
        compactThreshold && compactThreshold > 0 ? (usage?.tokens ?? 0) / compactThreshold : 0;
      let pressureLine = '';
      if (ratio >= 0.9) {
        pressureLine =
          '[上下文已接近压缩阈值；达到后会压缩并生成摘要，关键决策与待办会保留在摘要中；需精确保真的细节可先存 memory_store。]';
      } else if (ratio >= 0.75) {
        pressureLine = '[上下文已接近压缩阈值。]';
      }
      const advice = pressureLine
        ? `${FULL_DELEGATION_ADVICE}\n${pressureLine}`
        : LOW_PRESSURE_DELEGATION;
      // 重启提示：超过绝对阈值时给静态指引（先 /compact 再重启，避免首轮全量重发）
      const restartHint =
        usage?.tokens != null && usage.tokens > RESTART_TOKENS
          ? '[上下文已超过重启提示阈值：如需重启，建议先 /compact，可避免重启后首轮全量重发。]'
          : '';
      // 易变运行时提示（压力档/休眠工具摘要/重启提示）**不再写入 system prompt**：
      // 它们位于前缀最前处，一旦变化就是整段缓存失效（实测单次 170K–316K 全价重算）。
      // 改为"内容变化时才追加一条消息"（append-only，不删除旧的）：变化点落在尾部，
      // 只影响其后的少量 token。对齐 DSH 的 change-only volatile context 做法。
      // 休眠组摘要只在按需加载开启时出现：默认全部工具常驻，列休眠组只会误导模型。
      const volatileText = [
        advice,
        TOOL_LAYERING ? buildSleepingSummary(new Set(getAllToolNames(pi))) : '',
        restartHint,
      ]
        .filter(Boolean)
        .join('\n\n');
      let message: { customType: string; content: string; display: boolean } | undefined;
      if (volatileText && volatileText !== lastVolatileContext) {
        lastVolatileContext = volatileText;
        message = { customType: VOLATILE_ADVICE_TAG, content: volatileText, display: false };
      }
      // system prompt 只追加静态常量，保持逐字节稳定（工具集变化本身无法避免）
      return {
        systemPrompt: `${e.systemPrompt}\n\n${EFFICIENCY_ADVICE}`,
        ...(message ? { message } : {}),
      };
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

      // 每轮擦除默认关闭（PI_CONTEXT_ERASE=on 打开）：它会每轮改写历史中靠前的消息，
      // 使其后所有 token 失去前缀缓存（实测占单会话 67% 成本）。见 budget/task-gate.ts。
      if (PER_TURN_ERASE) {
        const dumpRef = buildPruneDumpRef(ctx as { sessionManager?: { getSessionId?: () => string | null } });
        const pruned = pruneToolResults(working as PruneMessage[], {
          protectTokens: PRUNE_PROTECT,
          minimumTokens: PRUNE_MINIMUM,
          dumpRef,
        });
        if (pruned.modified) {
          working = pruned.messages as unknown[];
          modified = true;
        }

        // 历史 thinking 块按 token 预算擦除。实测长会话中 thinking 可占上下文 ~50%
        // （10 小时会话：155K/310K）。注意：擦除点在会话前部，代价是其后全量缓存失效。
        const thinkTrimmed = pruneThinkingBudget(working as PruneMessage[], KEEP_THINKING_TOKENS);
        if (thinkTrimmed.modified) {
          working = thinkTrimmed.messages as unknown[];
          modified = true;
        }
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
    handler: async (event, ctx) => {
      // 记录本轮 provider 上下文 token（真实 usage 缺失时的回退来源）
      const msg = (event as { message?: { usage?: { input?: number; cacheRead?: number } } }).message;
      if (msg?.usage) {
        lastProviderContextTokens = (msg.usage.input ?? 0) + (msg.usage.cacheRead ?? 0);
      }
      const resolved = resolveContext(ctx, lastProviderContextTokens, fallbackContextWindow);
      if (!resolved) return;
      setContextWindow(resolved.window);
      setUsedTokens(resolved.tokens);
      // 门1：有进行中的计划任务时不自动压缩（PI_CONTEXT_TASK_GATE=off 可关）
      // 同时追踪任务忙→闲转折点，供门3（空闲判定）使用
      const taskBusy = TASK_GATE && hasInProgressTask(getTodos());
      if (taskBusyPrev === true && !taskBusy) taskDoneAt = Date.now();
      taskBusyPrev = taskBusy;
      if (taskBusy) return;
      // 门2：本会话仍有后台任务（tmux）时不自动压缩
      if (hasBackgroundTask()) return;
      const decision = compactDecider.decide(resolved.tokens, resolved.window);
      if (!decision.shouldCompact) return;
      // 门3：本回合开始前用户已离开 ≥ IDLE_MS，或本回合自身已持续 ≥ IDLE_MS（长工具循环）
      // 才允许压缩。修复前这里比较的是“距本回合用户输入”，差值恒为本回合耗时（秒级），
      // 门永远不过 → 交互式长会话从不压缩（实测 341K 上下文零压缩）。
      if (
        !passesIdleGateAtTurnEnd({
          idleMs: IDLE_MS,
          preTurnIdleAnchor,
          lastUserActivityTs,
          now: Date.now(),
        })
      ) {
        return;
      }
      // 压缩前快照（保留最近 8 份/7 天，失败不阻塞压缩）
      snapshotBeforeCompact(lastContextMessages, resolved.tokens, decision.threshold, 'threshold');
      snapshotDoneForCompact = true;
      compactedThisSettlement = true;
      autoContinueGate.arm();
      compactDecider.markCompact();
      ctx.compact?.();
    },
  });

  // 任意压缩（含手动 /compact、pi 内置溢出压缩）前落快照。
  // 修复：此前只在自动阈值路径调用 snapshotBeforeCompact，手动 /compact 不产生快照
  // （pi-tools 的 pi-memory 在 session_before_compact 里快照，覆盖所有压缩）。
  registerHook(pi, {
    event: 'session_before_compact',
    handler: () => {
      if (snapshotDoneForCompact) {
        // 本轮自动压缩已快照过，避免重复
        snapshotDoneForCompact = false;
        return;
      }
      if (!lastContextMessages || lastContextMessages.length === 0) return;
      const used = getBudgetReport().used;
      const threshold = getBudgetReport().budgetBase;
      snapshotBeforeCompact(lastContextMessages, used, threshold, 'manual');
    },
  });

  // 输出速度：turn_start 计时，message_update 实时估算，turn_end 用真实 output token 结算
  // 用户输入：记录活动时刻（门3 空闲判定用；工具续轮不触发此事件）
  registerHook(pi, {
    event: 'input',
    handler: () => {
      // 先记录本回合开始“之前”的活动锚点，再更新当前输入时刻：
      // turn_end 的压缩判定依赖它区分“用户刚从长时间空闲回来”与“用户正在连续对话”。
      preTurnIdleAnchor = Math.max(lastUserActivityTs, taskDoneAt);
      lastUserActivityTs = Date.now();
    },
  });

  // 请求发出前：非摘要请求→记录为暖前缀；摘要请求→重放已记录前缀（返回新 payload 即替换）
  registerHook(pi, {
    event: 'before_provider_request',
    handler: (event, ctx) => {
      const payload = (event as { payload?: { messages?: unknown[]; tools?: unknown } }).payload;
      if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) return;
      const modelKey = (ctx as { model?: { id?: string } }).model?.id ?? '';
      const last = payload.messages[payload.messages.length - 1] as { role?: string; content?: unknown };
      if (isSummarizationMessage(last)) {
        const replayed = buildReplayedPayload(warmState, payload.messages, payload);
        if (fingerprintEnabled) recordFingerprint(replayed ?? payload);
        return replayed ?? undefined;
      }
      saveMainRequestPayload(warmState, modelKey, payload.messages, payload.tools);
      if (fingerprintEnabled) recordFingerprint(payload);
      return undefined;
    },
  });

  registerHook(pi, {
    event: 'turn_start',
    handler: (_event, ctx) => {
      speedTracker.startTurn(Date.now());
      lastSpeedUiAt = 0;
      // 新一轮开始清掉上一轮的终值，避免空闲时把旧速度误读为当前速度
      if (ctx.hasUI) ctx.ui.setStatus('tps', undefined);
    },
  });

  registerHook(pi, {
    event: 'message_update',
    handler: (event, ctx) => {
      if (!ctx.hasUI) return;
      const delta = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
      if (delta?.type !== 'text_delta' && delta?.type !== 'thinking_delta') return;
      speedTracker.addOutputChars(delta.delta?.length ?? 0);
      const now = Date.now();
      if (now - lastSpeedUiAt < 500) return;
      lastSpeedUiAt = now;
      const tps = speedTracker.liveSpeed(now);
      if (tps !== null) ctx.ui.setStatus('tps', formatSpeedCompact(tps));
    },
  });

  registerHook(pi, {
    event: 'turn_end',
    handler: (event, ctx) => {
      const msg = (event as {
        message?: {
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            reasoning?: number;
            totalTokens?: number;
          };
        };
      }).message;
      const usage = msg?.usage;
      // 每轮用量落盘（headless 也记录）：用于定位 token 消耗大头（input 未命中/cacheRead/output）
      if (usage) {
        try {
          const input = usage.input ?? 0;
          const cacheRead = usage.cacheRead ?? 0;
          const cacheWrite = usage.cacheWrite ?? 0;
          const output = usage.output ?? 0;
          recordUsage({
            ts: Date.now(),
            input,
            cacheRead,
            cacheWrite,
            output,
            reasoning: usage.reasoning ?? 0,
            total: usage.totalTokens ?? input + cacheRead + cacheWrite + output,
            contextTokens: ctx.getContextUsage?.()?.tokens ?? 0,
          });
        } catch {
          /* 诊断记录失败不影响回合 */
        }
      }
      if (!ctx.hasUI) return;
      const tps = speedTracker.finishTurn(usage?.output ?? 0, Date.now());
      if (tps !== null) ctx.ui.setStatus('tps', formatSpeedCompact(tps));
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
