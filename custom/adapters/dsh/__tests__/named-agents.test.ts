/**
 * 具名 agent 规划/注册的单测（DR-2 的可选能力，**默认关闭**）。
 *
 * 守四件事：
 *   ① 名字必须规范化成合法工具名，非法/撞名/超上限要**逐条给出跳过原因**（不静默少能力）；
 *   ② 只读 agent 必须映射成 `toolFilter.allow`（my-pi 的只读判据）；
 *   ③ 注册必须**逐条隔离**：一个实例失败不能带走其余；
 *   ④ 拿不到宿主模块时**整批显式失败**，不假装注册成功。
 */

import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '../../../features/subagent/core/agents';
import { planNamedAgentTools, registerNamedAgentTools, toToolName } from '../named-agents';

const agent = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  name: 'scout',
  description: '只读侦察',
  systemPrompt: '你是侦察员，只读。',
  source: 'user',
  filePath: '/tmp/agents/scout.md',
  ...over,
});

describe('toToolName', () => {
  it('规范化：小写、非法字符折叠成 -、去首尾 -', () => {
    expect(toToolName('Scout')).toBe('scout');
    expect(toToolName('Code Reviewer!')).toBe('code-reviewer');
    expect(toToolName('a  b__c')).toBe('a-b__c');
  });

  it('★ 反向探针：以数字/符号开头、或规范化后为空 ⇒ undefined（调用方必须记跳过）', () => {
    expect(toToolName('1st')).toBeUndefined();
    expect(toToolName('!!!')).toBeUndefined();
    expect(toToolName('')).toBeUndefined();
  });

  it('前缀参与校验（前缀非法也会被拒）', () => {
    expect(toToolName('scout', 'agent-')).toBe('agent-scout');
    expect(toToolName('scout', '1-')).toBeUndefined();
  });
});

describe('planNamedAgentTools', () => {
  it('正常映射：persona / 只读 allow 列表 / 名字规范化', () => {
    const plan = planNamedAgentTools(
      [agent({ name: 'Scout', readonly: true })],
      { provider: 'spawn' },
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.tools).toHaveLength(1);
    const [tool] = plan.tools;
    expect(tool.toolName).toBe('scout');
    expect(tool.sourceName).toBe('Scout');
    expect(tool.config.persona).toContain('侦察员');
    expect(tool.config.toolFilter?.allow).toEqual(['read', 'grep', 'find', 'ls']);
    expect(tool.config.provider).toBe('spawn');
  });

  it('非只读 + 显式 tools ⇒ 用 agent 自己的 allow 列表；都没有 ⇒ 不传 toolFilter', () => {
    const withTools = planNamedAgentTools([agent({ name: 'w', tools: ['bash', 'read'] })], { provider: 'spawn' });
    expect(withTools.tools[0].config.toolFilter?.allow).toEqual(['bash', 'read']);
    const plain = planNamedAgentTools([agent({ name: 'p' })], { provider: 'spawn' });
    expect(plain.tools[0].config.toolFilter).toBeUndefined();
  });

  it('★ 逐条跳过并说明原因：撞保留名 / 两个 agent 撞名 / 空人设 / 超上限', () => {
    const plan = planNamedAgentTools(
      [
        agent({ name: 'subagent' }),              // 与宿主核心工具同名
        agent({ name: 'scout' }),
        agent({ filePath: '/tmp/b.md', name: 'Scout' }), // 规范化后与上一条撞名
        agent({ filePath: '/tmp/c.md', name: 'empty', systemPrompt: '   ' }),
        agent({ filePath: '/tmp/d.md', name: 'extra' }),
      ],
      { provider: 'spawn', maxTools: 1, reserved: ['subagent', 'workflow', 'read'] },
    );
    expect(plan.tools.map((t) => t.toolName)).toEqual(['scout']);
    const reasons = plan.skipped.map((s) => `${s.name}:${s.reason}`).join(' | ');
    expect(reasons).toContain('subagent:工具名 "subagent" 与已有工具同名');
    expect(reasons).toContain('Scout:工具名 "scout" 与另一个 agent 冲突');
    expect(reasons).toContain('empty:人设为空');
    expect(reasons).toContain('extra:超过本次注册上限 maxTools=1');
  });

  it('★ 人设过长要截断并标记（子代理输入成本）', () => {
    const plan = planNamedAgentTools([agent({ systemPrompt: 'x'.repeat(50) })], {
      provider: 'spawn',
      personaMaxChars: 10,
    });
    expect(plan.tools[0].personaTruncated).toBe(true);
    expect(plan.tools[0].config.persona.length).toBeLessThan(40);
  });

  it('model 只在形如 provider/model 时才传（裸名字宁可不传，用宿主默认）', () => {
    const ok = planNamedAgentTools([agent({ model: 'deepseek/deepseek-chat' })], { provider: 'spawn' });
    expect(ok.tools[0].config.agentOptions).toEqual({ model: 'deepseek/deepseek-chat' });
    const bare = planNamedAgentTools([agent({ model: 'deepseek-chat' })], { provider: 'spawn' });
    expect(bare.tools[0].config.agentOptions).toBeUndefined();
  });
});

