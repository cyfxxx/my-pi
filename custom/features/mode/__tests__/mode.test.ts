/**
 * mode 纯逻辑回归测试（apply/needsRestart；迁移自 pi-tools pi-mode/tests 语义）
 * 仅测试无文件副作用的纯函数，不读写真实 modes.json。
 */
import { describe, it, expect } from 'vitest';
import { applyModeRuntime, needsRestart } from '../logic';
import type { ModeConfig } from '../logic';

function cfg(over: Partial<ModeConfig> = {}): ModeConfig {
  return {
    description: 'd',
    extensions: [],
    skills: [],
    systemPrompt: null,
    appendSystemPrompt: null,
    thinking: null,
    ...over,
  };
}

describe('applyModeRuntime', () => {
  it('thinking 变化 → thinkingChanged，无需重启', () => {
    const r = applyModeRuntime(cfg({ thinking: 'low' }), 'max');
    expect(r.thinkingChanged).toBe(true);
    expect(r.needsRestart).toBe(false);
    expect(r.changes).toContain('思考级别: low');
  });

  it('thinking 相同 → 不标记变更', () => {
    const r = applyModeRuntime(cfg({ thinking: 'low' }), 'low');
    expect(r.thinkingChanged).toBe(false);
  });

  it('extensions/skills/systemPrompt 任一非空 → needsRestart', () => {
    expect(applyModeRuntime(cfg({ extensions: ['web-search'] }), undefined).needsRestart).toBe(true);
    expect(applyModeRuntime(cfg({ skills: ['+a.md'] }), undefined).needsRestart).toBe(true);
    expect(applyModeRuntime(cfg({ systemPrompt: 'x' }), undefined).needsRestart).toBe(true);
    expect(applyModeRuntime(cfg({ appendSystemPrompt: 'x' }), undefined).needsRestart).toBe(true);
  });
});

describe('needsRestart', () => {
  it('全空 → false', () => {
    expect(needsRestart(cfg())).toBe(false);
  });

  it('有扩展/技能/提示词 → true', () => {
    expect(needsRestart(cfg({ extensions: ['a'] }))).toBe(true);
    expect(needsRestart(cfg({ skills: ['a'] }))).toBe(true);
    expect(needsRestart(cfg({ systemPrompt: 'a' }))).toBe(true);
  });
});

describe('mode: normalizeModesFile 容错', () => {
  it('缺字段/类型错误的模式被归一化，不抛异常', async () => {
    const { normalizeModesFile } = await import('../logic');
    const n = normalizeModesFile({
      default: 'x',
      current: 'missing',
      modes: { x: { extensions: null, skills: 'no', thinking: 5 }, y: null },
    });
    expect(n.modes.x.extensions).toEqual([]);
    expect(n.modes.x.skills).toEqual([]);
    expect(n.modes.x.thinking).toBeNull();
    expect(n.modes.y.extensions).toEqual([]);
    expect(n.default).toBe('x');
    expect(n.current).toBe('x');
  });

  it('非法 JSON 结构 → 回退 full 默认模式', async () => {
    const { normalizeModesFile } = await import('../logic');
    const n = normalizeModesFile({ modes: {} });
    expect(Object.keys(n.modes)).toContain('full');
    expect(n.default).toBe('full');
  });
});
