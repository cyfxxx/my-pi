/**
 * Plan Mode Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责计划模式
 */

export interface PlanState {
  active: boolean;
  plan: string[];
  currentStep: number;
}

// ── 计划管理 ──

export function createPlanState(): PlanState {
  return {
    active: false,
    plan: [],
    currentStep: 0,
  };
}

export function startPlan(state: PlanState, plan: string[]): void {
  state.active = true;
  state.plan = plan;
  state.currentStep = 0;
}

export function nextStep(state: PlanState): string | undefined {
  if (state.currentStep < state.plan.length - 1) {
    state.currentStep++;
    return state.plan[state.currentStep];
  }
  return undefined;
}

export function completePlan(state: PlanState): void {
  state.active = false;
  state.plan = [];
  state.currentStep = 0;
}

// ── 选择器 ──

export function selectCurrentStep(state: PlanState): string | undefined {
  if (state.plan.length === 0) return undefined;
  return state.plan[state.currentStep];
}