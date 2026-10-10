/**
 * Subagent Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/subagent/index.ts`。
 * 工具 `subagent`：single / parallel / chain 三种模式，子进程隔离上下文。
 * 已含 TUI renderCall/renderResult（rendering.ts）。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { getRpcPool } from './core/rpc-pool';
import { registerTool } from '../../adapters/tool-adapter';
import {
  discoverAgents,
  runSingleAgent,
  isTermuxEnv,
  getMaxParallelTasks,
  getMaxConcurrency,
  isLocalProvider,
  classifyTaskRisk,
  applyPreviousPlaceholder,
  truncateParallelOutput,
  mapWithConcurrencyLimit,
  getFinalOutput,
  isFailedResult,
  getResultOutput,
} from './logic';
import type { AgentConfig, AgentScope, SingleResult, SubagentDetails, SubagentToolParams } from './logic';
import { renderSingleResult, renderChainResult, renderParallelResult } from './ui/rendering';
import { Text } from '../../adapters/ui-adapter';
import { taskPreview, agentLabel } from './logic';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '../../core/config';

interface ThemeLike {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
}

/** 判断当前是否本地推理（决定并发上限）：优先会话实时 provider，回退 settings.json 默认 */
function currentProviderIsLocal(sessionProvider?: string): boolean {
  if (sessionProvider) return isLocalProvider(sessionProvider);
  try {
    const raw = JSON.parse(readFileSync(join(getAgentDir(), 'settings.json'), 'utf-8')) as { defaultProvider?: string };
    return isLocalProvider(raw.defaultProvider);
  } catch {
    return false;
  }
}

