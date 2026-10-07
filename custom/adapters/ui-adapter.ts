/**
 * UI Adapter
 * 
 * 职责：封装 Pi 的 UI 相关 API（命令、快捷键、渲染器等）
 * 约束：
 *   - 这是唯一允许 import vendor/pi 的 UI 相关模块的地方
 *   - 对外暴露稳定的 UI 接口
 */

import type { ExtensionAPI, MessageRenderer, ExtensionContext, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { Key, Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { KeyId, AutocompleteItem } from '@earendil-works/pi-tui';
import { getMarkdownTheme as piGetMarkdownTheme } from '@earendil-works/pi-coding-agent';

export { Key, Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth };

/** 供 features 内部模块引用扩展 API 的结构化类型别名（避免直接 import Pi 包） */
export type PiApi = ExtensionAPI;

/** 获取 Markdown 渲染主题（供功能层渲染器使用，避免直接 import vendor/pi） */
export function getMarkdownTheme(): ReturnType<typeof piGetMarkdownTheme> {
  return piGetMarkdownTheme();
}

/**
 * 命令选项
 */
export interface CommandOptions {
  description?: string;
  getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

/**
 * 快捷键选项
 */
export interface ShortcutOptions {
  description?: string;
  handler: (ctx: ExtensionContext) => Promise<void> | void;
}

/**
 * 消息渲染器
 */
export type CustomMessageRenderer<T = unknown> = MessageRenderer<T>;

/**
 * 注册自定义命令
 */
export function registerCommand(pi: ExtensionAPI, name: string, options: CommandOptions): void {
  pi.registerCommand(name, {
    description: options.description,
    getArgumentCompletions: options.getArgumentCompletions,
    handler: options.handler,
  });
}

/**
 * 注册键盘快捷键
 */
export function registerShortcut(pi: ExtensionAPI, shortcut: KeyId, options: ShortcutOptions): void {
  pi.registerShortcut(shortcut, {
    description: options.description,
    handler: options.handler,
  });
}

/**
 * 注册自定义消息渲染器
 */
export function registerMessageRenderer<T = unknown>(
  pi: ExtensionAPI,
  customType: string,
  renderer: CustomMessageRenderer<T>
): void {
  pi.registerMessageRenderer(customType, renderer);
}

/**
 * 发送自定义消息
 */
export function sendMessage<T = unknown>(
  pi: ExtensionAPI,
  message: {
    customType: string;
    content: string;
    display: boolean;
    details?: T;
  },
  options?: {
    triggerTurn?: boolean;
    deliverAs?: 'steer' | 'followUp' | 'nextTurn';
  }
): void {
  pi.sendMessage(message, options);
}

/**
 * 延后一小段时间再发"会触发回合"的自定义消息。
 *
 * 为什么不能在 `session_start` 里同步触发：pi 的会话替换（`/resume`、崩溃恢复后的 `--session`
 * 续接）顺序是 `teardownCurrent` → `createRuntime`（**这里发出 session_start**）→
 * `finishSessionReplacement` → `rebindSession`（把新会话绑回 TUI/扩展宿主）。在 session_start 里
 * 立刻触发回合，回复可能落在"换绑前的会话"上被丢弃——实测：请求与响应都发生了、也没有任何报错，
 * 但 assistant 条目偶发不落盘（重启后"自动续跑"看起来毫无反应）。延后触发让宿主接线先完成。
 *
 * 延迟可用 `PI_RESTART_RESUME_DELAY_MS` 覆盖（测试里设 0）。
 *
 * 2026-10-07 否掉过一版"正序事件"替代方案（用 vendor 事件换掉延时）：给 pi 加 `session_rebound`
 * 事件（在 `finishSessionReplacement` 末尾发）只覆盖**进程内**会话替换，而我们的重启路径是
 * **新进程 + `--session`**——那条路不走会话替换（`main.ts` 不调用 `finishSessionReplacement`），
 * 事件永不触发。判别性实测：`PI_RESTART_RESUME_DELAY_MS=120000` 跑单实例真实 pty 场景 → **2/33**
 * （续跑没发生），默认 600ms 兜底则 33/33——说明一直起作用的是延时，不是 rebind 顺序。
 * 结论：保留延时，并把"新进程里究竟何时才可安全注入"记为**未定位**（见 `DECISIONS.md`）。
 *
 * 后续（2026-10-07 无头硬指标实验，见 DECISIONS）：在 `session_start` 用 `triggerTurn` 会被 pi **直接拒绝**
 * （`Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.`，
 * 进程 rc=1、什么都没落盘）；`deliverAs:'followUp'` 不报错、消息落盘，但不保证起回合。也就是说这里的
 * "延时"是在绕开一个**非法时序**，正解可能是"排队优先"（`steer`/空闲态 `followUp` 两组实验待做）。
 */
export function sendMessageAfterRebind(
  pi: ExtensionAPI,
  message: { customType: string; content: string; display: boolean },
  delayMs = 600,
): void {
  const raw = Number(process.env.PI_RESTART_RESUME_DELAY_MS);
  const delay = Number.isFinite(raw) && raw >= 0 ? raw : delayMs;
  const fire = () => {
    try {
      sendMessage(pi, message, { triggerTurn: true });
    } catch {
      /* 会话可能已关闭：放弃这次唤醒（通知本身已进 restartLog 的上下文） */
    }
  };
  if (delay === 0) {
    fire();
    return;
  }
  const timer = setTimeout(fire, delay);
  timer.unref?.();
}

/**
 * 发送用户消息
 */
export function sendUserMessage(
  pi: ExtensionAPI,
  content: string | Array<{ type: 'text'; text: string }>,
  options?: {
    deliverAs?: 'steer' | 'followUp';
    expandPromptTemplates?: boolean;
  }
): void {
  pi.sendUserMessage(content, options);
}

/**
 * 追加条目到会话（用于状态持久化）
 */
export function appendEntry<T = unknown>(pi: ExtensionAPI, customType: string, data?: T): void {
  pi.appendEntry(customType, data);
}

/**
 * 获取活跃工具列表
 */
export function getActiveTools(pi: ExtensionAPI): string[] {
  return pi.getActiveTools();
}

/**
 * 设置活跃工具列表
 */
export function setActiveTools(pi: ExtensionAPI, toolNames: string[]): void {
  pi.setActiveTools(toolNames);
}

/**
 * 获取全部已注册工具名（用于退出受限模式时恢复全量工具）
 */
export function getAllToolNames(pi: ExtensionAPI): string[] {
  return pi.getAllTools().map((t) => t.name);
}

/**
 * 获取 CLI 标志值
 */
export function getFlag(pi: ExtensionAPI, name: string): boolean | string | undefined {
  return pi.getFlag(name);
}

/**
 * 获取当前思考级别
 */
export function getThinkingLevel(pi: ExtensionAPI): string {
  return pi.getThinkingLevel();
}

/**
 * 设置思考级别（运行时立即生效）
 */
export function setThinkingLevel(pi: ExtensionAPI, level: string): void {
  pi.setThinkingLevel(level as Parameters<ExtensionAPI['setThinkingLevel']>[0]);
}

/**
 * 注册 CLI 标志
 */
export function registerFlag(
  pi: ExtensionAPI,
  name: string,
  options: {
    description?: string;
    type: 'boolean';
    default?: boolean;
  } | {
    description?: string;
    type: 'string';
    default?: string;
  }
): void {
  pi.registerFlag(name, options);
}