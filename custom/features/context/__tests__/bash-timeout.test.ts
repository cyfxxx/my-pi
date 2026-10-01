/**
 * `bash` 前台默认上限（硬约束）测试
 *
 * 背景（2026-10-01 实测，1101 个可归属步）：工具执行占步墙钟 **63.6%**，其中 `bash` 占工具时间
 * **63%**（p50 440ms / p90 36.4s / p99 164s；pi 的 bash 默认**无超时**）。而前缀重放只占请求处理
 * 时间的 0.5%——顿挫感的元凶是前台长命令。AGENTS.md 里的"长任务后台化"是软提示、没被稳定遵守，
 * 故按 VISION §3.2（硬优先）在 `tool_call` 钩子里注入上限：模型未显式给 timeout 时设默认值，
 * 显式给了就原样尊重。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type Handler = (event: unknown, ctx?: unknown) => unknown;

function makeFakePi(): { pi: unknown; hooks: Map<string, Handler[]> } {
  const hooks = new Map<string, Handler[]>();
  const pi = {
    registerTool: () => {},
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
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
  return { pi, hooks };
}

async function toolCallHook(): Promise<Handler> {
  vi.resetModules();
  const { register } = await import('../index');
  const { pi, hooks } = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  const hs = hooks.get('tool_call') ?? [];
  expect(hs.length).toBeGreaterThan(0);
  return hs[hs.length - 1];
}

afterEach(() => {
  delete process.env.PI_BASH_TIMEOUT_CEIL;
  vi.resetModules();
});

describe('bash 前台默认上限', () => {
  it('未显式给 timeout → 注入默认上限（240s）', async () => {
    delete process.env.PI_BASH_TIMEOUT_CEIL;
    const hook = await toolCallHook();
    const event = { toolName: 'bash', input: { command: 'sleep 9999' } as Record<string, unknown> };
    await hook(event);
    expect(event.input.timeout).toBe(240);
  });

  it('显式给了 timeout → 原样尊重（有意放宽，不覆盖）', async () => {
    const hook = await toolCallHook();
    const event = { toolName: 'bash', input: { command: 'bash scripts/golden-tasks.sh', timeout: 600 } };
    await hook(event);
    expect(event.input.timeout).toBe(600);
  });

  it('非法/非正的 timeout 视为未给 → 注入上限', async () => {
    const hook = await toolCallHook();
    for (const bad of [0, -1, Number.NaN, '60' as unknown as number]) {
      const event = { toolName: 'bash', input: { command: 'x', timeout: bad } as Record<string, unknown> };
      await hook(event);
      expect(event.input.timeout).toBe(240);
    }
  });

  it('非 bash 工具不受影响', async () => {
    const hook = await toolCallHook();
    const event = { toolName: 'read', input: { file_path: '/x' } as Record<string, unknown> };
    await hook(event);
    expect(event.input.timeout).toBeUndefined();
  });

  it('PI_BASH_TIMEOUT_CEIL<=0 可关闭该硬约束（本地模型/特殊环境）', async () => {
    process.env.PI_BASH_TIMEOUT_CEIL = '0';
    vi.resetModules();
    const { BASH_TIMEOUT_CEIL_S } = await import('../budget/task-gate');
    expect(BASH_TIMEOUT_CEIL_S).toBe(0);
    const hook = await toolCallHook();
    const event = { toolName: 'bash', input: { command: 'x' } as Record<string, unknown> };
    await hook(event);
    expect(event.input.timeout).toBe(0);
  });
});
