/**
 * Autopilot Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责自动驾驶功能
 */

export interface AutopilotConfig {
  enabled: boolean;
  mode: 'suggest' | 'auto' | 'full-auto';
  maxSteps: number;
  budget: number;
}

export interface AutopilotState {
  active: boolean;
  step: number;
  maxSteps: number;
  budgetUsed: number;
  budgetLimit: number;
  results: string[];
}

// ── 配置管理 ──

export function createAutopilotConfig(): AutopilotConfig {
  return {
    enabled: true,
    mode: 'suggest',
    maxSteps: 10,
    budget: 1000,
  };
}

// ── 状态管理 ──

export function createAutopilotState(): AutopilotState {
  return {
    active: false,
    step: 0,
    maxSteps: 10,
    budgetUsed: 0,
    budgetLimit: 1000,
    results: [],
  };
}

// ── 预算检查 ──

export function checkBudget(state: AutopilotState): boolean {
  return state.budgetUsed < state.budgetLimit;
}

export function consumeBudget(state: AutopilotState, amount: number): boolean {
  if (state.budgetUsed + amount > state.budgetLimit) return false;
  state.budgetUsed += amount;
  return true;
}

// ── 步骤管理 ──

export function canContinue(state: AutopilotState): boolean {
  return state.active && state.step < state.maxSteps && checkBudget(state);
}

export function nextStep(state: AutopilotState): number {
  state.step++;
  return state.step;
}

export function completeAutopilot(state: AutopilotState, result: string): void {
  state.active = false;
  state.results.push(result);
}

// ── 结果管理 ──

export function addResult(state: AutopilotState, result: string): void {
  state.results.push(result);
}

export function getResults(state: AutopilotState): string[] {
  return [...state.results];
}

export function clearResults(state: AutopilotState): void {
  state.results = [];
}