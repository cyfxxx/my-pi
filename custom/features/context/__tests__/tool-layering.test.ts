/**
 * tool-layering 接线测试（默认全部常驻）
 *
 * 回归背景（2026-09-26）：工具 schema 在请求最前处，`enable_tool` 一改工具列表就整段断前缀缓存
 * （实测单次 $0.01–0.04，重启后复位还要再付一次），故默认关闭按需加载、全部工具常驻。
 * 本测试锁定接线层行为：默认不裁剪 + enable 变无操作 + 报告口径；开关打开时恢复旧行为。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { PiApi } from '../../../adapters/ui-adapter';

// ui-adapter 在运行时 import @earendil-works/pi-tui（TUI 组件），测试环境未安装该包；
// 这里只替换三个纯转发函数，接线逻辑本身仍是真实实现。
vi.mock('../../../adapters/ui-adapter', () => ({
  getAllToolNames: (pi: { getAllToolNames: () => string[] }) => pi.getAllToolNames(),
  getActiveTools: (pi: { getActiveTools: () => string[] }) => pi.getActiveTools(),
  setActiveTools: (pi: { setActiveTools: (n: string[]) => void }, names: string[]) =>
    pi.setActiveTools(names),
}));

const ALL = [
  'read',
  'bash',
  'memory_store',
  'browser_navigate',
  'browser_evaluate',
  'web_fetch',
  'some_future_tool',
];

function fakePi(): { pi: PiApi; active: () => string[] } {
  let active = [...ALL];
  const pi = {
    getAllToolNames: () => [...ALL],
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active = [...names];
    },
  };
  return { pi: pi as unknown as PiApi, active: () => active };
}

afterEach(() => {
  delete process.env.PI_CONTEXT_TOOL_LAYERING;
  vi.resetModules();
});

describe('tool-layering：默认全部常驻', () => {
  it('applyToolLayering 不做裁剪（含休眠名单工具与未知工具）', async () => {
    delete process.env.PI_CONTEXT_TOOL_LAYERING;
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi, active } = fakePi();
    mod.applyToolLayering(pi);
    expect(active()).toEqual(ALL);
    expect(active()).toContain('browser_navigate');
  });

  it('dormantToolsActive 恒为 false（不再触发分层自愈回调）', async () => {
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi } = fakePi();
    expect(mod.dormantToolsActive(pi)).toBe(false);
  });

  it('enableGroup 变为无操作并说明原因（不再改动工具列表）', async () => {
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi, active } = fakePi();
    const r = mod.enableGroup(pi, 'browser-core');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('工具按需加载已关闭');
    expect(active()).toEqual(ALL);
  });

  it('buildToolsReport 汇报"全部常驻"而非休眠分组', async () => {
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi } = fakePi();
    const report = mod.buildToolsReport(pi);
    expect(report).toContain('全部常驻');
    expect(report).not.toContain('[休眠]');
  });
});

describe('tool-layering：PI_CONTEXT_TOOL_LAYERING=on 恢复休眠分层', () => {
  it('applyToolLayering 裁掉未启用休眠组，未知工具保留', async () => {
    process.env.PI_CONTEXT_TOOL_LAYERING = 'on';
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi, active } = fakePi();
    mod.applyToolLayering(pi);
    expect(active()).not.toContain('browser_navigate');
    expect(active()).toContain('read');
    expect(active()).toContain('some_future_tool');
  });

  it('enableGroup 把该组工具恢复活动', async () => {
    process.env.PI_CONTEXT_TOOL_LAYERING = 'on';
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi, active } = fakePi();
    const r = mod.enableGroup(pi, 'browser-core');
    expect(r.ok).toBe(true);
    expect(active()).toContain('browser_navigate');
  });
});

/**
 * 回归（2026-10-04）：基线必须是 **pi 自己的激活决定**，不是"全部已注册工具"。
 * 旧实现拿 `getAllToolNames()` 当基线，把 pi 以 `defaultActive:false` 注册的
 * `tool_search`/`codemode`（以及 POSIX 上没用的 `powershell`）一并激活了。
 */
describe('applyToolLayering 基线取自 pi', () => {
  afterEach(() => {
    delete process.env.PI_CONTEXT_TOOL_LAYERING;
    vi.resetModules();
  });

  it('注册但 pi 未激活的工具不会被加回来（只减不加，且不触发 setActiveTools）', async () => {
    process.env.PI_CONTEXT_TOOL_LAYERING = 'on';
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    let active = ['read', 'bash'];
    let calls = 0;
    const pi = {
      getAllToolNames: () => ['read', 'bash', 'tool_search', 'codemode', 'powershell'],
      getActiveTools: () => [...active],
      setActiveTools: (names: string[]) => {
        calls++;
        active = [...names];
      },
    } as unknown as PiApi;
    mod.applyToolLayering(pi);
    expect(active).toEqual(['read', 'bash']);
    expect(calls).toBe(0);
  });
});

/**
 * 回归（2026-09-29）：`applyToolLayering` 过去无条件调用 `setActiveTools`。
 * 工具数组在请求最前部，任何一次调用（即使集合没变）都会重写 system prompt 与整段
 * 消息前缀 → 整段缓存失效。这里锁定"集合相同则不调用"与"顺序无关比较"。
 */
describe('applyToolLayering 空操作防护', () => {
  afterEach(() => {
    delete process.env.PI_CONTEXT_TOOL_LAYERING;
    vi.resetModules();
  });

  it('目标集合与当前一致 → 不调用 setActiveTools', async () => {
    delete process.env.PI_CONTEXT_TOOL_LAYERING;
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi } = fakePi();
    let calls = 0;
    const orig = pi.setActiveTools;
    pi.setActiveTools = (names: string[]) => {
      calls++;
      orig(names);
    };
    mod.applyToolLayering(pi);
    expect(calls).toBe(0);
  });

  it('顺序不同但集合相同 → 仍不调用（顺序变化同样破坏前缀缓存）', async () => {
    delete process.env.PI_CONTEXT_TOOL_LAYERING;
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi } = fakePi();
    pi.getActiveTools = () => [...ALL].reverse();
    let calls = 0;
    const orig = pi.setActiveTools;
    pi.setActiveTools = (names: string[]) => {
      calls++;
      orig(names);
    };
    mod.applyToolLayering(pi);
    expect(calls).toBe(0);
  });

  it('集合确实不同 → 调用一次', async () => {
    process.env.PI_CONTEXT_TOOL_LAYERING = 'on';
    vi.resetModules();
    const mod = await import('../budget/tool-layering');
    const { pi } = fakePi();
    // 预留一个休眠组未启用 → 目标集合小于当前全量
    let calls = 0;
    const orig = pi.setActiveTools;
    pi.setActiveTools = (names: string[]) => {
      calls++;
      orig(names);
    };
    mod.applyToolLayering(pi);
    expect(calls).toBe(1);
    expect(pi.getActiveTools()).not.toContain('browser_navigate');
  });
});
