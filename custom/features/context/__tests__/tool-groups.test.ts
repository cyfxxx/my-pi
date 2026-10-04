import { describe, it, expect } from 'vitest';
import {
  CORE_TOOLS,
  SLEEPING_GROUPS,
  computeActiveTools,
  deferredTools,
  effectiveActiveTools,
  buildSleepingSummary,
  validateGroups,
  groupsWithTools,
} from '../budget/tool-groups';

describe('tool-groups: 分组完整性', () => {
  it('核心与休眠组无重叠、无空组', () => {
    const { overlap, emptyGroups } = validateGroups();
    expect(overlap).toEqual([]);
    expect(emptyGroups).toEqual([]);
  });

  it('组内工具名不重复', () => {
    const all = SLEEPING_GROUPS.flatMap((g) => g.tools);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('tool-groups: 活动工具计算', () => {
  it('未启用任何组时排除所有休眠工具，未知工具保留', () => {
    const all = [
      'read', 'bash',
      ...SLEEPING_GROUPS.flatMap((g) => g.tools),
      'future_tool',
    ];
    const active = computeActiveTools(all, new Set());
    expect(active).toEqual(['read', 'bash', 'future_tool']);
  });

  it('启用某组后该组工具进入活动集', () => {
    const browserCore = SLEEPING_GROUPS.find((g) => g.name === 'browser-core')!;
    const all = ['read', ...browserCore.tools];
    const active = computeActiveTools(all, new Set(['browser-core']));
    expect(active).toEqual(all);
  });
});

describe('tool-groups: 摘要缓存友好', () => {
  it('摘要只依赖组定义，重复调用稳定', () => {
    expect(buildSleepingSummary()).toBe(buildSleepingSummary());
    for (const g of SLEEPING_GROUPS) {
      expect(buildSleepingSummary()).toContain(`- ${g.name}:`);
    }
  });

  it('核心常用工具不在休眠组内', () => {
    const sleeping = new Set(SLEEPING_GROUPS.flatMap((g) => g.tools));
    for (const t of ['read', 'bash', 'edit', 'write', 'todo', 'subagent', 'memory_store']) {
      expect(CORE_TOOLS).toContain(t);
      expect(sleeping.has(t)).toBe(false);
    }
  });

  it('groupsWithTools 过滤未迁移功能的分组', () => {
    const present = new Set(['browser_navigate', 'memory_stats', 'web_fetch', 'read']);
    const names = groupsWithTools(present).map((g) => g.name);
    expect(names).toContain('browser-core');
    expect(names).toContain('memory-advanced');
    expect(names).toContain('web-fallback');
    expect(names).not.toContain('admin');
    expect(names).not.toContain('verify');
    expect(names).not.toContain('plan');
  });

  it('buildSleepingSummary(present) 只列已注册工具所在的组', () => {
    const present = new Set(['browser_navigate', 'web_fetch']);
    const s = buildSleepingSummary(present);
    expect(s).toContain('- browser-core:');
    expect(s).toContain('- web-fallback:');
    expect(s).not.toContain('- admin:');
    expect(s).not.toContain('- plan:');
    expect(s).toContain('browser_navigate');
  });
});

describe('tool-groups: effectiveActiveTools（按需加载开关）', () => {
  const all = [...CORE_TOOLS, ...SLEEPING_GROUPS.flatMap((g) => g.tools)];
  const none = new Set<string>();

  it('layered=false（默认）→ 全部工具常驻，休眠组不裁剪', () => {
    expect(effectiveActiveTools(all, none, false)).toEqual(all);
  });

  it('layered=false 时即使注册了未迁移功能之外的未知工具也全部保留', () => {
    const withUnknown = [...all, 'some_future_tool'];
    expect(effectiveActiveTools(withUnknown, none, false)).toContain('some_future_tool');
  });

  it('layered=true（PI_CONTEXT_TOOL_LAYERING=on）→ 裁掉未启用休眠组', () => {
    const on = effectiveActiveTools(all, none, true);
    expect(on).not.toContain(SLEEPING_GROUPS[0].tools[0]);
    expect(on).toEqual(computeActiveTools(all, none));
  });

  it('layered=true 且组已启用 → 该组工具恢复活动', () => {
    const g = SLEEPING_GROUPS[0];
    const on = effectiveActiveTools(all, new Set([g.name]), true);
    expect(on).toContain(g.tools[0]);
  });
});

describe('tool-groups: pi 刻意休眠的工具（defaultActive:false）', () => {
  const deferred = new Set(deferredTools('linux'));

  it('两个档位都不激活 pi 刻意休眠的工具', () => {
    const all = [...CORE_TOOLS, 'codemode', 'tool_search', 'powershell', 'some_future_tool'];
    for (const layered of [false, true]) {
      const active = effectiveActiveTools(all, new Set(), layered);
      for (const name of deferred) expect(active).not.toContain(name);
      // 未知工具仍按"默认核心"保留，收口不改变这条语义
      expect(active).toContain('some_future_tool');
      expect(active).toContain('read');
    }
  });

  it('名单按平台区分：POSIX 排除 powershell，Windows 保留', () => {
    expect(deferredTools('linux')).toEqual(['codemode', 'tool_search', 'powershell']);
    expect(deferredTools('android')).toContain('powershell');
    expect(deferredTools('win32')).toEqual(['codemode', 'tool_search']);
  });

  it('名单与休眠组无重叠（两套机制互不干扰）', () => {
    const sleeping = new Set(SLEEPING_GROUPS.flatMap((g) => g.tools));
    for (const name of deferredTools('linux')) expect(sleeping.has(name)).toBe(false);
  });
});
