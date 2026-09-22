/**
 * thinking 档位自适应切档（迁移自 pi-tools `pi-context/thinking-level.ts`）
 *
 * 背景：thinking 档位决定每轮思考 token 预算，与缓存命中/剪枝断裂强相关。
 *   - 降挡：上下文持续 critical（真实窗口比例≥90%）→ 降一档，省 token 并降低
 *     thinking 剪枝（A 类断裂）概率。
 *   - 升回：压力回落 low（ratio<70%）且连续稳定 → 升一档，最高回到本会话基准档位。
 *   - 防抖：切换后死区窗口内不再次切换。
 * 比例分母为真实上下文窗口（getContextUsage().contextWindow），不对齐压缩阈值。
 *
 * 记账：每次切换追加 JSONL（`portable/memory/logs/level-changes.jsonl`，可用
 * `PI_LEVEL_CHANGE_FILE` 覆盖；`PI_DISABLE_LEVEL_AUDIT=1` 关闭）。档位是运行时
 * provider 设置、不进注入面，切换不额外破坏缓存前缀。
 */

import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';
import { appendJSONL, readJSONL } from '../../../core/fs-json';
import { getBudgetReport } from './budget';

// ── 任务类型推断（用于 thinking 档位自适应） ──
export type TaskType = 'explore' | 'code' | 'review' | 'other';

export function inferTaskType(task: string): TaskType {
  const lower = task.toLowerCase();
  if (/\bexplore|search|find|grep|discover|investigate\b/.test(lower)) return 'explore';
  if (/\breview|audit|check|analyze|verify\b/.test(lower)) return 'review';
  if (/\bwrite|edit|implement|fix|refactor|create|build\b/.test(lower)) return 'code';
  return 'other';
}

/** 自动控制使用的档位阶梯（下限保护 = low，不落到 minimal/off） */
export const LEVEL_LADDER = ['low', 'medium', 'high'] as const;
export type AutoThinkLevel = (typeof LEVEL_LADDER)[number];

/** 压力阈值：ratio>=CRITICAL_RATIO 降挡；ratio<LOW_RATIO 视为回落 */
export const CRITICAL_RATIO = 0.9;
export const LOW_RATIO = 0.7;
/** 防抖死区：切换后此时间窗内不再次切换（ms） */
export const MIN_INTERVAL_MS = 90_000;
/** 连续 critical 才降挡（防单次偶发高压误降） */
export const CRITICAL_STREAK = 2;
/** 连续 low 且稳定才升回（防抖） */
export const LOW_STREAK = 3;

const TASK_TYPE_ADJUSTMENTS: Record<TaskType, { criticalStreakLimit: number; lowStreakLimit: number }> = {
  explore: { criticalStreakLimit: 2, lowStreakLimit: 2 },
  code: { criticalStreakLimit: 4, lowStreakLimit: 3 },
  review: { criticalStreakLimit: 3, lowStreakLimit: 2 },
  other: { criticalStreakLimit: CRITICAL_STREAK, lowStreakLimit: LOW_STREAK },
};

export interface ThinkLevelState {
  /** 会话基调档位：初始化取运行时档位（clamp），升回上限，不随持久化漂移 */
  base: AutoThinkLevel;
  current: AutoThinkLevel;
  criticalStreak: number;
  lowStreak: number;
  lastSwitchTs: number;
}

/** 将任意档位字符串 clamp 进阶梯（max→high、off/minimal→low 下限保护） */
export function clampToLadder(level: string, fallback: AutoThinkLevel = 'high'): AutoThinkLevel {
  const i = LEVEL_LADDER.indexOf(level as AutoThinkLevel);
  if (i >= 0) return level as AutoThinkLevel;
  if (level === 'max') return 'high';
  if (level === 'minimal' || level === 'off') return 'low';
  return fallback;
}

export function createState(initialLevel: string): ThinkLevelState {
  const base = clampToLadder(initialLevel);
  return { base, current: base, criticalStreak: 0, lowStreak: 0, lastSwitchTs: 0 };
}

function idx(l: AutoThinkLevel): number {
  return LEVEL_LADDER.indexOf(l);
}

export function lower(l: AutoThinkLevel): AutoThinkLevel | null {
  const i = idx(l);
  return i <= 0 ? null : LEVEL_LADDER[i - 1];
}

export function upper(l: AutoThinkLevel): AutoThinkLevel | null {
  const i = idx(l);
  return i >= LEVEL_LADDER.length - 1 ? null : LEVEL_LADDER[i + 1];
}

/** 由真实比例推导压力带：critical/low/其余 */
export function pressureOf(ratio: number): 'critical' | 'low' | 'mid' {
  if (ratio >= CRITICAL_RATIO) return 'critical';
  if (ratio < LOW_RATIO) return 'low';
  return 'mid';
}

