/**
 * Subagent Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责子代理管理
 */

export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
}

export interface SubagentState {
  active: boolean;
  currentAgent: string | null;
  results: Record<string, unknown>;
}

// ── 代理管理 ──

export function createSubagentState(): SubagentState {
  return {
    active: false,
    currentAgent: null,
    results: {},
  };
}

export function registerAgent(state: SubagentState, config: AgentConfig): void {
  state.results[config.name] = config;
}

export function spawnAgent(state: SubagentState, agentName: string): boolean {
  if (!state.results[agentName]) return false;
  state.active = true;
  state.currentAgent = agentName;
  return true;
}

export function completeAgent(state: SubagentState, result: unknown): void {
  if (state.currentAgent) {
    state.results[state.currentAgent] = result;
  }
  state.active = false;
  state.currentAgent = null;
}

// ── 代理列表 ──

export function listAgents(state: SubagentState): string[] {
  return Object.keys(state.results);
}