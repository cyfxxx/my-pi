/**
 * schedule_task —— 定时任务管理工具（纯逻辑 + 注册）
 *
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/tools.ts` 的 schedule_task（第 374 行起）。
 * `executeScheduleAction` 及格式化函数为零 Pi 依赖的纯逻辑；`registerScheduleTool`
 * 只通过 `adapters/tool-adapter` 注册，不在 features 内直接 import Pi 包。
 */

import { registerTool } from '../../../adapters/tool-adapter';
import { addTask, deleteTask, listTasks, setSettings, updateTask } from '../store/storage';
import type { Task, TaskType } from '../types';

/**
 * 注册函数参数类型：从适配器推导。
 * features 逻辑层不得直接 import Pi 包（隔离检查 #3），故不引入 ExtensionAPI 类型。
 */
type PiApi = Parameters<typeof registerTool>[0];

const TASK_TYPES: readonly TaskType[] = ['interval', 'cron', 'once'];

function isTaskType(v: unknown): v is TaskType {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asPositiveNumber(v: unknown): number | undefined {
  const n = asNumber(v);
  return n !== undefined && n > 0 ? n : undefined;
}

function asTags(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN') : '—';
}

/** 单任务摘要行 + prompt 预览（list 输出） */
export function formatTaskSummary(task: Task): string {
  const tags = task.tags.length > 0 ? ` #${task.tags.join('#')}` : '';
  return (
    `${task.enabled ? '✓' : '✗'} ${task.name} (${task.type}) ${task.schedule}${tags}\n` +
    `  next: ${fmtTime(task.nextRun)} last: ${fmtTime(task.lastRun)} (${task.lastResult || '—'})×${task.runCount} 重试: ${task.retries}\n` +
    `  prompt: ${task.prompt.slice(0, 60)}`
  );
}

/** 任务列表文本 */
export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return '暂无定时任务';
  return `定时任务 (${tasks.length}):\n${tasks.map(formatTaskSummary).join('\n')}`;
}

/** 新建任务详情 */
export function formatCreatedTask(task: Task): string {
  return [
    `已创建任务: ${task.name}`,
    `ID: ${task.id}`,
    `类型: ${task.type}`,
    `调度: ${task.schedule}`,
    `下次执行: ${task.nextRun || '无法计算'}`,
    `标签: ${task.tags.join(', ') || '无'}`,
    `重试: ${task.retries}`,
  ].join('\n');
}

export interface ScheduleAddParams {
  name: string;
  type: TaskType;
  schedule: string;
  prompt: string;
  useSubagent?: boolean;
  notifyOnCompletion?: boolean;
  maxRunTime?: number;
  tags?: string[];
  retries?: number;
}

/** 解析 add 参数（无效返回 null 与错误文本） */
export function parseScheduleAdd(args: Record<string, unknown>): ScheduleAddParams | string {
  const name = asString(args.name);
  const type = args.type;
  const schedule = asString(args.schedule);
  const prompt = asString(args.prompt);
  if (!name || type === undefined || !schedule || !prompt) {
    return '缺少参数: name, type, schedule, prompt 为必需';
  }
  if (!isTaskType(type)) return `无效任务类型: ${String(type)}（可选 interval/cron/once）`;
  const retries = asNumber(args.retries);
  return {
    name,
    type,
    schedule,
    prompt,
    useSubagent: asBool(args.useSubagent),
    notifyOnCompletion: asBool(args.notifyOnCompletion),
    maxRunTime: asPositiveNumber(args.maxRunTime),
    tags: asTags(args.tags),
    retries: retries !== undefined ? Math.max(0, Math.floor(retries)) : undefined,
  };
}

/** 收集 update 的修改项（只接受类型合法的字段） */
export function collectScheduleUpdates(args: Record<string, unknown>): Parameters<typeof updateTask>[1] {
  const updates: Parameters<typeof updateTask>[1] = {};
  const schedule = asString(args.schedule);
  if (schedule !== undefined) updates.schedule = schedule;
  if (typeof args.prompt === 'string') updates.prompt = args.prompt;
  if (isTaskType(args.type)) updates.type = args.type;
  const useSubagent = asBool(args.useSubagent);
  if (useSubagent !== undefined) updates.useSubagent = useSubagent;
  const notifyOnCompletion = asBool(args.notifyOnCompletion);
  if (notifyOnCompletion !== undefined) updates.notifyOnCompletion = notifyOnCompletion;
  const maxRunTime = asPositiveNumber(args.maxRunTime);
  if (maxRunTime !== undefined) updates.maxRunTime = maxRunTime;
  const retries = asNumber(args.retries);
  if (retries !== undefined) updates.retries = Math.max(0, Math.floor(retries));
  const tags = asTags(args.tags);
  if (tags !== undefined) updates.tags = tags;
  return updates;
}

