/**
 * enable_tool 条件注册测试
 *
 * 背景：默认（PI_CONTEXT_TOOL_LAYERING 未开启）全部工具 schema 常驻，
 * enable_tool 无操作，只会在模型侧造成空转，故改为仅在分层开启时注册（2026-09-27）。
 * TOOL_LAYERING 是 task-gate.ts 的模块级常量，需 vi.resetModules() 后在目标 env 下重新 import。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// 同 search-tool.test.ts：绕过 vendor/pi 的 TUI/主题模块（注册期不涉及渲染）
vi.mock('@earendil-works/pi-tui', () => ({
  Key: {},
  Container: class {},
  Markdown: class {},
  Spacer: class {},
  Text: class {},
  truncateToWidth: (s: string) => s,
  visibleWidth: (s: string) => s.length,
}));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  getMarkdownTheme: () => ({}),
}));
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

interface FakeTool {
  name: string;
}

/** 覆盖 context/index.ts 注册期会用到的 adapters 出口 */
function makeFakePi() {
  const tools = new Map<string, FakeTool>();
  return {
    tools,
    registerTool: (t: FakeTool) => {
      tools.set(t.name, t);
    },
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    on: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    getActiveTools: () => [] as string[],
    getAllTools: () => [] as string[],
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
}

async function registeredToolNames(): Promise<Set<string>> {
  vi.resetModules();
  const { register } = await import('../index');
  const pi = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  return new Set(pi.tools.keys());
}

afterEach(() => {
  delete process.env.PI_CONTEXT_TOOL_LAYERING;
  vi.resetModules();
});

describe('enable_tool 条件注册', () => {
  it('默认（未开启工具分层）不注册 enable_tool，thinking_level 仍在', async () => {
    delete process.env.PI_CONTEXT_TOOL_LAYERING;
    const names = await registeredToolNames();
    expect(names.has('enable_tool')).toBe(false);
    expect(names.has('thinking_level')).toBe(true);
  });

  it('PI_CONTEXT_TOOL_LAYERING=on 时注册 enable_tool', async () => {
    process.env.PI_CONTEXT_TOOL_LAYERING = 'on';
    const names = await registeredToolNames();
    expect(names.has('enable_tool')).toBe(true);
  });
});
