/**
 * 计划模式 footer 标识（badge:plan）接线测试
 *
 * 背景：计划模式此前只在进入时发一次 notify，界面无任何常驻标识。现在标识同步挂在
 * `applyPlanMode()`（唯一状态出口）上，渲染由 vendor 补丁 009 的 `badge:` 前缀约定承担。
 * 本测试守住"每条状态变更路径都会同步标识"——尤其是 `/plan resume` 里那处曾经绕过
 * applyPlanMode 的直接赋值。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type Handler = (event: unknown, ctx?: unknown) => unknown;

interface FakePi {
  tools: Map<string, { name: string; execute: (...a: unknown[]) => Promise<unknown> }>;
  commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
  shortcuts: Array<{ handler: (ctx: unknown) => Promise<void> | void }>;
  hooks: Map<string, Handler[]>;
  [k: string]: unknown;
}

let plansDir: string;

beforeEach(() => {
  // 任务变化会落盘 plan.md；重定向到临时目录，避免污染 portable/memory
  plansDir = mkdtempSync(join(tmpdir(), 'my-pi-plan-badge-'));
  process.env.PI_PLANS_DIR = plansDir;
});
afterEach(() => {
  delete process.env.PI_PLANS_DIR;
  rmSync(plansDir, { recursive: true, force: true });
});

function makeFakePi(): FakePi {
  const tools = new Map<string, { name: string; execute: (...a: unknown[]) => Promise<unknown> }>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const shortcuts: Array<{ handler: (ctx: unknown) => Promise<void> | void }> = [];
  const hooks = new Map<string, Handler[]>();
  const pi: FakePi = {
    tools,
    commands,
    shortcuts,
    hooks,
    registerTool: (t: { name: string; execute: (...a: unknown[]) => Promise<unknown> }) => {
      tools.set(t.name, t);
    },
    registerCommand: (name: string, opts: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
      commands.set(name, opts);
    },
    registerShortcut: (_key: unknown, opts: { handler: (ctx: unknown) => Promise<void> | void }) => {
      shortcuts.push(opts);
    },
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
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
  return pi;
}

async function setup(): Promise<FakePi> {
  vi.resetModules();
  const { register } = await import('../index');
  const pi = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  return pi;
}

/** 交互式 UI 上下文：工具走扁平签名，命令/快捷键/钩子走 ctx.ui */
function interactiveUI(selectResult = '确认退出') {
  const setStatus = vi.fn();
  const notify = vi.fn();
  // setWidget 是任务面板（overlay.update）要用的；有任务时才会真正调用
  const ui = { setStatus, notify, setWidget: () => {}, select: async () => selectResult };
  return {
    setStatus,
    notify,
    toolCtx: { hasUI: true, ui },
    uiCtx: { hasUI: true, ui },
  };
}

describe('计划模式 footer 标识', () => {
  it('session_start 捕获 UI 并先把标识置为清除态', async () => {
    const pi = await setup();
    const { setStatus, uiCtx } = interactiveUI();
    await pi.hooks.get('session_start')![0]({}, uiCtx);
    expect(setStatus).toHaveBeenCalledWith('badge:plan', undefined);
  });

  it('plan_enter / plan_exit 工具同步标识', async () => {
    const pi = await setup();
    const { setStatus, toolCtx, uiCtx } = interactiveUI();
    await pi.hooks.get('session_start')![0]({}, uiCtx);
    setStatus.mockClear();

    await pi.tools.get('plan_enter')!.execute('c1', {}, undefined, undefined, toolCtx);
    expect(setStatus).toHaveBeenCalledWith('badge:plan', '⏸ 计划模式');

    await pi.tools.get('plan_exit')!.execute('c2', {}, undefined, undefined, toolCtx);
    expect(setStatus).toHaveBeenLastCalledWith('badge:plan', undefined);
  });

  it('Ctrl+Alt+P 快捷键开关都同步标识', async () => {
    const pi = await setup();
    const { setStatus, uiCtx } = interactiveUI();
    await pi.hooks.get('session_start')![0]({}, uiCtx);
    setStatus.mockClear();

    const [shortcut] = pi.shortcuts;
    await shortcut.handler(uiCtx);
    expect(setStatus).toHaveBeenLastCalledWith('badge:plan', '⏸ 计划模式');
    await shortcut.handler(uiCtx);
    expect(setStatus).toHaveBeenLastCalledWith('badge:plan', undefined);
  });

  it('/plan enter|exit 命令同步标识', async () => {
    const pi = await setup();
    const { setStatus, uiCtx } = interactiveUI();
    await pi.hooks.get('session_start')![0]({}, uiCtx);
    setStatus.mockClear();

    const plan = pi.commands.get('plan')!;
    await plan.handler('enter', uiCtx);
    expect(setStatus).toHaveBeenLastCalledWith('badge:plan', '⏸ 计划模式');
    await plan.handler('exit', uiCtx);
    expect(setStatus).toHaveBeenLastCalledWith('badge:plan', undefined);
  });

  it('/plan resume 也清除标识（此前是绕过 applyPlanMode 的直接赋值）', async () => {
    const pi = await setup();
    const { setStatus, toolCtx, uiCtx } = interactiveUI();
    await pi.hooks.get('session_start')![0]({}, uiCtx);
    // 先造一个未完成任务，否则 resume 会因"没有可恢复的计划"提前返回
    await pi.tools.get('todo')!.execute('c0', { action: 'create', subject: '第一步' }, undefined, undefined, toolCtx);
    await pi.tools.get('plan_enter')!.execute('c1', {}, undefined, undefined, toolCtx);
    setStatus.mockClear();

    await pi.commands.get('plan')!.handler('resume', uiCtx);
    expect(setStatus).toHaveBeenCalledWith('badge:plan', undefined);
  });

  it('非交互环境（无 setStatus）不抛错', async () => {
    const pi = await setup();
    await pi.hooks.get('session_start')![0]({}, { hasUI: false });
    await expect(
      pi.tools.get('plan_enter')!.execute('c1', {}, undefined, undefined, { hasUI: false }),
    ).resolves.toBeTruthy();
    await expect(pi.commands.get('plan')!.handler('enter', { hasUI: false, ui: { notify: () => {} } })).resolves.toBeUndefined();
  });
});
