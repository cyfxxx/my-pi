/**
 * thinking 档位 → DSH `reasoningEffort` 的纯映射单测。
 *
 * 守两条不变式：
 *   ① **绝不向上取档**（升档 = 整段前缀缓存失效，这与 pi 侧"缓存安全夹档"的目的一致）；
 *   ② 认不出/无可用档位时**明确失败并给原因**，不猜（猜错的代价是成本与缓存）。
 */

import { describe, expect, it } from 'vitest';

import { levelRank, mapThinkingLevelToEffort } from '../thinking-level';

const EFFORTS = [
  { id: 'none', name: 'off' },
  { id: 'low-eff', name: 'low' },
  { id: 'mid-eff', name: 'medium' },
  { id: 'high-eff', name: 'high' },
];

describe('levelRank', () => {
  it('归一 low/medium/high 及其常见别名', () => {
    expect(levelRank('low')).toBe(0);
    expect(levelRank('minimal')).toBe(0);
    expect(levelRank('off')).toBe(0);
    expect(levelRank('Medium')).toBe(1);
    expect(levelRank('default')).toBe(1);
    expect(levelRank('HIGH')).toBe(2);
    expect(levelRank('max')).toBe(2);
    expect(levelRank('unknown-level')).toBeUndefined();
    expect(levelRank('')).toBeUndefined();
  });
});

describe('mapThinkingLevelToEffort', () => {
  it('精确匹配（id 或 name，大小写不敏感）', () => {
    expect(mapThinkingLevelToEffort('low', EFFORTS)).toEqual({ ok: true, effort: 'low-eff', matched: 'exact' });
    expect(mapThinkingLevelToEffort('LOW-EFF', EFFORTS)).toEqual({ ok: true, effort: 'low-eff', matched: 'exact' });
    expect(mapThinkingLevelToEffort('high-eff', EFFORTS)).toEqual({ ok: true, effort: 'high-eff', matched: 'exact' });
  });

  it('别名同序匹配（如目标 max、可用 high-eff）', () => {
    const r = mapThinkingLevelToEffort('max', EFFORTS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.effort).toBe('high-eff');
      expect(r.matched).toBe('alias');
      expect(r.note).toContain('同序');
    }
  });

  it('★ 目标档位不存在时**向下取最近**，绝不向上', () => {
    // 只有 low / high，没有 medium ⇒ medium 向下取 low（而不是向上取 high）
    const sparse = [
      { id: 'L', name: 'low' },
      { id: 'H', name: 'high' },
    ];
    const r = mapThinkingLevelToEffort('medium', sparse);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.effort).toBe('L');
      expect(r.matched).toBe('clamped-down');
      expect(r.note).toContain('绝不向上');
    }
  });

  it('只有更高档位可选时**失败**（保持现状更安全）', () => {
    const onlyHigh = [{ id: 'H', name: 'high' }];
    const r = mapThinkingLevelToEffort('low', onlyHigh);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('没有不高于');
  });

  it('认不出档位序且无精确匹配时**失败**（不猜）', () => {
    const r = mapThinkingLevelToEffort('turbo', EFFORTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('认不出档位序');
  });

  it('空目标 / 空可选集合 ⇒ 明确失败并给原因', () => {
    const empty = mapThinkingLevelToEffort('', EFFORTS);
    expect(empty.ok).toBe(false);
    const none = mapThinkingLevelToEffort('high', []);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toContain('没有暴露任何可选档位');
  });
});
