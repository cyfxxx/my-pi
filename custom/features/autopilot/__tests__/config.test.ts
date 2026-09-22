/**
 * autopilot 配置解析健壮性测试（防手改配置类型错误导致策略静默失效）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAutopilotConfig } from '../store/ops';
import { defaultAutopilotConfig } from '../types';

let dir: string;
let cfgPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-aptcfg-'));
  cfgPath = join(dir, 'config.json');
  process.env.PI_AUTOPILOT_CONFIG = cfgPath;
});
afterEach(() => {
  delete process.env.PI_AUTOPILOT_CONFIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('readAutopilotConfig', () => {
  it('非法类型字段回退默认（字符串数值/非布尔不生效）', () => {
    writeFileSync(
      cfgPath,
      JSON.stringify({
        enabled: 'yes',
        maxIdleMinutes: '60',
        requeueOnRestart: 1,
        budget: { maxRunsPerDay: '10', maxCostPerDay: 5 },
        policy: { failoverAfter: '3', suspendAfter: 5, maxFailovers: '2' },
      }),
    );
    const c = readAutopilotConfig();
    const def = defaultAutopilotConfig();
    expect(c.enabled).toBe(def.enabled);
    expect(c.maxIdleMinutes).toBe(def.maxIdleMinutes);
    expect(c.requeueOnRestart).toBe(def.requeueOnRestart);
    expect(c.budget.maxRunsPerDay).toBe(def.budget.maxRunsPerDay);
    expect(c.budget.maxCostPerDay).toBe(5);
    expect(c.policy.failoverAfter).toBe(def.policy.failoverAfter);
    expect(c.policy.suspendAfter).toBe(5);
    expect(c.policy.maxFailovers).toBeUndefined();
  });

  it('合法值原样保留', () => {
    writeFileSync(
      cfgPath,
      JSON.stringify({ enabled: false, maxIdleMinutes: 42, policy: { failoverAfter: 7, timeoutFactor: 3 } }),
    );
    const c = readAutopilotConfig();
    expect(c.enabled).toBe(false);
    expect(c.maxIdleMinutes).toBe(42);
    expect(c.policy.failoverAfter).toBe(7);
    expect(c.policy.timeoutFactor).toBe(3);
  });

  it('文件缺失/损坏 → 默认配置', () => {
    expect(readAutopilotConfig()).toEqual(defaultAutopilotConfig());
    writeFileSync(cfgPath, '{not json');
    expect(readAutopilotConfig()).toEqual(defaultAutopilotConfig());
  });
});
