/**
 * mode 纯逻辑回归测试（固定模式 / 归一化 / 运行时应用）
 * 仅测试无文件副作用的纯函数，不读写真实 modes.json。
 */
import { describe, it, expect } from 'vitest';
import {
  applyModeRuntime,
  formatModeSwitchNotice,
  normalizeModesFile,
  isFeatureEnabled,
  isLockedMode,
  modeFeaturesLabel,
  ALL_FEATURES,
  DEFAULT_OFF_FEATURES,
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

  it('默认关闭的功能不在 * 里，显式列出才启用', () => {
    // 2026-10-07：voice（语言输入）/ link（远程连接）默认关闭——判据是实测调用分布
    // （跨度仅 1 天 = "探索过一次就没再用"），且**注册本身有副作用**（whisper 服务 / 入站远控通道）。
    expect(DEFAULT_OFF_FEATURES.has('voice')).toBe(true);
    expect(DEFAULT_OFF_FEATURES.has('link')).toBe(true);
    // browser 曾在此列，后**移出**改走 `exposure: 'deferred'`（注册但不声明 = 0 前缀字节，且要用时
    // 不用重启）——它的注册没有副作用，不需要"默认关闭"这种重手段。这里反向锁住，防回退。
    expect(DEFAULT_OFF_FEATURES.has('browser')).toBe(false);
    // 真日常功能不得被误关
    expect(DEFAULT_OFF_FEATURES.has('memory')).toBe(false);
    expect(DEFAULT_OFF_FEATURES.has('autopilot')).toBe(false);
    const star = { ...cfg(), features: ['*'] };
    expect(isFeatureEnabled('voice', star)).toBe(false);
    expect(isFeatureEnabled('link', star)).toBe(false);
    expect(isFeatureEnabled('browser', star)).toBe(true);
    // 其余功能不受影响
    for (const f of ALL_FEATURES) {
      if (DEFAULT_OFF_FEATURES.has(f)) continue;
      expect(isFeatureEnabled(f, star)).toBe(true);
    }
    // 显式列出即可启用（`['*', 'voice']` 也成立）
    expect(isFeatureEnabled('voice', { ...cfg(), features: ['voice'] })).toBe(true);
    expect(isFeatureEnabled('link', { ...cfg(), features: ['*', 'link'] })).toBe(true);
    // 不在 * 里、又没显式列出 → 关闭
    expect(isFeatureEnabled('voice', { ...cfg(), features: ['memory'] })).toBe(false);
  });

  it('modeFeaturesLabel 对 * 说出真实的启用数（不含默认关闭项）', () => {
    const label = modeFeaturesLabel({ ...cfg(), features: ['*'] });
    const on = ALL_FEATURES.length - DEFAULT_OFF_FEATURES.size;
    expect(label).toContain(`全部（${on}）`);
    expect(label).toContain('默认关闭');
    expect(label).toContain('voice');
  });

  it('modeFeaturesLabel 覆盖空/白名单', () => {
    expect(modeFeaturesLabel(cfg())).toContain('无');
    expect(modeFeaturesLabel({ ...cfg(), features: ['memory'] })).toContain('memory');
  });
});

describe('formatModeSwitchNotice（模式切换后的模型侧注入）', () => {
  const rp = cfg({
    description: '角色扮演：标枪',
    features: ['web-search', 'memory'],
    thinking: 'low',
    appendPrompt: 'modes/roleplay.md',
    memoryNamespace: 'roleplay',
  });

  it('说清"切到哪儿"与生效内容，而不是进程内部状态', () => {
    const text = formatModeSwitchNotice('full', 'roleplay', rp);
    expect(text).toContain('已切换：full → roleplay');
    expect(text).toContain('角色扮演：标枪');
    expect(text).toContain('启用功能: web-search、memory');
    expect(text).toContain('思考档位 low');
    expect(text).toContain('人设已注入');
    expect(text).toContain('记忆命名空间 roleplay');
    // 角色扮演下通用措辞会破戏，必须显式要求别提这条提示
    expect(text).toContain('不要向用户复述本条提示');
  });

  it('无人设/无命名空间/无思考档位时不留悬空字段', () => {
    const text = formatModeSwitchNotice('full', 'minimal', cfg({ description: '' }));
    expect(text).toContain('无人设');
    expect(text).toContain('记忆命名空间 默认');
    expect(text).not.toContain('思考档位');
    expect(text).not.toContain('定位:');
  });

  it('逐字节确定（注入面纪律：同输入必同输出，且不含路径/时间戳）', () => {
    const a = formatModeSwitchNotice('full', 'roleplay', rp);
    const b = formatModeSwitchNotice('full', 'roleplay', rp);
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(a).not.toMatch(/\/(root|home|tmp|var)\//);
  });
});

describe('mode: normalizeModesFile 容错', () => {
  it('自定义模式缺字段被归一化，锁定模式由代码注入且不可被文件覆盖', async () => {
    const n = normalizeModesFile({
      default: 'roleplay',
      modes: {
        roleplay: { features: ['memory'], thinking: 5 },
        full: { features: ['evil'] },
      },
    });
    expect(n.modes.roleplay.features).toEqual(['memory']);
    expect(n.modes.roleplay.thinking).toBeNull();
    expect(n.modes.full.features).toEqual(['*']);
    expect(n.default).toBe('roleplay');
    expect(Object.keys(n.modes)).toContain('minimal');
  });

  it('非法 default → 回退 full；遗留的 current 字段不再有意义（模式按会话记录）', async () => {
    const n = normalizeModesFile({ current: 'missing', default: 'nope', modes: {} });
    expect(n.default).toBe('full');
    expect(Object.keys(n.modes)).toContain('full');
    expect('current' in n).toBe(false);
  });
});
