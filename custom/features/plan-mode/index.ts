/**
 * Plan-mode Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/plan-mode/{index,commands,todo}.ts`（核心部分）：
 * 任务状态机 + `todo` 工具 + `/plan` 命令 + 只读探索强制 + Ctrl+Alt+P 快捷键。
 * 未迁移（后续）：计划文件 git 版本化、events.ts 的上下文注入/自动完成流程。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import {
  registerCommand,
  registerShortcut,
  sendMessage,
  setActiveTools,
  getActiveTools,
  getAllToolNames,
  appendEntry,
  Key,
} from '../../adapters/ui-adapter';
import {
  applyTaskMutation,
  commitState,
  getState,
  resetState,
  selectTasksByStatus,
  selectTodoCounts,
  selectVisibleTasks,
  formatListLine,
  formatGetLines,
  formatCommandTaskLine,
  isReadonlyBashCommand,
} from './logic';
import type { TaskAction, TaskMutationParams, Op, TaskState, Task } from './logic';
import { TodoOverlay } from './ui/overlay';

const STATUS_LABEL: Record<string, string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  deleted: '已删除',
};

function formatContent(op: Op, state: TaskState): string {
  switch (op.kind) {
    case 'create': {
      const t = state.tasks.find((x) => x.id === op.taskId);
      return t ? `已创建 #${t.id}: ${t.subject} (${STATUS_LABEL[t.status]})` : `已创建 #${op.taskId}`;
    }
    case 'update': {
      const transition = op.fromStatus !== op.toStatus ? ` (${STATUS_LABEL[op.fromStatus]} → ${STATUS_LABEL[op.toStatus]})` : '';
      return `已更新 #${op.id}${transition}${op.failure ? ' +失败记录' : ''}`;
    }
    case 'delete':
      return `已删除 #${op.id}: ${op.subject}`;
    case 'clear':
      return `已清空 ${op.count} 个任务`;
    case 'list': {
      let view = state.tasks;
      if (!op.includeDeleted) view = view.filter((t) => t.status !== 'deleted');
      if (op.statusFilter) view = view.filter((t) => t.status === op.statusFilter);
      return view.length === 0 ? '暂无任务' : view.map(formatListLine).join('\n');
    }
    case 'get':
      return formatGetLines(op.task);
    case 'error':
      return op.message;
  }
}

const PLAN_USAGE = [
  '/plan                  切换规划模式',
  '/plan enter            进入规划模式（只读探索）',
  '/plan exit             退出规划模式（保留任务）',
  '/plan clear            清空所有计划任务',
  '/plan resume           恢复执行模式并继续未完成计划',
  '/plan todos            按状态分组显示所有计划任务',
  '/plan help             显示本帮助',
].join('\n');

export function register(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  // 进入计划模式前的活跃工具集合：退出时恢复原集合，而不是"全部工具"，
  // 以免抹掉进入前用户/其他 feature 已禁用的工具。
  let savedActiveTools: string[] | null = null;
  const overlay = new TodoOverlay();

  const restoreAllTools = (): void => {
    if (savedActiveTools) {
      setActiveTools(pi, savedActiveTools);
      savedActiveTools = null;
    } else {
      setActiveTools(pi, getAllToolNames(pi));
    }
  };

  const applyPlanMode = (enabled: boolean): void => {
    planModeEnabled = enabled;
    if (enabled) {
      savedActiveTools = getActiveTools(pi);
      setActiveTools(
        pi,
        savedActiveTools.filter((t) => !['edit', 'write', 'bash'].includes(t)),
      );
    } else {
      restoreAllTools();
    }
    appendEntry(pi, 'plan-mode', { enabled, timestamp: Date.now() });
  };

  // ── todo 工具 ──
  registerTool(pi, {
    name: 'todo',
    description:
      '管理任务列表以跟踪多步骤进度。操作: create/update/list/get/delete/clear。状态: pending → in_progress → completed；blocked 表示阻塞；delete 归档。',
    parameters: {
      action: { type: 'string', enum: ['create', 'update', 'list', 'get', 'delete', 'clear'], description: '操作类型' },
      subject: { type: 'string', description: '任务标题（create 必填）', optional: true },
      description: { type: 'string', description: '任务详细描述', optional: true },
      activeForm: { type: 'string', description: "进行中标签（如 '正在编写测试'）", optional: true },
      failure: { type: 'string', description: '追加失败记录（最多保留 3 条）', optional: true },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked', 'deleted'], description: '目标状态/过滤条件', optional: true },
      id: { type: 'number', description: '任务 ID（update/get/delete 必填）', optional: true },
      includeDeleted: { type: 'boolean', description: 'list 是否含已归档', optional: true },
    },
    execute: async (params) => {
      const action = params.action as TaskAction | undefined;
      if (!action || !['create', 'update', 'list', 'get', 'delete', 'clear'].includes(action)) {
        return 'Error: action required: create, update, list, get, delete, or clear';
      }
      const result = applyTaskMutation(getState(), action, params as TaskMutationParams);
      commitState(result.state);
      try {
        overlay.update();
      } catch {
        /* UI 不可用时忽略 */
      }
      const text = formatContent(result.op, result.state);
      return result.op.kind === 'error' ? `Error: ${text}` : text;
    },
  });

  // ── /plan 命令 ──
  registerCommand(pi, 'plan', {
    description: '计划模式：只读探索与任务跟踪 (usage: /plan <enter|exit|clear|resume|todos|help>)',
    getArgumentCompletions: (prefix) => {
      const subs = ['enter', 'exit', 'clear', 'resume', 'todos', 'help'];
      const filtered = subs.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const sub = (args.trim().split(/\s+/)[0] || '').toLowerCase();
      try {
        overlay.setUICtx(ctx.ui as never);
      } catch {
        /* 非交互环境 */
      }

      if (sub === 'help' || sub === '') {
        ctx.ui.notify(PLAN_USAGE, 'info');
        return;
      }
      if (sub === 'enter' || sub === 'on') {
        if (!planModeEnabled) applyPlanMode(true);
        overlay.update();
        ctx.ui.notify('计划模式已启用。编辑/写入/bash 工具已禁用（只读探索）。', 'info');
        return;
      }
      if (sub === 'exit' || sub === 'off') {
        if (planModeEnabled) applyPlanMode(false);
        overlay.update();
        ctx.ui.notify('计划模式已禁用。完整访问已恢复。', 'info');
        return;
      }
      if (sub === 'toggle') {
        applyPlanMode(!planModeEnabled);
        overlay.update();
        ctx.ui.notify(planModeEnabled ? '计划模式已启用。' : '计划模式已禁用。', 'info');
        return;
      }
      if (sub === 'clear') {
        const count = getState().tasks.filter((t) => t.status !== 'deleted').length;
        resetState();
        overlay.update();
        ctx.ui.notify(`已清空 ${count} 个计划任务。`, 'info');
        return;
      }
      if (sub === 'resume') {
        const remaining = selectVisibleTasks(getState()).filter((t) => t.status !== 'completed');
        if (remaining.length === 0) {
          ctx.ui.notify('没有可恢复的计划任务。请先 /plan enter 创建计划。', 'info');
          return;
        }
        planModeEnabled = false;
        restoreAllTools();
        overlay.update();
        appendEntry(pi, 'plan-mode', { enabled: false, timestamp: Date.now() });
        sendMessage(
          pi,
          {
            customType: 'plan-mode-execute',
            content: `继续执行计划。剩余 ${remaining.length} 步，从以下步骤开始: ${remaining[0].subject}`,
            display: true,
          },
          { triggerTurn: true },
        );
        return;
      }
      if (sub === 'todos') {
        const state = getState();
        if (selectVisibleTasks(state).length === 0) {
          ctx.ui.notify('暂无计划任务。请先让 Agent 创建计划。', 'info');
          return;
        }
        const groups = selectTasksByStatus(state);
        const counts = selectTodoCounts(state);
        const header: string[] = [];
        if (counts.completed > 0) header.push(`${counts.completed}/${counts.total} 已完成`);
        if (counts.inProgress > 0) header.push(`${counts.inProgress} 进行中`);
        if (counts.blocked > 0) header.push(`${counts.blocked} 已阻塞`);
        if (counts.pending > 0) header.push(`${counts.pending} 待办`);
        const lines: string[] = [header.join(' · ')];
        const push = (label: string, list: readonly Task[], glyph: string): void => {
          if (list.length === 0) return;
          lines.push(`── ${label} ──`);
          for (const t of list) lines.push(formatCommandTaskLine(t, glyph));
        };
        push('待办', groups.pending, '○');
        push('进行中', groups.inProgress, '◐');
        push('已阻塞', groups.blocked, '⏸');
        push('已完成', groups.completed, '✓');
        ctx.ui.notify(lines.join('\n'), 'info');
        return;
      }
      if (sub === 'status') {
        ctx.ui.notify(`计划模式: ${planModeEnabled ? '已启用' : '已禁用'}`, 'info');
        return;
      }
      ctx.ui.notify(`未知子命令: ${sub}\n\n${PLAN_USAGE}`, 'info');
    },
  });

  // ── 快捷键 Ctrl+Alt+P ──
  registerShortcut(pi, Key.ctrlAlt('p'), {
    description: '切换计划模式 (Ctrl+Alt+P)',
    handler: async (ctx) => {
      applyPlanMode(!planModeEnabled);
      if (ctx.hasUI) {
        ctx.ui.notify(planModeEnabled ? '计划模式已启用。编辑工具已禁用。' : '计划模式已禁用。完整访问已恢复。', 'info');
      }
    },
  });

  // ── 只读强制：计划模式下阻止编辑/写入与非只读 bash ──
  registerHook(pi, {
    event: 'tool_call',
    handler: async (event) => {
      if (!planModeEnabled) return;
      const e = event as { toolName?: string; input?: unknown };
      if (e.toolName === 'edit' || e.toolName === 'write') {
        return { block: true, reason: '计划模式：编辑/写入被禁用。使用 /plan exit 退出。' };
      }
      if (e.toolName === 'bash') {
        const input = e.input as { command?: string } | undefined;
        const cmd = input?.command ?? '';
        if (cmd && !isReadonlyBashCommand(cmd)) {
          return { block: true, reason: '计划模式：仅允许只读 bash 命令。使用 /plan exit 退出。' };
        }
      }
    },
  });

  // ── 会话启动提示 ──
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      try {
        overlay.setUICtx(ctx.ui as never);
        overlay.update();
      } catch {
        /* 非交互环境 */
      }
      if (ctx.hasUI) ctx.ui.notify('计划模式已就绪（/plan help）', 'info');
    },
  });

  registerHook(pi, {
    event: 'session_shutdown',
    handler: async () => {
      overlay.dispose();
    },
  });
}