export function register(pi: ExtensionAPI): void {
  registerTool(pi, {
    name: 'subagent',
    description:
      '将任务委派给隔离子代理（独立上下文窗口）。模式：single（task，可选 agent）、parallel（tasks 数组）、chain（顺序步骤，用 {previous} 引用上一步输出）。可用 agent: scout/worker/reviewer。子代理默认继承主会话模型；可用 model 参数（provider/model 或 provider/id）为本次调用或单个任务指定模型。',
    parameters: {
      agent: { type: 'string', description: 'single 模式的 agent 名（可选，默认通用）', optional: true },
      task: { type: 'string', description: 'single 模式的任务', optional: true },
      tasks: {
        type: 'json',
        description: 'parallel：[{agent, task, cwd?, model?}] 数组',
        optional: true,
      },
      chain: {
        type: 'json',
        description: 'chain：[{agent, task, cwd?, model?}] 数组，task 可含 {previous}',
        optional: true,
      },
      agentScope: { type: 'string', enum: ['user', 'project', 'both'], description: 'agent 目录范围，默认 user', optional: true },
      extensions: {
        type: 'boolean',
        description:
          '本次调用是否让子代理加载 my-pi 扩展（memory/todo/tmux 等）。**默认关闭**；开启后子代理能改状态，请只在确实需要时开启。定时任务派生的子代理始终不加载扩展。',
        optional: true,
      },
      model: {
        type: 'string',
        description: '本次调用的默认模型（provider/model 或 provider/id）；单个 task/chain 项的 model 优先于此',
        optional: true,
      },
      inboxId: {
        type: 'string',
        description: '收件箱 id（可选）：不传则自动取 <agent>#<序号>；agent 名始终可投递；tasks/chain 单项可覆盖',
        optional: true,
      },
      context: {
        type: 'string',
        enum: ['spawn', 'fork'],
        description:
          '会话上下文模式（默认 spawn）：spawn=空上下文（最便宜的一次请求）；fork=继承父会话历史——父会话刚发过请求时那段前缀是暖的，首请求按 cacheRead 计价（约全价 1/50），适合"需要父上下文的短任务"，紧接父会话使用时最划算。',
        optional: true,
      },
    },
    execute: async (raw, ctx) => {
      const params = raw as unknown as SubagentToolParams;
      const currentModel = ctx?.model;
      // fork 需要父会话文件；拿不到（headless/无会话）时静默退回 spawn（不报错，只是没有父上下文）
      const forkSession = params.context === 'fork' ? ctx?.sessionFile : undefined;
      // 派它的父会话：返工指标据此把「父级是否又改同一文件」限定在真正的父会话里
      const parentSession = ctx?.sessionFile;
      // 逐次 opt-in、默认关闭（见 runner.ts 的 buildPooledSpawnArgs 注释）
      const allowExtensions = params.extensions === true;
      const cwd = ctx?.cwd ?? process.cwd();
      const agentScope: AgentScope = params.agentScope ?? 'user';
      const discovery = discoverAgents(cwd, agentScope);
      const agents = discovery.agents;
      const makeDetails =
        (mode: 'single' | 'parallel' | 'chain') =>
        (results: SingleResult[]): SubagentDetails => ({
          mode,
          agentScope,
          projectAgentsDir: discovery.projectAgentsDir,
          results,
        });

      // 把"可投递的收件箱 id"直接给调用方（可发现性：本会话曾因只能靠猜 id 而投错箱 ✗）
      const inboxNote = (results: SingleResult[]): string => {
        const withIds = results.filter((r) => (r.inboxIds?.length ?? 0) > 0);
        if (withIds.length === 0) return '';
        const lines = withIds.map((r) => `${r.agent}: ${(r.inboxIds ?? []).join(' | ')}`);
        return (
          `\n\n[收件箱] ${lines.join('; ')}` +
          `\n中途投递：node scripts/subagent-inbox.mjs post "<id>" "<追加指令>"（运行级 id = <agent>#<序号>，可预测）`
        );
      };

      const hasChain = (params.chain?.length ?? 0) > 0;
      const hasTasks = (params.tasks?.length ?? 0) > 0;
      const hasSingle = Boolean(params.task);
      const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
      if (modeCount !== 1) {
        return 'Invalid parameters. Provide exactly one mode: single (task, optional agent), parallel (tasks array) or chain (chain array).';
      }

      if (params.chain && params.chain.length > 0) {
        const results: SingleResult[] = [];
        let previousOutput = '';
        for (let i = 0; i < params.chain.length; i++) {
          const step = params.chain[i];
          const taskWithContext = applyPreviousPlaceholder(step.task ?? '', previousOutput);
          const result = await runSingleAgent(cwd, agents, step.agent, taskWithContext, step.cwd, i + 1, undefined, undefined, makeDetails('chain'), currentModel, step.model ?? params.model, forkSession, allowExtensions, parentSession, step.inboxId ?? params.inboxId ?? `${step.agent ?? 'default'}#${i + 1}`);
          results.push(result);
          if (isFailedResult(result)) {
            return `Chain stopped at step ${i + 1} (${step.agent ?? 'default'}): ${getResultOutput(result)}`;
          }
          previousOutput = getFinalOutput(result.messages);
        }
        return truncateParallelOutput(getFinalOutput(results[results.length - 1].messages) || '(no output)') + inboxNote(results);
      }

      if (params.tasks && params.tasks.length > 0) {
        if (params.tasks.length > getMaxParallelTasks()) {
          return `Too many parallel tasks (${params.tasks.length}). Max is ${getMaxParallelTasks()}${isTermuxEnv() ? ' (Termux 环境限制)' : ''}.`;
        }
        const results = await mapWithConcurrencyLimit(params.tasks, getMaxConcurrency(currentProviderIsLocal(currentModel?.provider)), async (t, _index, internalSignal) =>
          runSingleAgent(cwd, agents, t.agent, t.task, t.cwd, undefined, internalSignal, undefined, makeDetails('parallel'), currentModel, t.model ?? params.model, forkSession, allowExtensions, parentSession, t.inboxId ?? params.inboxId ?? `${t.agent ?? 'default'}#${_index + 1}`),
        );
        const successCount = results.filter((r) => !isFailedResult(r)).length;
        const summaries = results.map((r) => {
          const output = truncateParallelOutput(getResultOutput(r));
          const status = isFailedResult(r) ? `failed${r.stopReason && r.stopReason !== 'end' ? ` (${r.stopReason})` : ''}` : 'completed';
          return `### [${r.agent}] ${status}\n\n${output}`;
        });
        return `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join('\n\n---\n\n')}` + inboxNote(results);
      }

      if (params.task) {
        const riskLevel = classifyTaskRisk(params.task);
        const riskHint = riskLevel !== '1σ' ? ` [risk=${riskLevel}]` : '';
        const result = await runSingleAgent(cwd, agents, params.agent, params.task, params.cwd, undefined, undefined, undefined, makeDetails('single'), currentModel, params.model, forkSession, allowExtensions, parentSession, params.inboxId ?? `${params.agent ?? 'default'}#1`);
        if (isFailedResult(result)) {
          return `Agent ${result.stopReason || 'failed'}${riskHint}: ${getResultOutput(result)}`;
        }
        return `${riskHint ? riskHint + ' ' : ''}${truncateParallelOutput(getFinalOutput(result.messages) || '(no output)')}` + inboxNote([result]);
      }

      const available = agents.map((a: AgentConfig) => `${a.name} (${a.source})`).join(', ') || 'none';
      return `Invalid parameters. Available agents: ${available}`;
    },
    renderCall: (rawArgs, theme) => {
      const args = rawArgs as SubagentToolParams;
      const t = theme as ThemeLike;
      const scope: AgentScope = args.agentScope ?? 'user';
      if (args.chain && args.chain.length > 0) {
        let text = t.fg('toolTitle', t.bold('subagent ')) + t.fg('accent', `chain (${args.chain.length} steps)`) + t.fg('muted', ` [${scope}]`);
        for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
          const step = args.chain[i];
          text += `\n  ${t.fg('muted', `${i + 1}.`)} ${t.fg('accent', agentLabel(step.agent))}${t.fg('dim', ` ${taskPreview(step.task)}`)}`;
        }
        if (args.chain.length > 3) text += `\n  ${t.fg('muted', `... +${args.chain.length - 3} more`)}`;
        return new Text(text, 0, 0);
      }
      if (args.tasks && args.tasks.length > 0) {
        let text = t.fg('toolTitle', t.bold('subagent ')) + t.fg('accent', `parallel (${args.tasks.length} tasks)`) + t.fg('muted', ` [${scope}]`);
        for (const task of args.tasks.slice(0, 3)) text += `\n  ${t.fg('accent', agentLabel(task.agent))}${t.fg('dim', ` ${taskPreview(task.task)}`)}`;
        if (args.tasks.length > 3) text += `\n  ${t.fg('muted', `... +${args.tasks.length - 3} more`)}`;
        return new Text(text, 0, 0);
      }
      const agentName = args.agent || '...';
      const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : '...';
      return new Text(t.fg('toolTitle', t.bold('subagent ')) + t.fg('accent', agentName) + t.fg('muted', ` [${scope}]`) + `\n  ${t.fg('dim', preview)}`, 0, 0);
    },
    renderResult: (result, options, theme) => {
      const details = result.details as SubagentDetails | undefined;
      const t = theme as ThemeLike;
      const first = result.content[0];
      const fallback = first?.type === 'text' && first.text ? first.text : '(no output)';
      if (!details || details.results.length === 0) return new Text(fallback, 0, 0);
      if (details.mode === 'single' && details.results.length === 1) return renderSingleResult(details.results[0], Boolean(options.expanded), t);
      if (details.mode === 'chain') return renderChainResult(details, Boolean(options.expanded), t);
      if (details.mode === 'parallel') return renderParallelResult(details, Boolean(options.expanded), t);
      return new Text(fallback, 0, 0);
    },
  });

  // 会话开始提示可用 agent
  // 常驻池的进程必须在会话结束时回收，否则会泄漏（S3）
  registerHook(pi, {
    event: 'session_shutdown',
    handler: async () => {
      getRpcPool().shutdown();
    },
  });

  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      const { agents } = discoverAgents(process.cwd(), 'user');
      if (agents.length > 0 && ctx.hasUI) {
        ctx.ui.notify(`子代理可用: ${agents.map((a) => a.name).join(', ')}`, 'info');
      }
    },
  });
}
