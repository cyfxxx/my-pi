/**
 * Plan-mode Feature — 任务面板（TodoOverlay，经 adapters 使用 pi-tui）
 * 迁移自 pi-tools `agent/extensions/plan-mode/overlay.ts`。
 * 通过 ctx.ui.setWidget 注册 aboveEditor 面板；全部完成时隐藏。
 */

import { truncateToWidth, visibleWidth } from '../../../adapters/ui-adapter';
import { getState } from '../core/store';
import { selectHasActive, selectOverlayLayout, selectTodoCounts } from '../core/selectors';
import { formatStatusLabel } from './view';
import type { Task } from '../core/state';

type TaskStatus = Task['status'];

interface ThemeLike {
  fg: (color: string, text: string) => string;
}

interface UICtxLike {
  setWidget: (
    key: string,
    content: unknown,
    options?: { placement?: string },
  ) => void;
}

interface TuiLike {
  requestRender?: () => void;
}

const WIDGET_KEY = 'plan-todos';
const MAX_WIDGET_LINES = 12;

export class TodoOverlay {
  private uiCtx: UICtxLike | undefined;
  private widgetRegistered = false;
  private tui: TuiLike | undefined;
  private completedPendingHide = new Set<number>();
  private hiddenCompleted = new Set<number>();
  private lastNextId: number | undefined;

  setUICtx(ctx: UICtxLike): void {
    if (ctx !== this.uiCtx) {
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
    }
  }

  update(): void {
    if (!this.uiCtx) return;
    const snapshot = this.getSnapshot();
    const visible = this.selectVisible(snapshot);

    if (visible.length === 0 || visible.every((t) => t.status === 'completed')) {
      if (this.widgetRegistered) {
        this.uiCtx.setWidget(WIDGET_KEY, undefined);
        this.widgetRegistered = false;
        this.tui = undefined;
      }
      return;
    }

    if (!this.widgetRegistered) {
      this.uiCtx.setWidget(
        WIDGET_KEY,
        (tui: TuiLike, theme: ThemeLike) => {
          this.tui = tui;
          return {
            render: (width: number) => this.renderWidget(theme, width),
            invalidate: () => {
              this.widgetRegistered = false;
              this.tui = undefined;
            },
          };
        },
        { placement: 'aboveEditor' },
      );
      this.widgetRegistered = true;
    } else {
      this.tui?.requestRender?.();
    }
  }

  resetCompletedDisplayState(): void {
    this.completedPendingHide.clear();
    this.hiddenCompleted.clear();
    this.lastNextId = undefined;
  }

  hide(): void {
    if (this.widgetRegistered && this.uiCtx) {
      this.uiCtx.setWidget(WIDGET_KEY, undefined);
      this.widgetRegistered = false;
      this.tui = undefined;
    }
  }

  dispose(): void {
    if (this.uiCtx) this.uiCtx.setWidget(WIDGET_KEY, undefined);
    this.widgetRegistered = false;
    this.tui = undefined;
    this.uiCtx = undefined;
    this.resetCompletedDisplayState();
  }

  private getSnapshot(): readonly Task[] {
    const state = getState();
    if (this.lastNextId !== undefined && state.nextId < this.lastNextId) this.resetCompletedDisplayState();
    this.lastNextId = state.nextId;
    const completedIds = new Set(state.tasks.filter((t) => t.status === 'completed').map((t) => t.id));
    for (const id of this.completedPendingHide) if (!completedIds.has(id)) this.completedPendingHide.delete(id);
    for (const id of this.hiddenCompleted) if (!completedIds.has(id)) this.hiddenCompleted.delete(id);
    return [...state.tasks];
  }

  private selectVisible(tasks: readonly Task[]): Task[] {
    return tasks.filter((t) => t.status !== 'deleted' && !(t.status === 'completed' && this.hiddenCompleted.has(t.id)));
  }

  private renderWidget(theme: ThemeLike, width: number): string[] {
    const tasks = this.getSnapshot();
    const visible = this.selectVisible(tasks);
    if (visible.length === 0) return [];

    const allState = { tasks: [...tasks], nextId: tasks.length ? Math.max(...tasks.map((t) => t.id)) + 1 : 1 };
    const counts = selectTodoCounts(allState);
    const hasActive = selectHasActive({ tasks: visible, nextId: 0 });

    const headingColor = hasActive ? 'accent' : 'dim';
    const headingIcon = hasActive ? '●' : '○';
    let heading = `${theme.fg(headingColor, headingIcon)} ${theme.fg(headingColor, `计划 (${counts.completed}/${counts.total})`)}`;

    const active = visible.find((t) => t.status === 'in_progress');
    if (active) {
      const headingWidth = visibleWidth(heading);
      const maxSubject = Math.max(10, width - headingWidth - 14);
      heading += ` ${theme.fg('warning', `▶ ${truncateToWidth(active.subject, maxSubject, '…')}`)}`;
    }

    const lines: string[] = [heading];
    const layout = selectOverlayLayout({ tasks: visible, nextId: 0 }, MAX_WIDGET_LINES - 1);
    for (const task of layout.visible) lines.push(this.formatCheckboxLine(task, theme, width));

    for (const task of visible) {
      if (task.status === 'completed' && !this.completedPendingHide.has(task.id) && !this.hiddenCompleted.has(task.id)) {
        this.completedPendingHide.add(task.id);
      }
    }

    if (layout.hiddenCompleted === 0 && layout.truncatedTail === 0) return this.withTrailingSpacer(lines);

    const totalHidden = layout.hiddenCompleted + layout.truncatedTail;
    const parts: string[] = [];
    if (layout.hiddenCompleted > 0) parts.push(`${layout.hiddenCompleted} ${formatStatusLabel('completed')}`);
    if (layout.truncatedTail > 0) parts.push(`${layout.truncatedTail} ${formatStatusLabel('pending')}`);
    lines.push(`${theme.fg('dim', totalHidden > 0 ? `+${totalHidden} 更多 (${parts.join(', ')})` : `+${totalHidden} 更多`)}`);
    return this.withTrailingSpacer(lines.map((l) => (l ? truncateToWidth(l, width, '…') : l)));
  }

  private formatCheckboxLine(task: { id: number; subject: string; status: TaskStatus; activeForm?: string }, theme: ThemeLike, width: number): string {
    const check =
      task.status === 'completed' ? '[✓]' : task.status === 'in_progress' ? '[•]' : task.status === 'blocked' ? '[⏸]' : '[ ]';
    const color = task.status === 'in_progress' ? 'warning' : 'dim';
    const prefix = `${theme.fg(color, check)} `;
    const prefixWidth = visibleWidth(prefix);
    const form = task.status === 'in_progress' && task.activeForm ? `(${task.activeForm})` : '';
    const formWidth = form ? visibleWidth(form) : 0;
    const subjectAvail = Math.max(8, width - prefixWidth - (form ? formWidth + 3 : 0));
    const subject = truncateToWidth(task.subject, subjectAvail, '…');
    let line = `${theme.fg(color, check)} ${theme.fg(color, subject)}`;
    if (form) {
      const rest = Math.max(0, width - visibleWidth(line));
      if (rest >= formWidth + 1) line += ` ${theme.fg('dim', form)}`;
      else if (rest >= 3) line += ` ${theme.fg('dim', truncateToWidth(form, Math.max(1, rest - 1), '…'))}`;
    }
    return truncateToWidth(line, width, '…');
  }

  private withTrailingSpacer(lines: string[]): string[] {
    if (lines.length === 0) return lines;
    lines.push('');
    return lines;
  }
}