describe('registerNamedAgentTools', () => {
  const plan = planNamedAgentTools(
    [agent({ name: 'scout' }), agent({ filePath: '/tmp/b.md', name: 'worker' })],
    { provider: 'spawn' },
  );

  it('逐条装载宿主模块（每个 agent 一个实例、配置带 toolName/persona）', () => {
    const plugin = vi.fn();
    const module = { name: 'fake-tool-subagent' };
    const result = registerNamedAgentTools({ plugin }, plan, module);
    expect(result.registered).toEqual(['scout', 'worker']);
    expect(result.failed).toEqual([]);
    expect(plugin).toHaveBeenCalledTimes(2);
    expect(plugin.mock.calls[0][0]).toBe(module);
    expect(plugin.mock.calls[0][1]).toMatchObject({ toolName: 'scout', provider: 'spawn' });
  });

  it('★ 反向探针：一个实例抛错不能带走其余（逐条隔离）', () => {
    const plugin = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementationOnce(() => undefined);
    const result = registerNamedAgentTools({ plugin }, plan, {});
    expect(result.registered).toEqual(['worker']);
    expect(result.failed).toEqual([{ toolName: 'scout', reason: 'boom' }]);
  });

  it('★ 反向探针：宿主没装该包（模块为 null）⇒ 整批显式失败（不假装成功）', () => {
    const plugin = vi.fn();
    const result = registerNamedAgentTools({ plugin }, plan, null);
    expect(result.registered).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].reason).toContain('没有 @deepseek-ai/dsh-tool-subagent');
    expect(plugin).not.toHaveBeenCalled();
  });

  it('★ 有 ctx.inject 时走子上下文（宿主插件自己 inject tools/subagents/systemPrompt/sessionProjections）', () => {
    const outerPlugin = vi.fn();
    const innerPlugin = vi.fn();
    const inject = vi.fn((deps: readonly string[], cb: (child: unknown) => void) => {
      expect(deps).toEqual(['tools', 'subagents', 'systemPrompt', 'sessionProjections']);
      cb({ plugin: innerPlugin });
      return undefined;
    });
    const result = registerNamedAgentTools({ plugin: outerPlugin, inject }, plan, { name: 'fake' });
    expect(outerPlugin).not.toHaveBeenCalled();
    expect(innerPlugin).toHaveBeenCalledTimes(2);
    expect(result.registered).toEqual(['scout', 'worker']);
    expect(result.failed).toEqual([]);
  });

  it('可用 options.inject 覆盖服务清单（宿主 API 变了也不必改调用点）', () => {
    const innerPlugin = vi.fn();
    const seenDeps: string[][] = [];
    const inject = vi.fn((deps: readonly string[], cb: (child: unknown) => void) => {
      seenDeps.push([...deps]);
      cb({ plugin: innerPlugin });
    });
    registerNamedAgentTools({ plugin: vi.fn(), inject }, plan, {}, { inject: ['tools'] });
    expect(inject.mock.calls[0][0]).toEqual(['tools']);
    expect(innerPlugin).toHaveBeenCalledTimes(2);
  });

  it('空计划 ⇒ 什么也不做（连模块都不看）', () => {
    const plugin = vi.fn();
    const result = registerNamedAgentTools({ plugin }, { tools: [], skipped: [] }, null);
    expect(result).toEqual({ registered: [], failed: [] });
    expect(plugin).not.toHaveBeenCalled();
  });
});
