/**
 * autopilot — 每日任务视图（纯逻辑，零 Pi 依赖）
 *
 * 职责：把 `portable/memory/scheduler/tasks.json` 的原始 Task 渲染成
 * 「有哪些每日任务、今天跑到哪了、上次结果如何」的可读文本，供 `/daily` 命令使用。
 *
 * 「每日任务」的判定是 tags 含 `daily`：种子任务在 `portable/agent/scheduled-seeds.json`
 * 里统一打了该标签（跨设备对账后本地 tasks.json 保留）。若一个 daily 标签都没有，
 * 调用方降级为显示全部任务并在标题里说明——否则用户自建的 cron 任务会在 /daily 里凭空消失。
 */

import type { Task } from './types';

/** 每日任务标签（与 scheduled-seeds.json 一致） */
export const DAILY_TAG = 'daily';

/** 选择每日任务；无任何 daily 标签时降级为全部任务并标记 byTag=false */
export function selectDailyTasks(tasks: Task[]): { tasks: Task[]; byTag: boolean } {
  const tagged = tasks.filter((t) => (t.tags ?? []).includes(DAILY_TAG));
  return tagged.length > 0 ? { tasks: tagged, byTag: true } : { tasks, byTag: false };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  );
}

/**
 * cron `M H * * *` → `HH:MM`；含步进/区间/星期限定等复杂字段时返回 null，
 * 由调用方回落显示原表达式（不要假装能读懂所有 cron）。
 */
export function cronClock(schedule: string): string | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  if (!/^\d+$/.test(m) || !/^\d+$/.test(h)) return null;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const mi = Number(m);
  const hi = Number(h);
  if (mi > 59 || hi > 23) return null;
  return `${pad2(hi)}:${pad2(mi)}`;
}

/** 时刻短格式：同一天 `HH:MM`，跨天 `MM-DD HH:MM` */
export function shortTime(iso: string | null, now: Date): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return isSameLocalDay(iso, now) ? clock : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${clock}`;
}

/** 时长：`45s` / `1.5m` / `2h05m` */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${Math.floor(ms / 3_600_000)}h${pad2(Math.round((ms % 3_600_000) / 60_000))}m`;
}

/** 相对时间：`12m 后` / `3h 前` */
export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return '-';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '-';
  const diff = t - now.getTime();
  const abs = Math.abs(diff);
  const mag =
    abs < 60_000
      ? `${Math.round(abs / 1000)}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`;
  return diff >= 0 ? `${mag} 后` : `${mag} 前`;
}

/** 最近一次执行的耗时（history 末条的 durationMs；旧记录可能没有） */
function lastDurationMs(t: Task): number | undefined {
  return t.history[t.history.length - 1]?.durationMs;
}

/** 上次结果标记 */
function lastMark(t: Task): string {
  if (!t.lastRun) return '未跑过';
  return t.lastResult === 'failed' ? '✗ 失败' : '✓ 成功';
}

/** 单行摘要：`● 07:30 golden-fast   上次 09-30 19:12 ✓ 成功 1.5m  下次 10-01 07:30  成 9/失 0` */
export function formatDailyLine(t: Task, now: Date): string {
  const flag = t.enabled ? '●' : '○';
  const clock = (cronClock(t.schedule) ?? t.schedule).padEnd(11);
  const last = t.lastRun
    ? `${shortTime(t.lastRun, now)} ${lastMark(t)} ${formatDuration(lastDurationMs(t))}`
    : '未跑过';
  const next = t.enabled ? shortTime(t.nextRun, now) : '已禁用';
  return `${flag} ${clock} ${t.name.padEnd(22)} 上次 ${last}  下次 ${next}  成 ${t.runCount}/失 ${t.failCount}`;
}

export interface DailyMeta {
  /** 自动驾驶总开关（config.enabled） */
  autopilotEnabled: boolean;
  /** 调度器暂停（settings.paused） */
  paused: boolean;
  /** 是否按 daily 标签筛出（false = 无标签，已降级为全部任务） */
  byTag: boolean;
}

/**
 * 概览：总数/启停 + 今日进度 + 逐条一行。
 * 「今日完成/失败」按 lastRun 的**本地日期**判定，与 cron 的自然日语义一致。
 */
export function formatDailyOverview(tasks: Task[], meta: DailyMeta, now: Date): string {
  const enabled = tasks.filter((t) => t.enabled);
  // 今日进度只在**启用中**的任务里统计，否则分子（跑过的）可能包含已禁用任务，
  // 而分母是启用数，出现"完成 + 待跑 + 失败 ≠ 启用"的自相矛盾。
  const doneToday = enabled.filter(
    (t) => t.lastRun && isSameLocalDay(t.lastRun, now) && t.lastResult === 'success',
  );
  const failedToday = enabled.filter(
    (t) => t.lastRun && isSameLocalDay(t.lastRun, now) && t.lastResult === 'failed',
  );
  const lines: string[] = [
    `${meta.byTag ? '每日任务' : '调度任务（无 daily 标签，已显示全部）'} ${tasks.length} 个 · 启用 ${enabled.length} · 禁用 ${tasks.length - enabled.length}`,
    `今日 ${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}：完成 ${doneToday.length} · 待跑 ${enabled.length - doneToday.length - failedToday.length} · 失败 ${failedToday.length}`,
    `调度器 ${meta.paused ? '已暂停' : '运行中'} · 自动驾驶 ${meta.autopilotEnabled ? '启用' : '禁用'}`,
  ];
  lines.push(...(tasks.length ? tasks.map((t) => `  ${formatDailyLine(t, now)}`) : ['  (无)']));
  // 只提示**启用中**的失败任务：已禁用的不会再跑，提示它只会变成永久噪音
  const failing = enabled.filter((t) => t.lastResult === 'failed');
  if (failing.length > 0) {
    lines.push(`注意：上次失败的每日任务 ${failing.map((t) => t.name).join('、')}（/daily show <名> 看详情）`);
  }
  return lines.join('\n');
}

/** 详情：调度/下次/上次/统计/标签 + 最近 5 次执行 + 提示词摘要 */
export function formatDailyDetail(t: Task, now: Date): string {
  const clock = cronClock(t.schedule);
  const lines: string[] = [
    `${t.enabled ? '已启用' : '已禁用'}  ${t.name}  [${t.type}:${t.schedule}${clock ? ` = ${clock}` : ''}]`,
    `下次 ${t.nextRun ? `${shortTime(t.nextRun, now)}（${relativeTime(t.nextRun, now)}）` : '-'}`,
    `上次 ${t.lastRun ? `${shortTime(t.lastRun, now)} ${lastMark(t)} ${formatDuration(lastDurationMs(t))}` : '未跑过'}`,
    `成功 ${t.runCount} · 连续失败 ${t.failCount} · 重试 ${t.retries} · 超时 ${t.maxRunTime}s · 标签 ${(t.tags ?? []).join(',') || '(无)'}`,
  ];
  const recent = t.history.slice(-5).reverse();
  if (recent.length > 0) {
    lines.push('最近执行：');
    for (const h of recent) {
      const out = h.output.replace(/\s+/g, ' ').trim().slice(0, 80);
      lines.push(
        `  ${shortTime(h.time, now)} ${h.result === 'success' ? '✓' : '✗'} ${formatDuration(h.durationMs)}  ${out || '(无输出)'}`,
      );
    }
  }
  const prompt = t.prompt.replace(/\s+/g, ' ').trim();
  lines.push(`提示词：${prompt.slice(0, 160)}${prompt.length > 160 ? '…' : ''}`);
  return lines.join('\n');
}
