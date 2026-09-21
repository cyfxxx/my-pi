/**
 * Context Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责上下文管理、工具生命周期、消息过滤等
 */

// ── 工具生命周期状态 ──

export interface ToolLifecycleState {
  toolCallStarts: Map<string, number>;
  failStreak: Map<string, number>;
  runToolCount: number;
  lastToolRecomputeTs: number;
}

export function createToolLifecycleState(): ToolLifecycleState {
  return {
    toolCallStarts: new Map(),
    failStreak: new Map(),
    runToolCount: 0,
    lastToolRecomputeTs: 0,
  };
}

// ── 消息过滤状态 ──

export interface MessageFilterState {
  lastCompactionTs: number;
  compactCount: number;
}

export function createMessageFilterState(): MessageFilterState {
  return {
    lastCompactionTs: 0,
    compactCount: 0,
  };
}

// ── 自动压缩状态 ──

export interface AutoCompactState {
  lastCompactTs: number;
  compactCount: number;
  isCompacting: boolean;
}

export function createAutoCompactState(): AutoCompactState {
  return {
    lastCompactTs: 0,
    compactCount: 0,
    isCompacting: false,
  };
}

// ── 暖前缀状态 ──

export interface WarmPrefixState {
  lastModelKey: string;
  prefixReplayed: boolean;
}

export function createWarmPrefixState(): WarmPrefixState {
  return {
    lastModelKey: '',
    prefixReplayed: false,
  };
}

// ── 工具截断 ──

export function truncateToolContent(content: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(content).length;
  if (bytes <= maxBytes) return content;
  
  // 按比例截断
  const ratio = maxBytes / bytes;
  const truncatedLength = Math.floor(content.length * ratio * 0.9); // 留 10% 余量
  return content.slice(0, truncatedLength) + '\n... (truncated)';
}

// ── 失败 streak 更新 ──

export function updateFailStreak(
  state: ToolLifecycleState,
  toolName: string,
  isError: boolean,
): void {
  if (isError) {
    state.failStreak.set(toolName, (state.failStreak.get(toolName) || 0) + 1);
  } else {
    state.failStreak.delete(toolName);
  }
}

// ── 工具调用记录 ──

export function recordToolCall(
  state: ToolLifecycleState,
  toolName: string,
  content: unknown,
  maxBytes: number,
): void {
  state.runToolCount++;
  state.lastToolRecomputeTs = Date.now();
  state.toolCallStarts.set(toolName, Date.now());
}

// ── 效率建议 ──

export const EFFICIENCY_ADVICE = '效率建议：使用更具体的工具调用可以提高响应速度。';
export const LOW_PRESSURE_DELEGATION = '低压力委派：将简单任务委派给子代理可以提高效率。';
export const FULL_DELEGATION_ADVICE = '完全委派建议：对于重复性任务，考虑使用自动化脚本。';

// ── 迁移自 pi-tools 的 token 预算模块（纯逻辑） ──
export * from './budget/budget';
export * from './budget/output-archive';
