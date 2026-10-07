/**
 * Context Feature
 *
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 *
 * 迁移自 pi-tools pi-context：使用真实 contextWindow/用量校准上下文预算。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerCommand, sendMessage, getAllToolNames, getActiveTools, getThinkingLevel, setThinkingLevel } from '../../adapters/ui-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { parseSubcommand, filterCompletions } from '../../core/cli';
import { appendJSONLRotating, ensureDir } from '../../core/fs-json';
import { getMemoryDir, getAgentDir } from '../../core/config';
import { fingerprintRequest, formatFingerprint, type PrefixFingerprint } from './budget/prefix-fingerprint';
import { auditSystemInjection, buildSystemPrompt, EFFICIENCY_ADVICE } from './budget/system-prompt';
import { normalizeSessionTitle, MAX_SESSION_TITLE_BYTES } from './budget/session-title';
import { collectWorkspaceInstructions } from './budget/workspace-instructions';
import { applyToolLayering, dormantToolsActive, enableGroup, buildToolsReport, buildSleepingSummary } from './budget/tool-layering';
import { SLEEPING_GROUPS, groupsWithTools } from './budget/tool-groups';
import {
  createToolLifecycleState,
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
  clampForCacheSafety,
  cacheSafeMaxLevel,
  recordLevelChange,
  loadLevelChanges,
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
  getOutputReport,
  pruneToolOutput,
  getCacheStats,
} from './budget/budget';
import { pruneToolResults, pruneThinkingBudget, sweepPruneRefs } from './budget/prune';
import { sweepArchive } from './budget/output-archive';
import type { PruneMessage } from './budget/prune';
import { makeCompactDecider, makeAutoContinueGate, computeCompactThreshold } from './budget/auto-compact';
import { createSpeedTracker, formatSpeedCompact } from './budget/token-speed';
import { recordUsage, recordAutoCompact, recordPrune, recordUsageMissing, loadDiagLines, formatUsageSummary } from './usage-diag/diag';
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
  DEDUP_SUMMARIES,
  BASH_TIMEOUT_CEIL_S,
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
import { analyzeBashCommand, appendUsage } from './usage-stats';



/** 易变运行时提示（压力档/休眠工具摘要/重启提示）的消息类型；仅内容变化时追加 */
const VOLATILE_ADVICE_TAG = 'my-pi-context-advice';

