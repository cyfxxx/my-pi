/**
 * autopilot — 命令参数补全（纯逻辑，零 Pi 依赖）
 *
 * 背景：`/daily show|on|off|run` 与 `/schedule delete|enable|disable|edit|history|run`
 * 都要任务名，而此前只补全子命令，任务名必须手输。任务名是 `task-<base36>` 或
 * `tool-stats-daily` 这类难记的串，手输易错、易敲错大小写。
 *
 * 关键约定（跟 pi-tui 的补全语义对齐，见 `vendor/pi/packages/tui/src/autocomplete.ts`）：
 * 命令参数补全的 `value` 必须是**整段参数文本**（`<子命令> <任务名>`），因为
 * `applyCompletion` 用 `argumentPrefix`（`/daily ` 之后的全部文本）整体替换；
 * 只返回任务名会把子命令一起冲掉。
 */

import type { Task } from './types';

/** 与 pi-tui `AutocompleteItem` 结构一致（避免 features 依赖 pi-tui 类型） */
export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

/** 任务一行简介：`cron:0 9 * * *` / `interval:5m [已禁用]` */
function describeTask(task: Task): string {
  return `${task.type}:${task.schedule}${task.enabled ? '' : ' [已禁用]'}`;
}

/**
 * 任务名补全：按已键入前缀过滤 name/id，产出可直接替换整段参数的补全项。
 *
 * @param extras 额外固定候选（如启用/禁用/手动执行支持的 `all`）
 * @returns 命中项；无命中返回 null（pi 约定：null = 无补全）
 */
export function taskNameCompletions(
  tasks: Task[],
  sub: string,
  typed: string,
  extras: readonly string[] = [],
): CompletionItem[] | null {
  const t = typed.trim();
  const items: CompletionItem[] = [];
  for (const extra of extras) {
    if (!t || extra.startsWith(t)) items.push({ value: `${sub} ${extra}`, label: extra, description: '全部任务' });
  }
  for (const task of tasks) {
    if (t && !task.name.startsWith(t) && !task.id.startsWith(t)) continue;
    items.push({ value: `${sub} ${task.name}`, label: task.name, description: describeTask(task) });
  }
  return items.length > 0 ? items : null;
}

/** `/schedule edit` 的第二段参数：可改字段与取值说明 */
export const EDIT_FIELDS: ReadonlyArray<{ value: string; description: string }> = [
  { value: 'schedule', description: '调度表达式（interval 5m / once ISO / cron 表达式）' },
  { value: 'type', description: '任务类型：interval | once | cron' },
  { value: 'enabled', description: '是否启用：true | false' },
  { value: 'prompt', description: '任务提示词' },
];

/** `edit <名> <字段>` 的字段补全（value 同样带全整段参数） */
export function editFieldCompletions(sub: string, name: string, typedField: string): CompletionItem[] | null {
  const t = typedField.trim();
  const items = EDIT_FIELDS.filter((f) => !t || f.value.startsWith(t)).map((f) => ({
    value: `${sub} ${name} ${f.value}`,
    label: f.value,
    description: f.description,
  }));
  return items.length > 0 ? items : null;
}

/**
 * 把命令参数文本拆成「子命令 + 其余已键入文本」。
 * `hasTrailingSpace` 用于区分 `edit <名>`（补名）与 `edit <名> `（补字段）。
 */
export function splitArgument(prefix: string): { sub: string; rest: string; hasTrailingSpace: boolean } {
  const p = prefix ?? '';
  const m = p.match(/^\s*(\S+)([\s\S]*)$/);
  return {
    sub: (m?.[1] ?? '').toLowerCase(),
    rest: (m?.[2] ?? '').trim(),
    hasTrailingSpace: /\s$/.test(p),
  };
}
