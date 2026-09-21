/**
 * Subagent Feature — TUI 渲染（经 adapters 使用 pi-tui）
 * 迁移自 pi-tools `agent/extensions/subagent/rendering.ts`。
 */

import * as os from 'node:os';
import { Container, Markdown, Spacer, Text, getMarkdownTheme } from '../../../adapters/ui-adapter';
import type { SingleResult, SubagentDetails } from '../core/types';
import { COLLAPSED_ITEM_COUNT, formatUsageStats, getFinalOutput, isFailedResult } from '../core/helpers';

export type DisplayItem = { type: 'text'; text: string } | { type: 'toolCall'; name: string; args: Record<string, unknown> };

interface ThemeLike {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
}

export function getDisplayItems(messages: unknown[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    const m = msg as { role?: string; content?: unknown };
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const part of m.content as { type?: string; text?: string; name?: string; arguments?: Record<string, unknown> }[]) {
      if (part.type === 'text' && typeof part.text === 'string') items.push({ type: 'text', text: part.text });
      else if (part.type === 'toolCall' && part.name) items.push({ type: 'toolCall', name: part.name, args: part.arguments ?? {} });
    }
  }
  return items;
}

export function formatToolCall(toolName: string, args: Record<string, unknown>, themeFg: (color: string, text: string) => string): string {
  const shortenPath = (p: string): string => {
    const home = os.homedir();
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  };
  switch (toolName) {
    case 'bash': {
      const command = (args.command as string) || '...';
      const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return themeFg('muted', '$ ') + themeFg('toolOutput', preview);
    }
    case 'read': {
      const filePath = shortenPath((args.file_path || args.path || '...') as string);
      return themeFg('muted', 'read ') + themeFg('accent', filePath);
    }
    case 'write': {
      return themeFg('muted', 'write ') + themeFg('accent', shortenPath((args.file_path || args.path || '...') as string));
    }
    case 'edit':
      return themeFg('muted', 'edit ') + themeFg('accent', shortenPath((args.file_path || args.path || '...') as string));
    case 'ls':
      return themeFg('muted', 'ls ') + themeFg('accent', shortenPath((args.path || '.') as string));
    case 'find':
      return themeFg('muted', 'find ') + themeFg('accent', (args.pattern || '*') as string);
    case 'grep':
      return themeFg('muted', 'grep ') + themeFg('accent', `/${(args.pattern || '') as string}/`);
    default: {
      const argsStr = JSON.stringify(args);
      const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
      return themeFg('accent', toolName) + themeFg('dim', ` ${preview}`);
    }
  }
}

function renderDisplayItems(items: DisplayItem[], themeFg: (color: string, text: string) => string, limit?: number): string {
  const toShow = limit ? items.slice(-limit) : items;
  const skipped = limit && items.length > limit ? items.length - limit : 0;
  let text = '';
  if (skipped > 0) text += themeFg('muted', `... ${skipped} earlier items\n`);
  for (const item of toShow) {
    if (item.type === 'text') text += `${themeFg('toolOutput', item.text)}\n`;
    else text += `${themeFg('muted', '→ ') + formatToolCall(item.name, item.args, themeFg)}\n`;
  }
  return text.trimEnd();
}

function aggregateUsage(results: SingleResult[]): { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number } {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
  for (const r of results) {
    total.input += r.usage.input;
    total.output += r.usage.output;
    total.cacheRead += r.usage.cacheRead;
    total.cacheWrite += r.usage.cacheWrite;
    total.cost += r.usage.cost;
    total.turns += r.usage.turns;
  }
  return total;
}

