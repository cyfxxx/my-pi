/**
 * 计划模式只读保护（tool_call 拦截）测试
 *
 * 背景：plan 模式改为在 tool_call 阶段拦截，不再 setActiveTools 切换工具集
 * （切换会让整段前缀缓存失效）。bash 判定沿用 core/readonly.ts 的
 * isReadonlyBashCommand（fail-closed，仅放行只读单命令）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type Handler = (event: unknown, ctx?: unknown) => unknown;

interface FakePi {
  tools: Map<string, { name: string; execute: (...a: unknown[]) => Promise<string> }>;
  hooks: Map<string, Handler[]>;
  setActiveToolsCalls: number;
  [k: string]: unknown;
}

function makeFakePi(): FakePi {
  const tools = new Map<string, { name: string; execute: (...a: unknown[]) => Promise<string> }>();
  const hooks = new Map<string, Handler[]>();
  const pi: FakePi = {
    tools,
    hooks,
    setActiveToolsCalls: 0,
    registerTool: (t: { name: string; execute: (...a: unknown[]) => Promise<string> }) => {
      tools.set(t.name, t);
    },
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    on: (ev: string, h: Handler) => {
      const arr = hooks.get(ev) ?? [];
      arr.push(h);
      hooks.set(ev, arr);
    },
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    getActiveTools: () => ['read', 'bash', 'edit', 'write'],
    getAllTools: () => ['read', 'bash', 'edit', 'write'],
    setActiveTools: () => {
      pi.setActiveToolsCalls += 1;
    },
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
  return pi;
}

async function setup(): Promise<{ pi: FakePi; guard: Handler }> {
  vi.resetModules();
  const { register } = await import('../index');
  const pi = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  const guards = pi.hooks.get('tool_call') ?? [];
  expect(guards.length).toBe(1);
  return { pi, guard: guards[0] };
}

describe('计划模式只读保护', () => {
  it('进入计划模式不切换工具集（避免前缀缓存断裂）', async () => {
    const { pi } = await setup();
    await pi.tools.get('plan_enter')!.execute('c1', {}, undefined, undefined, {});
    expect(pi.setActiveToolsCalls).toBe(0);
  });

  it('非计划模式下放行', async () => {
    const { guard } = await setup();
    expect(await guard({ toolName: 'edit', input: {} })).toBeUndefined();
    expect(await guard({ toolName: 'bash', input: { command: 'rm -rf /' } })).toBeUndefined();
  });

  it('计划模式下 edit/write 被阻止', async () => {
    const { pi, guard } = await setup();
    await pi.tools.get('plan_enter')!.execute('c1', {}, undefined, undefined, {});
    expect(await guard({ toolName: 'edit', input: {} })).toMatchObject({ block: true });
    expect(await guard({ toolName: 'write', input: {} })).toMatchObject({ block: true });
  });

  it('计划模式下 bash 只放行只读单命令', async () => {
    const { pi, guard } = await setup();
    await pi.tools.get('plan_enter')!.execute('c1', {}, undefined, undefined, {});
    expect(await guard({ toolName: 'bash', input: { command: 'ls -la' } })).toBeUndefined();
    expect(await guard({ toolName: 'bash', input: { command: 'git status' } })).toBeUndefined();
    expect(await guard({ toolName: 'bash', input: { command: 'rm -rf /tmp/x' } })).toMatchObject({ block: true });
    expect(await guard({ toolName: 'bash', input: { command: 'echo hi > /etc/passwd' } })).toMatchObject({ block: true });
  });
});
