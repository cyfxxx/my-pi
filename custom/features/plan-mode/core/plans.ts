/**
 * 计划落盘（plan.md 持久化与磁盘恢复）
 *
 * 迁移自 pi-tools `plan-mode/{view.ts,helpers.ts}`：
 * - `renderPlanFile` / `parsePlanFile`：任务状态 ↔ plan.md 文本（`- [ ] 1. 标题`，
 *   状态标记 ` `=pending `~`=in_progress `b`=blocked `x`=completed，in_progress 附 activeForm）
 * - `restoreStateFromPlans`：重启后从最新「未完成且未过期」的 plan.md 恢复任务（磁盘兜底）
 * - `cleanupOldPlans`：仅保留最近 MAX_PLANS 份计划目录
 *
 * 与原实现的差异：落盘根目录由 `PI_PLANS_DIR` 指定，缺省收敛到 `<memoryDir>/plans`
 * （原实现写 `~/.pi/plans`；my-pi 的运行时数据统一收敛到 portable/）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir } from '../../../core/config';
import type { Task, TaskState } from './state';

/** 保留的计划目录数量上限 */
export const MAX_PLANS = 20;
/** 磁盘恢复的最长计划年龄（超过视为过期，避免跨项目/跨周污染） */
export const MAX_RESTORE_AGE_MS = 7 * 24 * 3600 * 1000;

export function plansDir(): string {
  return process.env.PI_PLANS_DIR || join(getMemoryDir(), 'plans');
}

/** 计划目录名：`plan-<epoch ms>`（排序即时间序） */
export function planDirName(ts: number): string {
  return `plan-${ts}`;
}

export function planDirPath(ts: number): string {
  return join(plansDir(), planDirName(ts));
}

function statusMark(status: Task['status']): string {
  switch (status) {
    case 'completed':
      return 'x';
    case 'in_progress':
      return '~';
    case 'blocked':
      return 'b';
    default:
      return ' ';
  }
}

/** 任务状态渲染为 plan.md 文本（磁盘持久化） */
export function renderPlanFile(tasks: readonly Task[], nextId: number): string {
  const lines = ['# 计划（plan-mode 自动同步，勿手改——下一次状态变化会覆盖）', ''];
  for (const t of tasks) {
    if (t.status === 'deleted') continue;
    const form = t.status === 'in_progress' && t.activeForm ? ` (${t.activeForm})` : '';
    lines.push(`- [${statusMark(t.status)}] ${t.id}. ${t.subject}${form}`);
  }
  lines.push('');
  lines.push(`<!-- nextId: ${nextId} -->`);
  return lines.join('\n');
}

/** 从 plan.md 文本解析任务状态；格式不符返回 null（防手改污染） */
export function parsePlanFile(content: string): TaskState | null {
  const tasks: Task[] = [];
  const lines = content.split('\n');
  let maxId = 0;
  let parsed = 0;
  for (const line of lines) {
    const m = line.match(/^- \[([ x~b])\] (\d+)\. (.+)$/);
    if (!m) continue;
    parsed++;
    const id = parseInt(m[2], 10);
    maxId = Math.max(maxId, id);
    const status: Task['status'] =
      m[1] === 'x' ? 'completed' : m[1] === '~' ? 'in_progress' : m[1] === 'b' ? 'blocked' : 'pending';
    let subject = m[3];
    let activeForm: string | undefined;
    if (status === 'in_progress') {
      const fm = subject.match(/^(.+?)\s*\((.*)\)$/);
      if (fm) {
        subject = fm[1];
        activeForm = fm[2];
      }
    }
    tasks.push({ id, subject, status, activeForm });
  }
  const nonEmpty = lines.filter((l) => l.trim() !== '').length;
  if (parsed === 0) return null;
  // 可解析行需过半（单任务计划只有 3 个非空行，故用 >3 才校验）
  if (nonEmpty > 3 && parsed < nonEmpty / 2) return null;
  const nextIdMatch = content.match(/<!-- nextId: (\d+) -->/);
  const nextId = nextIdMatch ? parseInt(nextIdMatch[1], 10) : maxId + 1;
  return { tasks, nextId };
}

