/**
 * 终止记录（Humanize 借鉴：**"迭代不保证收敛 ⇒ 终止必须被设计"**，arXiv:2610.08900 §6）
 *
 * ## 它做什么、不做什么
 *
 * **只记录**：把"为什么停"与"受阻是环境问题还是真失败"写成 append-only 记录，供 `daily-health` 统计与
 * 人工复核。**它不参与任何判定** —— 是否继续/停止仍完全由 `store/goal.ts` 的 `decideContinuation` 决定
 * （这条是硬约束：用户只授权"普通优化"，**默认行为不许改**）。
 *
 * ## 为什么值得记
 *
 * 论文 §6 的两条发现：① "**迭代不保证收敛**"（有一例 87 轮 vs 上限 42；有一篇**每轮都记 advanced 而 8 条
 * 验收判据一条未满足**）⇒ 终止必须被设计；② "**证据与环境决定终止**"⇒ 收不齐证据时应当**问人类**而不是
 * 烧回合。要能分辨这两种情形，前提是**先把它们记下来**——这正是本模块的全部职责。
 *
 * ## 设计取向（沿用本仓库既有的可观测性惯例）
 *
 * 与 `context/budget/fingerprint-log.ts` 同型：**确定性构造（纯函数）+ 注入式 IO + 异常一律吞掉**，
 * 落盘到 `getMemoryDir()/logs/` 下、同样 **1MB 轮转**（`appendJSONLRotating`）、同样**不入库**
 * （`.gitignore` 的 `portable/memory/*`）。
 *
 * **隐私**：记录里**不含目标原文、不含会话内容**，只有分类标签与计数。
 */

import { dirname, join } from 'node:path';
import { appendJSONLRotating, ensureDir } from '../../../core/fs-json';
import { getMemoryDir } from '../../../core/config';

/** 与既有日志保持同一轮转上限（见 context 的前缀/错误指纹日志） */
export const TERMINATION_LOG_MAX_BYTES = 1_000_000;

export interface TerminationRecord {
  ts: string;
  /** 评审预算用完（连续 N 轮评审未通过）时出现 */
  stopReason?: string;
  /** 环境阻塞 vs 真失败（判据见 `ENVIRONMENT_ERROR_MARKERS`） */
  blockedKind?: 'environment' | 'failure';
  reviewRoundsWithoutPass?: number;
  roundsUsed: number;
}

/** 日志路径（可被环境变量覆盖，便于测试与隔离） */
export function terminationLogFile(): string {
  return process.env.PI_GOAL_TERMINATION_LOG || join(getMemoryDir(), 'logs', 'goal-terminations.jsonl');
}

/** 纯构造：只挑出**已存在**的字段（不写 undefined，输出稳定，便于统计与比对）。 */
export function buildTerminationRecord(input: TerminationRecord): TerminationRecord {
  const out: TerminationRecord = { ts: input.ts, roundsUsed: input.roundsUsed };
  if (input.stopReason) out.stopReason = input.stopReason;
  if (input.blockedKind) out.blockedKind = input.blockedKind;
  if (typeof input.reviewRoundsWithoutPass === 'number') {
    out.reviewRoundsWithoutPass = input.reviewRoundsWithoutPass;
  }
  return out;
}

/**
 * 追加一行。**fail-open**：任何异常（权限/磁盘/路径）都吞掉并返回 `false`，
 * 绝不允许因为"记录失败"而影响目标续跑或任何判定。
 */
export function appendTerminationRecord(input: TerminationRecord): boolean {
  try {
    const file = terminationLogFile();
    ensureDir(dirname(file));
    appendJSONLRotating(file, buildTerminationRecord(input), TERMINATION_LOG_MAX_BYTES);
    return true;
  } catch {
    return false;
  }
}
