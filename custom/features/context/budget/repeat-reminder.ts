/**
 * 完全相同重复调用的判定（2026-10-07，编排优化第 3 项）
 *
 * 动机：模型卡在"重试同一个动作"上是真实浪费（对照 DSH 的 `repeat-tool-reminder`，阈值 3/5/8）。
 *
 * **判据必须是"工具名 + 参数都相同"，不能只按名字。** 本仓库实测 `bash` 曾被连续调用 1190 次
 * （几乎一次接一次），按名字计数只会变成每轮刷屏的噪音；只有**参数也完全一样**才说明它在原地打转，
 * 那才是值得打断的信号。这也是本模块唯一一处与 DSH 可能不同的地方——DSH 的具体判据未在本仓库核实，
 * 而"按名字"在 my-pi 的使用形态下显然会产生噪音，所以这里按**可辩护的语义**实现并写明理由。
 *
 * 纯逻辑（零 Pi 依赖），可在 vitest 里直接驱动。
 */

/** 在第几次完全相同的连续调用上提醒（只在这些**恰好**的计数上提醒，不是"之后每次都提醒"） */
export const REPEAT_REMIND_AT: ReadonlySet<number> = new Set([3, 5, 8]);

export interface RepeatState {
  /** 上一次调用的指纹（`null` 表示还没有调用过） */
  fingerprint: string | null;
  /** 该指纹已经**连续**出现几次 */
  count: number;
}

export function createRepeatState(): RepeatState {
  return { fingerprint: null, count: 0 };
}

/**
 * 稳定键：键名排序后再序列化，所以 `{a:1,b:2}` 与 `{b:2,a:1}` 视为同一次调用
 * （模型每次生成参数时键序可能不同，那不该被当成不同的调用）。
 * 遇到循环引用等异常时退回 `String(value)`——判定退化总好过抛错打断工具调用。
 */
export function stableKey(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[circular]';
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  try {
    return JSON.stringify(walk(value)) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface RepeatObservation {
  /** 该指纹当前连续出现次数（含本次） */
  count: number;
  /** 本次是否应当提醒 */
  remind: boolean;
}

/** 记一次调用并判定是否提醒（原地更新 `state`） */
export function observeRepeat(state: RepeatState, toolName: string | undefined, input: unknown): RepeatObservation {
  const fingerprint = `${toolName ?? 'unknown'}\u0000${stableKey(input)}`;
  state.count = state.fingerprint === fingerprint ? state.count + 1 : 1;
  state.fingerprint = fingerprint;
  return { count: state.count, remind: REPEAT_REMIND_AT.has(state.count) };
}

/** 提醒文案（阈值与工具名都写清楚，便于模型判断"是不是在打转"） */
export function repeatReminderText(toolName: string, count: number): string {
  return (
    `[提醒] \`${toolName}\` 已被**完全相同地**连续调用 ${count} 次（连参数都一样）。` +
    `如果是在重试，先读报错原文确认前几次为什么失败，而不是原样再发一遍；` +
    `已知原因但需要换参数，就直接换。`
  );
}
