/**
 * mode 纯逻辑回归测试（固定模式 / 归一化 / 运行时应用）
 * 仅测试无文件副作用的纯函数，不读写真实 modes.json。
 */
import { describe, it, expect } from 'vitest';
import {
  applyModeRuntime,
  normalizeModesFile,
  isFeatureEnabled,
  isLockedMode,
  modeFeaturesLabel,
  ALL_FEATURES,
  FIXED_MODES,
} from '../logic';
import type { ModeConfig } from '../logic';

function cfg(over: Partial<ModeConfig> = {}): ModeConfig {
  return {
    description: 'd',
    features: [],
    thinking: null,
    appendPrompt: null,
    memoryNamespace: null,
    ...over,
  };
}

describe('applyModeRuntime', () => {
  it('thinking 变化 → thinkingChanged，无需重启', () => {
    const r = applyModeRuntime(cfg({ thinking: 'low' }), cfg(), 'max');
    expect(r.thinkingChanged).toBe(true);
    expect(r.needsRestart).toBe(false);
    expect(r.changes).toContain('思考级别: low');
  });

  it('thinking 相同 → 不标记变更', () => {
    const r = applyModeRuntime(cfg({ thinking: 'low' }), cfg(), 'low');
    expect(r.thinkingChanged).toBe(false);
  });

  it('功能集变化 → needsRestart', () => {
    const r = applyModeRuntime(cfg({ features: ['memory'] }), cfg({ features: ['*'] }), undefined);
    expect(r.needsRestart).toBe(true);
  });

  it('人设 / 命名空间变化 → needsRestart', () => {
    expect(applyModeRuntime(cfg({ appendPrompt: 'modes/x.md' }), cfg(), undefined).needsRestart).toBe(true);
    expect(applyModeRuntime(cfg({ memoryNamespace: 'roleplay' }), cfg(), undefined).needsRestart).toBe(true);
  });

  it('功能集顺序不同但集合相同 → 不必重启', () => {
    const r = applyModeRuntime(cfg({ features: ['memory', 'web-search'] }), cfg({ features: ['web-search', 'memory'] }), undefined);
    expect(r.needsRestart).toBe(false);
  });
});

describe('固定模式', () => {
  it('full/minimal 为锁定模式', () => {
    expect(isLockedMode('full')).toBe(true);
    expect(isLockedMode('minimal')).toBe(true);
    expect(isLockedMode('roleplay')).toBe(false);
    expect(FIXED_MODES.minimal.thinking).toBe('off');
    expect(FIXED_MODES.full.features).toEqual(['*']);
  });

  it('isFeatureEnabled 支持 * 与白名单', () => {
    expect(isFeatureEnabled('memory', { ...cfg(), features: ['*'] })).toBe(true);
    expect(isFeatureEnabled('memory', { ...cfg(), features: ['web-search'] })).toBe(false);
    expect(isFeatureEnabled('web-search', { ...cfg(), features: ['web-search'] })).toBe(true);
  });

  it('modeFeaturesLabel 覆盖全量/空/白名单', () => {
    expect(modeFeaturesLabel({ ...cfg(), features: ['*'] })).toContain(`全部（${ALL_FEATURES.length}）`);
    expect(modeFeaturesLabel(cfg())).toContain('无');
    expect(modeFeaturesLabel({ ...cfg(), features: ['memory'] })).toContain('memory');
  });
});

describe('mode: normalizeModesFile 容错', () => {
  it('自定义模式缺字段被归一化，锁定模式由代码注入且不可被文件覆盖', async () => {
    const n = normalizeModesFile({
      default: 'roleplay',
      current: 'roleplay',
      modes: {
        roleplay: { features: ['memory'], thinking: 5 },
        full: { features: ['evil'] },
      },
    });
    expect(n.modes.roleplay.features).toEqual(['memory']);
    expect(n.modes.roleplay.thinking).toBeNull();
    expect(n.modes.full.features).toEqual(['*']);
    expect(n.default).toBe('roleplay');
    expect(n.current).toBe('roleplay');
    expect(Object.keys(n.modes)).toContain('minimal');
  });

  it('非法 current/default → 回退 full', async () => {
    const n = normalizeModesFile({ current: 'missing', default: 'nope', modes: {} });
    expect(n.default).toBe('full');
    expect(n.current).toBe('full');
    expect(Object.keys(n.modes)).toContain('full');
  });
});
