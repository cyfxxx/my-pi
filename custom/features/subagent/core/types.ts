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
}

export interface SubagentDetails {
  mode: 'single' | 'parallel' | 'chain';
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  results: SingleResult[];
}

export type OnUpdateCallback = (partial: { content: { type: 'text'; text: string }[]; details: SubagentDetails }) => void;

export type RiskLevel = '1σ' | '2σ' | '3σ';

export interface SubagentToolParams {
  agent?: string;
  task?: string;
  tasks?: { agent?: string; task: string; cwd?: string }[];
  chain?: { agent?: string; task: string; cwd?: string }[];
  agentScope?: AgentScope;
  cwd?: string;
}
