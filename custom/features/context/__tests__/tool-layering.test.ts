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
