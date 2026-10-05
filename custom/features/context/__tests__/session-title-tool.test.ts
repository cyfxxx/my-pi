/**
 * session_title 工具接线测试
 *
 * 验证链路：context 注册的工具 → tool-adapter 包装 → 由 ExtensionAPI.setSessionName
 * 桥接出的 ToolExecuteContext.setSessionTitle。标题只写会话元数据（append-only）、
 * 不进 LLM 上下文，故这里断言"pi 收到的已规范化标题"与空标题/无能力时的降级分支。
 *
 * 覆盖范围偏窄的说明：本用例只钉住接线与规范化；标题对前缀缓存无影响是由
 * `session_info` 元数据本身的性质保证的（不进消息数组），无需也无法在此断言。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    piCtx?: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>;
}

/** 覆盖 context/index.ts 注册期会用到的 adapters 出口；`names` 记录 setSessionName 的入参 */
function makeFakePi(withSetSessionName = true) {
  const tools = new Map<string, CapturedTool>();
  const names: string[] = [];
  const pi: Record<string, unknown> = {
    tools,
    names,
    registerTool: (t: CapturedTool) => {
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
  if (withSetSessionName) {
    pi.setSessionName = (name: string) => {
      names.push(name);
    };
  }
  return pi;
}

async function loadContext(withSetSessionName = true) {
  vi.resetModules();
  const { register } = await import('../index');
  const pi = makeFakePi(withSetSessionName);
  register(pi as unknown as ExtensionAPI);
  return { pi, tool: (pi.tools as Map<string, CapturedTool>).get('session_title')! };
}

afterEach(() => {
  vi.resetModules();
});

describe('session_title 工具接线', () => {
  it('把规范化后的标题写入会话元数据', async () => {
    const { pi, tool } = await loadContext();
    const res = await tool.execute('call', { title: '  优化\n\n任务   流畅度 ' }, undefined, undefined, {
      hasUI: false,
    });
    expect(pi.names).toEqual(['优化 任务 流畅度']);
    expect(res.content[0]?.text).toContain('优化 任务 流畅度');
  });

  it('空标题不写入（不清掉已有标题）', async () => {
    const { pi, tool } = await loadContext();
    const res = await tool.execute('call', { title: '   \n ' }, undefined, undefined, { hasUI: false });
    expect(pi.names).toEqual([]);
    expect(res.content[0]?.text).toContain('未设置');
  });

  it('pi 未提供 setSessionName 时明确降级，不抛错', async () => {
    const { pi, tool } = await loadContext(false);
    const res = await tool.execute('call', { title: '标题' }, undefined, undefined, { hasUI: false });
    expect(pi.names).toEqual([]);
    expect(res.content[0]?.text).toContain('不支持');
  });
});
