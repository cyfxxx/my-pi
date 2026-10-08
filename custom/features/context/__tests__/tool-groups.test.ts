import { describe, it, expect } from 'vitest';
import {
  CORE_TOOLS,
  SLEEPING_GROUPS,
  computeActiveTools,
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
    const present = new Set(['browser_navigate', 'memory_stats', 'link_send', 'read']);
    const names = groupsWithTools(present).map((g) => g.name);
    expect(names).toContain('browser-core');
    expect(names).toContain('memory-advanced');
    expect(names).toContain('link');
    expect(names).not.toContain('admin');
    expect(names).not.toContain('verify');
    expect(names).not.toContain('plan');
  });

  it('buildSleepingSummary(present) 只列已注册工具所在的组', () => {
    const present = new Set(['browser_navigate', 'link_send']);
    const s = buildSleepingSummary(present);
    expect(s).toContain('- browser-core:');
    expect(s).toContain('- link:');
    expect(s).not.toContain('- admin:');
    expect(s).not.toContain('- plan:');
    expect(s).toContain('browser_navigate');
  });
});

describe('tool-groups: effectiveActiveTools（pi 基线 + 按需加载开关）', () => {
  const all = [...CORE_TOOLS, ...SLEEPING_GROUPS.flatMap((g) => g.tools)];
  const none = new Set<string>();

  it('layered=false（默认）→ 原样返回 pi 的基线，休眠组不裁剪', () => {
    expect(effectiveActiveTools(all, none, false)).toEqual(all);
  });

  it('永不激活 pi 没激活的工具（未知工具仍按"默认核心"保留）', () => {
    // 模拟真实：基线是 pi 自己激活的集合，"已注册但不在基线里"= defaultActive:false 或平台不可用
    const piBase = [...all, 'some_future_tool'];
    const registered = [...piBase, 'tool_search', 'codemode', 'powershell'];
    expect(registered.length).toBeGreaterThan(piBase.length);
    for (const layered of [false, true]) {
      const active = effectiveActiveTools(piBase, none, layered);
      for (const name of ['tool_search', 'codemode', 'powershell']) expect(active).not.toContain(name);
      expect(active).toContain('some_future_tool');
      expect(active).toContain('read');
      // 结果必须是基线的子集（只减不凭空加）
      expect(active.every((n) => piBase.includes(n))).toBe(true);
    }
  });

  it('layered=true（PI_CONTEXT_TOOL_LAYERING=on）→ 裁掉未启用休眠组', () => {
    const on = effectiveActiveTools(all, none, true);
    expect(on).not.toContain(SLEEPING_GROUPS[0].tools[0]);
    expect(on).toEqual(computeActiveTools(all, none));
  });

  it('layered=true 且组已启用 → 该组工具加到基线之后，基线顺序不变', () => {
    const g = SLEEPING_GROUPS[0];
    const base = [...CORE_TOOLS];
    const on = effectiveActiveTools(base, new Set([g.name]), true);
    expect(on).toContain(g.tools[0]);
    expect(on.slice(0, base.length)).toEqual(base);
  });
});

describe('tool-groups: 与 pi 刻意休眠的工具无交集声明', () => {
  it('休眠组名单里没有 pi 内置扩展/平台工具（避免两套机制互相干扰）', () => {
    const sleeping = new Set(SLEEPING_GROUPS.flatMap((g) => g.tools));
    for (const name of ['codemode', 'tool_search', 'powershell']) {
      expect(sleeping.has(name)).toBe(false);
      expect(CORE_TOOLS).not.toContain(name);
    }
  });
});
