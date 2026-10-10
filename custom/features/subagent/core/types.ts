/**
 * Subagent Feature — 类型（纯类型，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/subagent/types.ts`（去除 pi-ai/pi-agent-core 依赖）。
 */

import type { AgentScope } from './agents';

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface SingleResult {
  agent: string;
  agentSource: 'user' | 'project' | 'unknown';
  task: string;
  exitCode: number;
  messages: unknown[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  step?: number;
  /**
   * **派它的父会话文件**（来源 `ctx.sessionFile`；池化路径的 worker 自己是 `--no-session`，
   * 所以这个字段记的是「谁派了它」）。
   *
   * 用途：返工指标必须知道去**哪个会话**里找「父级是否又改了同一文件」——
   * 否则另一个并发会话改了同一文件会被误算成返工。
   */
  parentSession?: string;
  /**
   * 本次运行可投递的收件箱 id（**运行级在前、agent 名在后**）。
   * 运行级 id 形如 `<agent>#<序号>`（**可预测**：调用方不必等结果就能投递 ✓）；agent 名保留 ⇒ **向后兼容** ✓。
   * 两者各有独立已读偏移 ⇒ 并行运行互不串箱 ✓。
   */
  inboxIds?: string[];
}

export interface SubagentDetails {
  mode: 'single' | 'parallel' | 'chain';
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  results: SingleResult[];
}

export type OnUpdateCallback = (partial: { content: { type: 'text'; text: string }[]; details: SubagentDetails }) => void;

export type RiskLevel = '1σ' | '2σ' | '3σ';

export interface SubagentTaskItem {
  agent?: string;
  task: string;
  cwd?: string;
  /** 该子任务的收件箱 id（覆盖调用级 inboxId）；不传则自动取 `<agent>#<序号>` */
  inboxId?: string;
  /** 本次子任务显式使用的模型（provider/model 或 provider/id），覆盖 agent/会话默认 */
  model?: string;
}

export interface SubagentToolParams {
  agent?: string;
  task?: string;
  tasks?: SubagentTaskItem[];
  chain?: SubagentTaskItem[];
  agentScope?: AgentScope;
  cwd?: string;
  /** 单次调用默认模型；tasks/chain 项的 model 优先级更高 */
  model?: string;
  /**
   * 会话上下文模式（默认 `spawn`）：
   *   `spawn` = `--no-session`，子代理只有 system+工具+任务（最便宜的一次请求）；
   *   `fork`  = `--fork <父会话>`，继承父会话历史——紧接父会话请求时前缀是暖的，按 cacheRead 计价。
   */
  context?: 'spawn' | 'fork';
  /**
   * 是否让子代理加载 my-pi 扩展（memory/todo/tmux 等）。**逐次 opt-in，默认关闭**。
   *
   * 默认关闭不是"省事"：`scripts/check-seeds-headless.mjs` 整套守门建立在"定时任务以
   * `--no-extensions` 运行"这个前提上，而 `schedule_task` 有 `useSubagent` 选项。默认关闭让
   * "定时任务派生的子代理"天然仍是裸 pi，前提不被破坏；开启后子代理**能改状态**，属于显式承担风险。
   */
  extensions?: boolean;
  /**
   * 本次调用的默认收件箱 id（**可选**）。不传时每次运行自动取 `<agent>#<序号>`；
   * 无论传不传，**agent 名这条通道始终保留**（向后兼容 + 便于"给某角色的所有运行发"）。
   *
   * 并行/链式可在 `tasks[]`/`chain[]` 的单项里用 `inboxId` 覆盖（不改顶层 schema）。
   */
  inboxId?: string;
}
