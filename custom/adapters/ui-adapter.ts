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