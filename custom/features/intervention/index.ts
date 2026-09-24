/**
 * Intervention Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-intervention/index.ts`（VISION P1）。
 *
 * 数据流：
 *   before_agent_start    记录用户意图；若上一条 abort 在 15min 关联窗内则回填 correctivePrompt
 *   tool_execution_start  追踪本轮工具轨迹（名称 + 参数摘要，上限 20）
 *   input                 捕获 steer 输入（运行中用户插入的纠正指令，上限 3）
 *   agent_end             stopReason==="aborted" 时落盘快照
 *
 * 可靠性：所有 handler 静默容错，绝不影响宿主会话。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { checkToolCall } from './shadow-review';
import { registerCommand } from '../../adapters/ui-adapter';
import { parseSubcommand, filterCompletions } from '../../core/cli';
import {
  CORRECTIVE_WINDOW_MS,
  TOOL_BRIEF_TRUNC,
  TOOLS_TRACK_MAX,
  STEERING_MAX,
  STEERING_TRUNC,
  resolveInterventionsFile,
  trunc,
  oneLine,
  extractAssistantTail,
  isAbortedEnd,
  buildRecord,
  readLines,
  appendRecord,
  linkCorrective,
  summarize,
} from './logic';
import type { RunState } from './logic';

export function register(pi: ExtensionAPI): void {
  const file = resolveInterventionsFile();
  let currentRun: RunState | null = null;
  let lastSteering: string[] = [];
  let lastAborted: { id: string; ts: number } | null = null;

  registerHook(pi, {
    event: 'before_agent_start',
    handler: async (event) => {
      try {
        const e = event as { prompt?: string };
        if (lastAborted && Date.now() - lastAborted.ts <= CORRECTIVE_WINDOW_MS) {
          linkCorrective(file, lastAborted.id, e.prompt ?? '');
        }
        currentRun = { prompt: e.prompt ?? '', startedAt: Date.now(), tools: [] };
        lastSteering = [];
      } catch {
        /* 静默 */
      }
    },
  });

  registerHook(pi, {
    event: 'tool_execution_start',
    handler: async (event) => {
      try {
        if (!currentRun) return;
        const e = event as { toolName?: string; args?: unknown };
        currentRun.tools.push({
          name: e.toolName ?? 'unknown',
          brief: trunc(oneLine(e.args), TOOL_BRIEF_TRUNC),
        });
        // 影子审查：确定性规则静默记录（checkToolCall 内部落盘；只记录、不拦截、不进入上下文）
        if (e.toolName && e.args && typeof e.args === 'object') {
          checkToolCall(e.toolName, e.args as Record<string, unknown>);
        }
        if (currentRun.tools.length > TOOLS_TRACK_MAX) {
          currentRun.tools = currentRun.tools.slice(-TOOLS_TRACK_MAX);
        }
      } catch {
        /* 静默 */
      }
    },
  });

  registerHook(pi, {
    event: 'input',
    handler: async (event) => {
      try {
        const e = event as { streamingBehavior?: string; text?: string };
        if (e.streamingBehavior === 'steer' && e.text) {
          lastSteering.push(trunc(e.text, STEERING_TRUNC));
          if (lastSteering.length > STEERING_MAX) lastSteering = lastSteering.slice(-STEERING_MAX);
        }
      } catch {
        /* 静默 */
      }
    },
  });

  registerHook(pi, {
    event: 'agent_end',
    handler: async (event) => {
      try {
        const e = event as { messages?: unknown };
        if (!isAbortedEnd(e.messages) || !currentRun) return;
        const record = buildRecord({
          prompt: currentRun.prompt,
          tools: currentRun.tools,
          tail: extractAssistantTail(e.messages),
          steering: lastSteering,
        });
        appendRecord(file, record);
        lastAborted = { id: record.id, ts: Date.now() };
        currentRun = null;
        lastSteering = [];
      } catch {
        /* 静默 */
      }
    },
  });

  registerCommand(pi, 'intervention', {
    description: '干预捕获：中断快照与统计',
    getArgumentCompletions: (prefix) => {
      const first = parseSubcommand(prefix).sub;
      const items = [
        { value: 'recent', label: 'recent', description: '最近 N 条中断快照（默认 5）' },
        { value: 'stats', label: 'stats', description: '累计统计（总数/关联率/近7天）' },
        { value: 'help', label: 'help', description: '显示用法' },
      ];
      return filterCompletions(items, first);
    },
    handler: async (args, ctx) => {
      const { sub, rest } = parseSubcommand(args);
      const records = readLines(file);

      if (sub === 'recent' || sub === undefined || sub === '') {
        const n = Math.min(Math.max(parseInt(rest[0] ?? '5', 10) || 5, 1), 50);
        const recent = records.slice(-n).reverse();
        if (!recent.length) {
          ctx.ui.notify('暂无中断快照记录。', 'info');
          return;
        }
        const lines = recent.map((r) => {
          const corr = r.correctivePrompt ? ` →纠正: ${trunc(r.correctivePrompt, 80)}` : ' →(未关联)';
          return `[${r.ts}] ${trunc(r.prompt, 100)}\n  工具: ${r.tools.join(', ') || '无'}${corr}`;
        });
        ctx.ui.notify(lines.join('\n\n'), 'info');
        return;
      }

      if (sub === 'stats') {
        const s = summarize(records);
        ctx.ui.notify(
          [
            `中断快照总数: ${s.total}`,
            `已关联纠正意图: ${s.corrected}${s.total ? ` (${Math.round((s.corrected / s.total) * 100)}%)` : ''}`,
            `含 steering 纠正: ${s.withSteering}`,
            `近 7 天: ${s.lastWeek}`,
            `数据文件: ${file}`,
          ].join('\n'),
          'info',
        );
        return;
      }

      ctx.ui.notify(
        ['/intervention recent [N]   最近 N 条中断快照（默认 5）', '/intervention stats        累计统计', '/intervention help         本帮助'].join('\n'),
        'info',
      );
    },
  });
}