export const SCHEDULE_ACTIONS = ['add', 'list', 'update', 'delete', 'enable', 'disable', 'pause', 'resume'] as const;

/**
 * schedule_task 主逻辑：add/list/update/delete/enable/disable/pause/resume。
 * 返回面向模型的可读文本（预期错误不抛异常）。
 */
export async function executeScheduleAction(args: Record<string, unknown>): Promise<string> {
  const action = asString(args.action);
  if (!action) return '缺少参数: action';
  if (!(SCHEDULE_ACTIONS as readonly string[]).includes(action)) return `未知操作: ${action}`;

  if (action === 'add') {
    const parsed = parseScheduleAdd(args);
    if (typeof parsed === 'string') return parsed;
    try {
      return formatCreatedTask(await addTask(parsed));
    } catch (err) {
      return `创建失败: ${(err as Error).message}`;
    }
  }

  if (action === 'list') return formatTaskList(listTasks());

  if (action === 'pause') {
    await setSettings({ paused: true });
    return '已全局暂停调度';
  }
  if (action === 'resume') {
    await setSettings({ paused: false });
    return '已恢复调度';
  }

  const idOrName = asString(args.taskId) ?? asString(args.name);
  if (!idOrName) return '缺少参数: taskId 或 name';

  if (action === 'delete') {
    const ok = await deleteTask(idOrName);
    return ok ? `已删除任务: ${idOrName}` : `未找到任务: ${idOrName}`;
  }

  if (action === 'enable' || action === 'disable') {
    const task = await updateTask(idOrName, { enabled: action === 'enable' });
    const verb = action === 'enable' ? '启用' : '禁用';
    return task ? `已${verb}任务: ${task.name}` : `未找到任务: ${idOrName}`;
  }

  if (action === 'update') {
    const updates = collectScheduleUpdates(args);
    if (Object.keys(updates).length === 0) {
      return '未指定修改项: schedule / prompt / type / useSubagent / notifyOnCompletion / maxRunTime / retries / tags';
    }
    try {
      const task = await updateTask(idOrName, updates);
      if (!task) return `未找到任务: ${idOrName}`;
      return `已更新任务: ${task.name}\n调度: ${task.schedule}\n下次执行: ${task.nextRun || '—'}`;
    } catch (err) {
      return `更新失败: ${(err as Error).message}`;
    }
  }

  return `未知操作: ${action}`;
}

/** 向 Pi 注册 schedule_task 工具 */
export function registerScheduleTool(pi: PiApi): void {
  registerTool(pi, {
    name: 'schedule_task',
    description:
      '创建/列出/更新/删除/启用/禁用定时任务。type: interval(如 "5m")/cron(5字段 POSIX，如 "0 9 * * 1-5")/once("+30m" 或 ISO，执行后自动移除)。prompt 支持模板变量 {{date}}/{{time}}/{{datetime}}/{{cwd}}；retries 为失败重试次数（退避间隔 30s 起）。',
    parameters: {
      action: {
        type: 'string',
        enum: SCHEDULE_ACTIONS,
        description: '操作类型',
      },
      name: { type: 'string', description: '任务名称', optional: true },
      type: { type: 'string', enum: TASK_TYPES, description: '任务类型', optional: true },
      schedule: { type: 'string', description: '调度表达式（interval/cron/once）', optional: true },
      prompt: { type: 'string', description: '要执行的提示词', optional: true },
      useSubagent: { type: 'boolean', description: '在子代理中执行（不打断当前会话）', optional: true },
      notifyOnCompletion: { type: 'boolean', description: '完成后发送 webhook 通知（需配置 webhookUrl）', optional: true },
      maxRunTime: { type: 'number', description: '执行超时秒数（默认 300；仅子代理模式生效）', optional: true },
      tags: { type: 'string[]', description: '任务标签（list 过滤用）', optional: true },
      retries: { type: 'number', description: '失败后额外重试次数（默认 0）', optional: true },
      taskId: { type: 'string', description: '任务 ID（更新/删除/启用/禁用用）', optional: true },
    },
    execute: async (args) => executeScheduleAction(args),
  });
}