/** 写入一份计划文件（目录不存在时创建） */
export function writePlanFile(ts: number, content: string): string {
  const dir = planDirPath(ts);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'plan.md');
  writeFileSync(file, content);
  return file;
}

/**
 * 删除当前会话的计划目录（仅 `plan-<ts>`，不触碰其它计划目录）。
 * 仅当目标是目录时删除；不存在/非目录/删除失败返回 false。
 */
export function removePlan(ts: number): boolean {
  const dir = planDirPath(ts);
  try {
    if (!statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 同步当前会话任务状态到计划文件：
 * - 有任务：写入 `plan-<ts>/plan.md` 并清理超出上限的旧计划
 * - 空状态（`/plan clear`、`todo clear`）：删除当前计划目录，
 *   防止重启时 `restoreStateFromPlans` 把已清空的计划复活
 */
export function syncPlanFile(ts: number, state: TaskState): 'written' | 'removed' {
  if (state.tasks.length === 0) {
    removePlan(ts);
    return 'removed';
  }
  writePlanFile(ts, renderPlanFile(state.tasks, state.nextId));
  cleanupOldPlans();
  return 'written';
}

/** 按时间倒序列出计划目录（仅含 plan-* 目录） */
export function listPlans(): Array<{ name: string; ts: number; path: string }> {
  const dir = plansDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name.startsWith('plan-'))
      // 以 statSync 为准：dirent 的 d_type 在 overlayfs/沙箱下不可靠（实测把普通文件报成 DT_LNK）
      .filter((e) => {
        try {
          return statSync(join(dir, e.name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((e) => ({ name: e.name, ts: Number(e.name.replace('plan-', '')), path: join(dir, e.name) }))
      .filter((e) => Number.isFinite(e.ts))
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/** 仅保留最近 MAX_PLANS 份计划目录，返回删除数量 */
export function cleanupOldPlans(maxPlans = MAX_PLANS): number {
  const dirs = listPlans();
  if (dirs.length <= maxPlans) return 0;
  let removed = 0;
  for (const d of dirs.slice(maxPlans)) {
    try {
      rmSync(d.path, { recursive: true, force: true });
      removed++;
    } catch {
      /* 单个失败不影响其余 */
    }
  }
  return removed;
}

/** 当前活跃计划：解析状态 + 原始文件内容 + 计划目录时间戳 */
export interface ActivePlan {
  state: TaskState;
  content: string;
  ts: number;
}

/**
 * 查找当前活跃计划：按时间倒序取第一份「未过期（≤ MAX_RESTORE_AGE_MS）且含未完成任务」的 plan.md。
 * 目录规则统一走 `listPlans`（`PI_PLANS_DIR` 优先、statSync 判目录、时间倒序）。
 * `restoreStateFromPlans` 与 subagent 的活跃计划注入复用本函数，保证恢复语义一致。
 */
export function findActivePlan(now = Date.now()): ActivePlan | null {
  for (const d of listPlans()) {
    if (now - d.ts > MAX_RESTORE_AGE_MS) continue;
    let content: string;
    try {
      content = readFileSync(join(d.path, 'plan.md'), 'utf-8');
    } catch {
      continue;
    }
    const state = parsePlanFile(content);
    if (!state || state.tasks.length === 0) continue;
    const hasRemaining = state.tasks.some((t) => t.status !== 'completed' && t.status !== 'deleted');
    if (!hasRemaining) continue;
    return { state, content, ts: d.ts };
  }
  return null;
}

/**
 * 从磁盘恢复任务状态：取最新一份「未过期且仍有未完成任务」的 plan.md。
 * 返回 `{ state, ts }`（ts 为计划目录时间戳，调用方续写同一份计划）；无可用计划返回 null。
 */
export function restoreStateFromPlans(now = Date.now()): { state: TaskState; ts: number } | null {
  const active = findActivePlan(now);
  return active ? { state: active.state, ts: active.ts } : null;
}