export function renderSingleResult(r: SingleResult, expanded: boolean, theme: ThemeLike): Container | Text {
  const mdTheme = getMarkdownTheme();
  const isError = isFailedResult(r);
  const icon = isError ? theme.fg('error', '✗') : theme.fg('success', '✓');
  const displayItems = getDisplayItems(r.messages);
  const finalOutput = getFinalOutput(r.messages);

  if (expanded) {
    const container = new Container();
    let header = `${icon} ${theme.fg('toolTitle', theme.bold(r.agent))}${theme.fg('muted', ` (${r.agentSource})`)}`;
    if (isError && r.stopReason) header += ` ${theme.fg('error', `[${r.stopReason}]`)}`;
    container.addChild(new Text(header, 0, 0));
    if (isError && r.errorMessage) container.addChild(new Text(theme.fg('error', `Error: ${r.errorMessage}`), 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg('muted', '─── Task ───'), 0, 0));
    container.addChild(new Text(theme.fg('dim', r.task), 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg('muted', '─── Output ───'), 0, 0));
    if (displayItems.length === 0 && !finalOutput) {
      container.addChild(new Text(theme.fg('muted', '(no output)'), 0, 0));
    } else {
      for (const item of displayItems) {
        if (item.type === 'toolCall') container.addChild(new Text(theme.fg('muted', '→ ') + formatToolCall(item.name, item.args, theme.fg), 0, 0));
      }
      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      }
    }
    const usageStr = formatUsageStats(r.usage, r.model);
    if (usageStr) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg('dim', usageStr), 0, 0));
    }
    return container;
  }

  let text = `${icon} ${theme.fg('toolTitle', theme.bold(r.agent))}${theme.fg('muted', ` (${r.agentSource})`)}`;
  if (isError && r.stopReason) text += ` ${theme.fg('error', `[${r.stopReason}]`)}`;
  if (isError && r.errorMessage) text += `\n${theme.fg('error', `Error: ${r.errorMessage}`)}`;
  else if (displayItems.length === 0) text += `\n${theme.fg('muted', '(no output)')}`;
  else {
    text += `\n${renderDisplayItems(displayItems, theme.fg, COLLAPSED_ITEM_COUNT)}`;
    if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg('muted', '(Ctrl+O to expand)')}`;
  }
  const usageStr = formatUsageStats(r.usage, r.model);
  if (usageStr) text += `\n${theme.fg('dim', usageStr)}`;
  return new Text(text, 0, 0);
}

export function renderChainResult(details: SubagentDetails, expanded: boolean, theme: ThemeLike): Container | Text {
  const mdTheme = getMarkdownTheme();
  const successCount = details.results.filter((r) => r.exitCode === 0).length;
  const icon = successCount === details.results.length ? theme.fg('success', '✓') : theme.fg('error', '✗');
  const aggregate = formatUsageStats(aggregateUsage(details.results));

  if (expanded) {
    const container = new Container();
    container.addChild(new Text(`${icon} ${theme.fg('toolTitle', theme.bold('chain '))}${theme.fg('accent', `${successCount}/${details.results.length} steps`)}`, 0, 0));
    for (const r of details.results) {
      const rIcon = r.exitCode === 0 ? theme.fg('success', '✓') : theme.fg('error', '✗');
      const displayItems = getDisplayItems(r.messages);
      const finalOutput = getFinalOutput(r.messages);
      container.addChild(new Spacer(1));
      container.addChild(new Text(`${theme.fg('muted', `─── Step ${r.step}: `) + theme.fg('accent', r.agent)} ${rIcon}`, 0, 0));
      container.addChild(new Text(theme.fg('muted', 'Task: ') + theme.fg('dim', r.task), 0, 0));
      for (const item of displayItems) if (item.type === 'toolCall') container.addChild(new Text(theme.fg('muted', '→ ') + formatToolCall(item.name, item.args, theme.fg), 0, 0));
      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      }
      const stepUsage = formatUsageStats(r.usage, r.model);
      if (stepUsage) container.addChild(new Text(theme.fg('dim', stepUsage), 0, 0));
    }
    if (aggregate) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg('dim', `Total: ${aggregate}`), 0, 0));
    }
    return container;
  }

  let text = `${icon} ${theme.fg('toolTitle', theme.bold('chain '))}${theme.fg('accent', `${successCount}/${details.results.length} steps`)}`;
  for (const r of details.results) {
    const rIcon = r.exitCode === 0 ? theme.fg('success', '✓') : theme.fg('error', '✗');
    const displayItems = getDisplayItems(r.messages);
    text += `\n\n${theme.fg('muted', `─── Step ${r.step}: `)}${theme.fg('accent', r.agent)} ${rIcon}`;
    text += displayItems.length === 0 ? `\n${theme.fg('muted', '(no output)')}` : `\n${renderDisplayItems(displayItems, theme.fg, 5)}`;
  }
  if (aggregate) text += `\n\n${theme.fg('dim', `Total: ${aggregate}`)}`;
  text += `\n${theme.fg('muted', '(Ctrl+O to expand)')}`;
  return new Text(text, 0, 0);
}

export function renderParallelResult(details: SubagentDetails, expanded: boolean, theme: ThemeLike): Container | Text {
  const mdTheme = getMarkdownTheme();
  const running = details.results.filter((r) => r.exitCode === -1).length;
  const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
  const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
  const isRunning = running > 0;
  const icon = isRunning ? theme.fg('warning', '⏳') : failCount > 0 ? theme.fg('warning', '◐') : theme.fg('success', '✓');
  const status = isRunning ? `${successCount + failCount}/${details.results.length} done, ${running} running` : `${successCount}/${details.results.length} tasks`;
  const aggregate = formatUsageStats(aggregateUsage(details.results));

  if (expanded && !isRunning) {
    const container = new Container();
    container.addChild(new Text(`${icon} ${theme.fg('toolTitle', theme.bold('parallel '))}${theme.fg('accent', status)}`, 0, 0));
    for (const r of details.results) {
      const rIcon = isFailedResult(r) ? theme.fg('error', '✗') : theme.fg('success', '✓');
      const displayItems = getDisplayItems(r.messages);
      const finalOutput = getFinalOutput(r.messages);
      container.addChild(new Spacer(1));
      container.addChild(new Text(`${theme.fg('muted', '─── ') + theme.fg('accent', r.agent)} ${rIcon}`, 0, 0));
      container.addChild(new Text(theme.fg('muted', 'Task: ') + theme.fg('dim', r.task), 0, 0));
      for (const item of displayItems) if (item.type === 'toolCall') container.addChild(new Text(theme.fg('muted', '→ ') + formatToolCall(item.name, item.args, theme.fg), 0, 0));
      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      }
      const taskUsage = formatUsageStats(r.usage, r.model);
      if (taskUsage) container.addChild(new Text(theme.fg('dim', taskUsage), 0, 0));
    }
    if (aggregate) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg('dim', `Total: ${aggregate}`), 0, 0));
    }
    return container;
  }

  let text = `${icon} ${theme.fg('toolTitle', theme.bold('parallel '))}${theme.fg('accent', status)}`;
  for (const r of details.results) {
    const rIcon = r.exitCode === -1 ? theme.fg('warning', '⏳') : isFailedResult(r) ? theme.fg('error', '✗') : theme.fg('success', '✓');
    const displayItems = getDisplayItems(r.messages);
    text += `\n\n${theme.fg('muted', '─── ')}${theme.fg('accent', r.agent)} ${rIcon}`;
    text += displayItems.length === 0 ? `\n${theme.fg('muted', r.exitCode === -1 ? '(running...)' : '(no output)')}` : `\n${renderDisplayItems(displayItems, theme.fg, 5)}`;
  }
  if (!isRunning && aggregate) text += `\n\n${theme.fg('dim', `Total: ${aggregate}`)}`;
  if (!expanded) text += `\n${theme.fg('muted', '(Ctrl+O to expand)')}`;
  return new Text(text, 0, 0);
}