export function tickThinkingLevel(
  state: ThinkLevelState,
  ratio: number,
  setLevel: (l: AutoThinkLevel) => void,
  now: number = Date.now(),
  taskType: TaskType = 'other',
): AutoThinkLevel | null {
  const p = pressureOf(ratio);
  const adj = TASK_TYPE_ADJUSTMENTS[taskType] ?? TASK_TYPE_ADJUSTMENTS.other;

  if (now - state.lastSwitchTs < MIN_INTERVAL_MS) {
    // 死区内：不切换，也不累计连续信号
    return null;
  }

  if (p === 'critical') {
    state.criticalStreak += 1;
    state.lowStreak = 0;
    if (state.criticalStreak >= adj.criticalStreakLimit) {
      const next = lower(state.current);
      if (next) {
        state.criticalStreak = 0;
        return apply(state, next, `pressure=critical(ratio=${Math.round(ratio * 100)}%)`, 'critical', setLevel, now);
      }
      state.criticalStreak = 0;
    }
    return null;
  }

  if (p === 'low') {
    state.lowStreak += 1;
    state.criticalStreak = 0;
    if (state.lowStreak >= adj.lowStreakLimit) {
      const next = upper(state.current);
      if (next && idx(next) <= idx(state.base)) {
        state.lowStreak = 0;
        return apply(state, next, 'pressure=low(稳定回升至基准)', 'low', setLevel, now);
      }
      state.lowStreak = 0;
    }
    return null;
  }

  state.criticalStreak = 0;
  state.lowStreak = 0;
  return null;
}

function apply(
  state: ThinkLevelState,
  next: AutoThinkLevel,
  reason: string,
  pressure: string,
  setLevel: (l: AutoThinkLevel) => void,
  now: number,
): AutoThinkLevel {
  const from = state.current;
  setLevel(next);
  state.current = next;
  state.lastSwitchTs = now;
  recordLevelChange({ from, to: next, reason, pressure, source: 'auto' });
  return next;
}

// ── 混合方案：模型提议、规则审批 ──
export interface ProposalResult {
  ok: boolean;
  message: string;
  level?: AutoThinkLevel;
}

export function proposeThinkingLevel(
  state: ThinkLevelState,
  target: string,
  reason: string,
  setLevel: (l: AutoThinkLevel) => void,
  now: number = Date.now(),
): ProposalResult {
  const level = clampToLadder(target);
  const from = state.current;
  if (level === from) {
    return { ok: true, message: `已是 ${level} 档，无需切换。` };
  }
  const elapsed = now - state.lastSwitchTs;
  if (elapsed < MIN_INTERVAL_MS) {
    return {
      ok: false,
      message: `防抖死区内（还需 ${Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000)}s）不切档，请稍后再试。当前 ${from} 档。`,
    };
  }
  const pressure = getBudgetReport().pressure;
  if (pressure === 'critical' && idx(level) > idx(from)) {
    return {
      ok: false,
      message: `当前上下文压力 critical（极高），升档只会加剧 thinking 剪枝/断裂，已拒绝升到 ${level}。建议保持 ${from} 或降档缓解。`,
    };
  }
  setLevel(level);
  state.current = level;
  state.lastSwitchTs = now;
  recordLevelChange({
    from,
    to: level,
    reason: `model-proposal: ${reason || '(未注明理由)'}`.slice(0, 120),
    pressure,
    source: 'model',
  });
  return { ok: true, message: `已按模型提议切换到 ${level} 档（reason: ${reason || '未注明'}）。`, level };
}

// ── 审计落盘 ──

export interface LevelChange {
  type: 'level-change';
  ts: number;
  from: string;
  to: string;
  reason: string;
  pressure: string;
  source: 'auto' | 'model';
}

export function levelChangeFile(): string {
  return process.env.PI_LEVEL_CHANGE_FILE || join(getMemoryDir(), 'logs', 'level-changes.jsonl');
}

export function recordLevelChange(e: Omit<LevelChange, 'type' | 'ts'>): void {
  if (process.env.PI_DISABLE_LEVEL_AUDIT === '1') return;
  try {
    appendJSONL(levelChangeFile(), { type: 'level-change', ts: Date.now(), ...e });
  } catch {
    /* 审计失败不影响切档 */
  }
}

export function loadLevelChanges(): LevelChange[] {
  return readJSONL<LevelChange>(levelChangeFile(), (r): r is LevelChange => {
    return typeof r === 'object' && r !== null && (r as { type?: unknown }).type === 'level-change';
  });
}