export function register(pi: ExtensionAPI): void {
  // 注入面体检（P4）：测试守门只在提交时跑，而注入文本常在会话中被改。这里启动时做一次廉价审计，
  // 超预算或出现日期/百分比等易变内容就显式告警（不改行为，只让"静默失效"变成可见）。
  try {
    const appendPath = join(getAgentDir(), 'APPEND_SYSTEM.md');
    const audit = auditSystemInjection({
      appendSystemText: existsSync(appendPath) ? readFileSync(appendPath, 'utf-8') : undefined,
    });
    for (const w of audit.warnings) console.warn(`[context] 注入面告警：${w}`);
  } catch {
    /* 体检失败不影响启动 */
  }
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
  // 加固块丢失的独立台账（量小、只在实际丢失时写）：这是"整段前缀作废"的直接证据。
  const appendLostFile = process.env.PI_SYSTEM_APPEND_LOST_FILE || join(getMemoryDir(), 'logs', 'system-append-lost.jsonl');
  // 上一次追加的易变运行时提示内容（仅变化时追加，避免每轮重插导致的消息序列位移）
  let lastVolatileContext: string | null = null;
  const recordFingerprint = (
    payload: { messages?: unknown[]; tools?: unknown },
    ctx?: { hasUI?: boolean; ui?: { notify?: (message: string, level?: string) => void } },
  ): void => {
    try {
      // 第 5 参数 = my-pi 追加到 system 末尾的加固块文本：指纹据此记录 `systemAppend`，
      // 一旦某回合走了 pi 的 forceSystemPrompt 失败路径（加固块整块消失 → 前缀从第 0 个
      // token 起分叉），日志会直接标出 `system:append-lost`（2026-10-07 实测 147K 全量重放）。
      const fp = fingerprintRequest(payload, lastFingerprint, Date.now(), getThinkingLevel(pi), EFFICIENCY_ADVICE);
      lastFingerprint = fp;
      ensureDir(dirname(fingerprintFile));
      appendJSONLRotating(fingerprintFile, fp, 1_000_000);
      // pi 会**静默吞掉** `before_agent_start` 的异常（只发给内存 listener，不落盘），于是
      // "加固块整块丢失"此前完全不可观测。这里主动喊出来：写独立台账 + 有 UI 时告警。
      if (fp.changed.includes('system:append-lost')) {
        try {
          ensureDir(dirname(appendLostFile));
          appendJSONLRotating(
            appendLostFile,
            { ts: fp.ts, systemBytes: fp.systemBytes, systemSections: fp.systemSections, changed: fp.changed },
            200_000,
          );
        } catch {
          /* 台账失败不影响请求 */
        }
        if (ctx?.hasUI) {
          ctx.ui?.notify?.(
            `system 前缀加固块丢失（system ${fp.systemBytes}B，未重启）：该回合整段前缀缓存作废`,
            'warning',
          );
        }
      }
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
  // 自动切档默认**关闭**（PI_CONTEXT_THINKING_AUTO=on 才开启）。
  // 原因（2026-09-27 实测）：切档使整段前缀缓存失效（切档后 cacheRead 0/141K），
  // 一次切档 ≈ 整段全价重算；而降一档省下的 thinking token 远小于该代价。
  // 手动档位（/thinking、thinking_level 工具、/mode）不受影响。
  const thinkingAutoEnabled = process.env.PI_CONTEXT_THINKING_AUTO === 'on';
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
        // 档位切换是"前缀前端变更"的直接原因之一（切档 = 其后整段缓存失效），
        // 因此把切换历史放进报告——此前 recordLevelChange 在写、loadLevelChanges 无人读（P4 第三批接线）。
        const changes = loadLevelChanges();
        const lastChange = changes[changes.length - 1];
        const levelLine =
          changes.length > 0 && lastChange
            ? `\n档位切换: ${changes.length} 次（最近 ${lastChange.from} → ${lastChange.to}，${lastChange.reason}）`
            : '';
        // 工具输出预算是真实生效的（pruneToolOutput 在裁剪时累计），把明细接进报告
        // （getOutputReport 此前无消费者，P4 第三批接线）。
        const outBudget = getOutputReport();
        ctx.ui.notify(
          `Token 使用报告:
已使用: ${r.used.toLocaleString()} / ${r.total.toLocaleString()} 窗口 (${(r.ratio * 100).toFixed(1)}%)
压缩阈值: ${r.budgetBase.toLocaleString()} token（压力 ${(r.pressureRatio * 100).toFixed(1)}%）
压力级别: ${r.pressure}
主要消耗: ${r.topConsumers.map((c) => `${c.tool} (${c.tokens.toLocaleString()} token)`).join(', ') || '无'}${levelLine}${outBudget ? `\n${outBudget}` : ''}`,
          'info',
        );
        return;
      }
      ctx.ui.notify(`未知子命令: ${subcommand}\n${helpText}`, 'info');
    },
  });

  // 注册工具：enable_tool —— 仅在按需加载开启时注册
  // 默认（TOOL_LAYERING=false）全部工具 schema 常驻，工具本身无操作，注册只会造成模型空转，故不注册
  if (TOOL_LAYERING) {
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
        return enableGroup(pi, group).message;
      },
    });
  }

  // 注册工具：thinking_level —— 模型建议切档，规则审批（死区/压力方向）
  registerTool(pi, {
    name: 'thinking_level',
    description:
      '建议切换 thinking 档位（low/medium/high）。程序做防抖死区与压力方向审批：死区内或上下文压力 critical 时升档会被拒绝；通过后记账。**注意：切档会使整段前缀缓存失效（≈当前上下文全价重算），非必要不要切**；自动切档默认已关闭（PI_CONTEXT_THINKING_AUTO=on 开启）。',
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

  // 注册工具：session_title —— 模型在理解任务后给会话起一个简短标题。
  // 只写 pi 的会话元数据（`session_info`，append-only），不进 LLM 上下文，
  // 故不触碰提示词前缀、不影响缓存命中。规范化为空时不写入（避免清掉已有标题）。
  registerTool(pi, {
    name: 'session_title',
    description:
      '设置当前会话的简短标题（用于会话列表/页脚展示）。标题只写会话元数据且 append-only，不进入上下文、不影响前缀缓存。在理解任务后调用一次；仅当会话主题明显变化时更新，不要每轮重复设置。',
    parameters: {
      title: { type: 'string', description: '简短标题（建议 4–12 个汉字或几个词）' },
    },
    execute: async (args, ctx) => {
      const title = normalizeSessionTitle(String(args.title ?? ''), MAX_SESSION_TITLE_BYTES);
      if (!title) return '标题为空，未设置会话标题。';
      if (!ctx?.setSessionTitle) return '当前环境不支持设置会话标题。';
      ctx.setSessionTitle(title);
      return `会话标题已设为「${title}」。`;
    },
  });

  // 缓存安全钳制：运行时档位高于 PI_THINKING_MAX_LEVEL（默认 high）时夹回。
  // 必须挂在 thinking_level_select 上：切换到 deepseek-flash 会被自动解析成 max
  // （实测 4/4 次），而 max 只烧 reasoning token。夹档发生在**模型切换的同一次**，
  // 模型切换本身已使缓存失效，因此这次夹档不产生额外代价；之后再无切档。
  registerHook(pi, {
    event: 'thinking_level_select',
    handler: (event, ctx) => {
      const level = String((event as { level?: string }).level ?? '');
      const clamped = clampForCacheSafety(level);
      if (!clamped) return;
      recordLevelChange({
        from: level,
        to: clamped,
        reason: `缓存安全上限 PI_THINKING_MAX_LEVEL=${cacheSafeMaxLevel()}`,
        pressure: 'n/a',
        source: 'auto',
      });
      setThinkingLevel(pi, clamped);
      if (ctx?.hasUI) ctx.ui.notify(`thinking 档位由 ${level} 夹到 ${clamped}（缓存安全上限）`, 'info');
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
  //
  // ⚠️ 本处理器的返回值是**缓存关键路径**：它返回的 `systemPrompt` 会被 pi 投影成请求的 head
  // system message（`forceSystemPrompt`，见 `core/extensions/runner.ts` 的 emitBeforeAgentStart）。
  // 而 pi 对 `before_agent_start` 处理器的**异常是静默吞掉的**（只 emitError 给内存 listener，
  // 不落盘）→ 抛错时投影不生效，请求退回"纯分段渲染"，my-pi 的加固块**整块消失**，
  // system 位于请求最前 → 从第 0 个 token 起分叉 → 整段全价重放。
  // 实测（2026-10-07）：一次翻转 = 147,555 token 全价重算，占该会话全部未命中的 60.8%。
  //
  // 因此这里按「**关键路径 vs 可选增强**」分层，判据是"失败了会不会改变前缀字节"：
  //   · 关键路径 = 读 system 文本 → 追加加固块。只做纯字符串运算，不允许被任何 pi API 失败打断；
  //   · 可选增强 = 工具分层、工具顺序对齐、用量校准、压力提示、休眠组摘要。全部就地 try/catch，
  //     最坏情况只是"这一轮少了提示/少了对齐"，**绝不牵连前缀**。
  // 回归锁：custom/features/context/__tests__/system-prompt-total.test.ts —— 用"会抛错的 pi/ctx"
  // 断言产出的 systemPrompt 与正常路径**逐字节相同**。
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async (event, ctx) => {
      // ── 可选增强 1：工具分层（按需加载关闭时是空操作）──
      try {
        if (!layeringApplied) {
          applyToolLayering(pi);
          layeringApplied = true;
        } else if (dormantToolsActive(pi)) {
          // 计划模式退出等会恢复全量工具，这里自愈回分层
          applyToolLayering(pi);
        }
      } catch {
        /* 增强失败：不影响本次 system 文本 */
      }
      // ── 可选增强 2：统一本次渲染的工具顺序 ──
      // 重启恢复的首轮 options 可能仍是 transcript 顺序，而 pi 的 setActiveTools 会以
      // getActiveToolNames() 重建 _baseSystemPromptOptions；两者不一致时，system 的 tools 清单
      // 会在后续回合整体重排 -> 整段缓存失效（2026-09-27 实测：重启后第二个新回合一次 ~80k 全量重放）。
      // 顺序关键：**必须在读 `event.systemPrompt` 之前**——那个 getter 是惰性渲染，读它才定稿文本；
      // 反了会白丢这份对齐（实测约 9 字节）。
      const sysOptions = (event as { systemPromptOptions?: { selectedTools?: string[] } }).systemPromptOptions;
      try {
        if (sysOptions && Array.isArray(sysOptions.selectedTools)) {
          const active = getActiveTools(pi);
          if (active.length > 0) sysOptions.selectedTools = active;
        }
      } catch {
        /* 增强失败：不影响本次 system 文本 */
      }
      // ── 关键路径：拿 system 文本并追加加固块。走到这里，前面的失败都已被吞掉。──
      // system prompt 只追加**静态常量**，保持逐字节稳定（工具集变化本身无法避免）：
      // HARD_RULES = 不变量摘要（权威性留在 system 层），EFFICIENCY_ADVICE = 效率建议。
      // 装配唯一入口 = buildSystemPrompt（P4 硬化：字节预算 + 易变内容守门）。
      const e = event as { systemPrompt?: string };
      const appended = typeof e.systemPrompt === 'string' ? buildSystemPrompt(e.systemPrompt) : undefined;
      // ── 可选增强 3：用量校准 + 压力提示 + 休眠组摘要 ──
      let message: { customType: string; content: string; display: boolean } | undefined;
      try {
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
        // 重启提示：锚定"重启后首轮全量重发前缀"的成本，取绝对阈值与压缩阈值 90% 的较小值，
        // 避免阈值高于压缩阈值时提示永不触发（128K 窗口下压缩阈值约 109K）。
        const restartCeiling =
          compactThreshold && compactThreshold > 0
            ? Math.min(RESTART_TOKENS, Math.floor(compactThreshold * 0.9))
            : RESTART_TOKENS;
        const restartHint =
          usage?.tokens != null && usage.tokens > restartCeiling
            ? '[如需重启，建议先 /compact，可避免重启后首轮全量重发前缀。]'
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
        if (volatileText && volatileText !== lastVolatileContext) {
          lastVolatileContext = volatileText;
          message = { customType: VOLATILE_ADVICE_TAG, content: volatileText, display: false };
        }
      } catch {
        /* 增强失败：不影响本次 system 文本 */
      }
      return {
        ...(appended !== undefined ? { systemPrompt: appended } : {}),
        ...(message ? { message } : {}),
      };
    },
  });

  // ── 工作区指令（AGENTS.md/CLAUDE.md）改为尾部 append-only 注入 ──
  // 背景：pi 原生把工作区指令放 system prompt 的 project_context 段（前缀最前处），而这份文件
  // 正是 my-pi 自己频繁编辑的 → 每改一次整段前缀作废。故 pi 侧用 --no-context-files 关掉原生注入
  // （scripts/pi-supervisor.sh / dev.sh），改由这里复刻同一套发现规则注入为消息。
  // 只在**内容变化时追加一份完整替换**（旧版本留在历史里，模型按"以最新一块为准"理解）——
  // 于是"改自己的工作区文档"的代价从"整段重放"变成"尾部追加"。
  let lastWorkspaceHash: string | null = null;
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async () => {
      try {
        const wi = collectWorkspaceInstructions({ cwd: process.cwd(), agentDir: getAgentDir() });
        if (!wi.text || wi.hash === lastWorkspaceHash) return;
        lastWorkspaceHash = wi.hash;
        return {
          message: {
            customType: 'my-pi-workspace-instructions',
            content: wi.text,
            display: false,
          },
        };
      } catch {
        /* 读不到工作区指令不阻塞本轮 */
      }
    },
  });

  // 工具调用开始：记录时间（Pi 的 tool_call 事件，见 hook-adapter 事件名说明）
  registerHook(pi, {
    event: 'tool_call',
    handler: async (event) => {
      const toolEvent = event as { toolName?: string; toolCallId?: string; input?: Record<string, unknown> };
      // 用 toolCallId 计时：pi 默认并行执行工具，同一工具一轮多次调用时按名字键会互相覆盖（时长失真）
      const callKey = toolEvent.toolCallId ?? toolEvent.toolName;
      if (callKey) {
        toolState.toolCallStarts.set(callKey, Date.now());
      }
      // ── bash 前台默认上限（硬约束，2026-10-01）──
      // 按工具拆解 1101 个可归属步：工具执行占墙钟 63.6%，其中 `bash` 一家占工具时间 63%
      // ——p50 440ms、p90 36.4s、**p99 164s**（pi 的 bash 默认无超时）。对照之下前缀重放只占
      // 请求处理时间的 0.5%（拟合 0.0085ms/未命中 token）→ 顿挫感来自前台长命令，不是缓存。
      // "长任务后台化"写在 AGENTS.md 里是软提示、显然没被稳定遵守，故按 VISION §3.2（硬优先）
      // 落到代码：模型未显式给 `timeout` 时注入上限，超时即中断并在结果里给出改法；
      // 显式写了 timeout 的调用**原样尊重**（那是有意为之的放宽）。
      if (toolEvent.toolName === 'bash' && toolEvent.input && typeof toolEvent.input === 'object') {
        const given = toolEvent.input.timeout;
        const explicit = typeof given === 'number' && Number.isFinite(given) && given > 0;
        // 必须**原地**改 pi 传进来的同一个 args 对象：`BeforeToolCallResult` 只有
        // block/reason/terminate，没有覆盖 args 的字段（vendor/pi/packages/agent/src/types.ts），
        // 而 agent-loop 传的就是 `args: validatedArgs`、随后以同一个对象执行
        // （vendor/pi/packages/agent/src/agent-loop.ts 的 prepareToolCall）。改成"复制再改"
        // 会让这条硬约束静默失效（用例见 __tests__/bash-timeout.test.ts）。
        if (!explicit) toolEvent.input.timeout = BASH_TIMEOUT_CEIL_S;
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
      // 旧摘要去重**默认关闭**（PI_CONTEXT_DEDUP_SUMMARIES=on 打开）：它是当前唯一默认开启的
      // 删历史动作，而被删的摘要位置通常靠前 → 从该点起整段前缀重放（一次全价）。
      // 保留它每轮只花它自己的 token（cacheRead 价 ≈ 全价的 1/50），盈亏平衡要上千轮。
      // 见 budget/task-gate.ts 的成本模型；残留的旧摘要由模型按「以最新一块为准」理解。
      if (
        DEDUP_SUMMARIES &&
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
          // 诊断事件接线（P4 第三批）：/usage-diag 的"分层擦除"一节消费 prune/prune-think 事件，
          // 但生产者自 2026-09-24 起被断开（摘要恒显示 0 次）——这里恢复写入。
          recordPrune(pruned.prunedTokens, pruned.prunedChars, pruned.prunedCount, 'tool');
        }

        // 历史 thinking 块按 token 预算擦除。实测长会话中 thinking 可占上下文 ~50%
        // （10 小时会话：155K/310K）。注意：擦除点在会话前部，代价是其后全量缓存失效。
        const thinkTrimmed = pruneThinkingBudget(working as PruneMessage[], KEEP_THINKING_TOKENS);
        if (thinkTrimmed.modified) {
          working = thinkTrimmed.messages as unknown[];
          modified = true;
          recordPrune(thinkTrimmed.prunedTokens, thinkTrimmed.prunedChars, thinkTrimmed.prunedCount, 'thinking');
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
        toolCallId?: string;
        input?: Record<string, unknown>;
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
      const callKey = e.toolCallId ?? name;
      const start = toolState.toolCallStarts.get(callKey);
      toolState.toolCallStarts.delete(callKey);
      toolState.runToolCount++;
      if (text) recordToolUsage(name, estimateTokens(text));
      // bash 命令形态（P4 第三批）：把 APPEND_SYSTEM.md 的"合并独立检查"软规则变成可观测指标。
      // tool_result 事件自带原始 input（见 pi `ToolResultEvent`），故无需配对表。
      const bashCmd = name === 'bash' && typeof e.input?.command === 'string' ? (e.input.command as string) : undefined;
      const bashInfo = bashCmd !== undefined ? analyzeBashCommand(bashCmd) : undefined;
      // 度量：记录 token/缓存（用量统计度量基建；无 usage 时以输出估算兜底）
      // provider 未返回 usage 时记一条 usage-missing（/usage-diag 会显示它，用于判断"命中率是否可信"）
      if (!e.usage) recordUsageMissing();
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
          ...(bashInfo ? { merged: bashInfo.merged, segments: bashInfo.segments } : {}),
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
      // 诊断事件接线（同上）：/usage-diag 的"自动压缩触发"一节消费 auto-compact 事件
      recordAutoCompact(resolved.tokens, decision.threshold);
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
        if (fingerprintEnabled) recordFingerprint(replayed ?? payload, ctx as never);
        return replayed ?? undefined;
      }
      saveMainRequestPayload(warmState, modelKey, payload.messages, payload.tools);
      if (fingerprintEnabled) recordFingerprint(payload, ctx as never);
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
