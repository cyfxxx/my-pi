/**
 * Subagent Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/subagent/index.ts`。
 * 工具 `subagent`：single / parallel / chain 三种模式，子进程隔离上下文。
 * 未迁移（后续）：TUI renderCall/renderResult（rendering.ts）。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
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

export function register(pi: ExtensionAPI): void {
  registerTool(pi, {
    name: 'subagent',
    description:
      '将任务委派给隔离子代理（独立上下文窗口）。模式：single（task，可选 agent）、parallel（tasks 数组）、chain（顺序步骤，用 {previous} 引用上一步输出）。可用 agent: scout/worker/reviewer。',
    parameters: {
      agent: { type: 'string', description: 'single 模式的 agent 名（可选，默认通用）', optional: true },
      task: { type: 'string', description: 'single 模式的任务', optional: true },
      tasks: { type: 'json', description: 'parallel：[{agent, task, cwd?}] 数组', optional: true },
      chain: { type: 'json', description: 'chain：[{agent, task, cwd?}] 数组，task 可含 {previous}', optional: true },
      agentScope: { type: 'string', enum: ['user', 'project', 'both'], description: 'agent 目录范围，默认 user', optional: true },
      cwd: { type: 'string', description: 'single 模式工作目录', optional: true },
    },
    execute: async (raw) => {
      const params = raw as unknown as SubagentToolParams;
      const cwd = process.cwd();
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
          const result = await runSingleAgent(cwd, agents, step.agent, taskWithContext, step.cwd, i + 1, undefined, undefined, makeDetails('chain'));
          results.push(result);
          if (isFailedResult(result)) {
            return `Chain stopped at step ${i + 1} (${step.agent ?? 'default'}): ${getResultOutput(result)}`;
          }
          previousOutput = getFinalOutput(result.messages);
        }
        return truncateParallelOutput(getFinalOutput(results[results.length - 1].messages) || '(no output)');
      }

      if (params.tasks && params.tasks.length > 0) {
        if (params.tasks.length > getMaxParallelTasks()) {
          return `Too many parallel tasks (${params.tasks.length}). Max is ${getMaxParallelTasks()}${isTermuxEnv() ? ' (Termux 环境限制)' : ''}.`;
        }
        const results = await mapWithConcurrencyLimit(params.tasks, getMaxConcurrency(false), async (t, _index, internalSignal) =>
          runSingleAgent(cwd, agents, t.agent, t.task, t.cwd, undefined, internalSignal, undefined, makeDetails('parallel')),
        );
        const successCount = results.filter((r) => !isFailedResult(r)).length;
        const summaries = results.map((r) => {
          const output = truncateParallelOutput(getResultOutput(r));
          const status = isFailedResult(r) ? `failed${r.stopReason && r.stopReason !== 'end' ? ` (${r.stopReason})` : ''}` : 'completed';
          return `### [${r.agent}] ${status}\n\n${output}`;
        });
        return `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join('\n\n---\n\n')}`;
      }

      if (params.agent && params.task) {
        const riskLevel = classifyTaskRisk(params.task);
        const riskHint = riskLevel !== '1σ' ? ` [risk=${riskLevel}]` : '';
        const result = await runSingleAgent(cwd, agents, params.agent, params.task, params.cwd, undefined, undefined, undefined, makeDetails('single'));
        if (isFailedResult(result)) {
          return `Agent ${result.stopReason || 'failed'}${riskHint}: ${getResultOutput(result)}`;
        }
        return `${riskHint ? riskHint + ' ' : ''}${truncateParallelOutput(getFinalOutput(result.messages) || '(no output)')}`;
      }

      const available = agents.map((a: AgentConfig) => `${a.name} (${a.source})`).join(', ') || 'none';
      return `Invalid parameters. Available agents: ${available}`;
    },
  });

  // 会话开始提示可用 agent
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
