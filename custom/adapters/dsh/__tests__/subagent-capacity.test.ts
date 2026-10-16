/**
 * 子代理并发核对的单测（DSH 底座专属）。
 *
 * 守两件事：
 *   ① **移动端不许静默超载**：Termux/android 上宿主允许的并发 > my-pi 上限（2）时，必须给出"需要处理"的结论
 *      与可操作的部署层改法（插件无权改宿主的 Volatile ⇒ 只能报警 + 给片段）；
 *   ② **读不到就说读不到**：服务缺失/形状不符时 fail-open，但结论必须是"未做核对"，不许假装核对过。
 */

import { describe, expect, it } from 'vitest';

import { MY_PI_TERMUX_MAX_ACTIVE, auditSubagentCapacity, isTermuxLike } from '../subagent-capacity';

/** 造一个"像宿主那样"的服务：maxActiveSubagents 是只有 get() 的 Volatile */
const svc = (value: unknown) => ({ config: { maxActiveSubagents: { get: () => value } } });

describe('isTermuxLike（口径与 features/subagent 对齐）', () => {
  it('android 或 TERMUX_VERSION 都算移动端', () => {
    expect(isTermuxLike({ platform: 'android' })).toBe(true);
    expect(isTermuxLike({ platform: 'linux', TERMUX_VERSION: '1' })).toBe(true);
    expect(isTermuxLike({ platform: 'linux', TERMUX_VERSION: '' })).toBe(false);
    expect(isTermuxLike({ platform: 'darwin' })).toBe(false);
  });
});

describe('auditSubagentCapacity', () => {
  it('★ 移动端 + 超出 my-pi 上限 ⇒ tooHigh，并给出部署层改法（含 subagent 覆盖片段）', () => {
    const r = auditSubagentCapacity(svc(8), true);
    expect(r.effective).toBe(8);
    expect(r.tooHigh).toBe(true);
    expect(r.note).toContain('超出 my-pi 的移动端上限 2');
    expect(r.note).toContain('id: subagent');
    expect(r.note).toContain('maxActiveSubagents: 2');
  });

  it('移动端但宿主已被压到上限内 ⇒ 不报警', () => {
    const r = auditSubagentCapacity(svc(MY_PI_TERMUX_MAX_ACTIVE), true);
    expect(r.tooHigh).toBe(false);
    expect(r.note).toContain('≤ 移动端上限');
  });

  it('非移动端 ⇒ 保持宿主默认（8 也不报警，不越权替桌面改配置）', () => {
    const r = auditSubagentCapacity(svc(8), false);
    expect(r.effective).toBe(8);
    expect(r.tooHigh).toBe(false);
    expect(r.note).toContain('非移动端');
  });

  it('★ 反向探针：读不到（服务缺失 / 形状不符 / get 抛错）⇒ 明确说"未做核对"，且不误报 tooHigh', () => {
    for (const missing of [undefined, {}, { config: {} }, { config: { maxActiveSubagents: {} } }]) {
      const r = auditSubagentCapacity(missing, true);
      expect(r.effective).toBeUndefined();
      expect(r.tooHigh).toBe(false);
      expect(r.note).toContain('未做移动端并发核对');
    }
    const boom = {
      config: {
        maxActiveSubagents: {
          get: () => {
            throw new Error('boom');
          },
        },
      },
    };
    expect(auditSubagentCapacity(boom, true).note).toContain('未做移动端并发核对');
    // 形状不符（不是数字）同样按"读不到"处理
    expect(auditSubagentCapacity(svc('8'), true).effective).toBeUndefined();
    expect(auditSubagentCapacity(svc(Number.NaN), true).effective).toBeUndefined();
  });

  it('★ 反向探针：只读（不得写宿主配置）—— 调用后服务的 config 对象保持不变', () => {
    const service = svc(8);
    const before = JSON.stringify(Object.keys(service.config));
    auditSubagentCapacity(service, true);
    expect(JSON.stringify(Object.keys(service.config))).toBe(before);
    expect(typeof service.config.maxActiveSubagents.get).toBe('function');
  });
});
