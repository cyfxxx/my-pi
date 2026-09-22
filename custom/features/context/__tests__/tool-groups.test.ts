import { describe, it, expect } from 'vitest';
import {
  CORE_TOOLS,
  SLEEPING_GROUPS,
  computeActiveTools,
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
    const present = new Set(['browser_navigate', 'memory_recall', 'web_fetch', 'read']);
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
