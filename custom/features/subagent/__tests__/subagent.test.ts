/**
 * subagent 纯逻辑回归测试
 * 迁移自 pi-tools subagent/tests 的核心语义（frontmatter/agents/helpers/concurrency）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, discoverAgents } from '../core/agents';
import {
  classifyTaskRisk,
  resolveAgentTools,
  buildAgentPrompt,
  applyPreviousPlaceholder,
  capPreviousOutput,
  truncateParallelOutput,
  mapWithConcurrencyLimit,
  isLocalProvider,
  formatTokens,
  getFinalOutput,
  isFailedResult,
  getMaxParallelTasks,
} from '../core/helpers';
import type { SingleResult } from '../core/types';
import { resolveModelId, getActivePlanSnippet } from '../core/runner';

describe('parseFrontmatter', () => {
  it('解析 name/description/tools/readonly', () => {
    const { frontmatter, body } = parseFrontmatter(
      '---\nname: scout\ndescription: 侦察\ntools: read, grep, ls\nreadonly: true\n---\n正文',
    );
    expect(frontmatter.name).toBe('scout');
    expect(frontmatter.readonly).toBe('true');
    expect(body).toBe('正文');
  });

  it('数组语法 tools: [a, b]', () => {
    const { frontmatter } = parseFrontmatter('---\nname: x\ndescription: y\ntools: [read, ls]\n---\n');
    expect(frontmatter.tools).toEqual(['read', 'ls']);
  });

  it('无 frontmatter → 空对象 + 原文', () => {
    const { frontmatter, body } = parseFrontmatter('just text');
    expect(frontmatter).toEqual({});
    expect(body).toBe('just text');
  });
});

describe('discoverAgents（读取 portable/agent/agents 内置角色）', () => {
  it('user 范围发现 scout/worker/reviewer', () => {
    const { agents } = discoverAgents(process.cwd(), 'user');
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(['reviewer', 'scout', 'worker']);
    const scout = agents.find((a) => a.name === 'scout')!;
    expect(scout.readonly).toBe(true);
    expect(scout.tools).toContain('read');
    expect(scout.source).toBe('user');
  });
});

describe('helpers: readonly/风险/占位符', () => {
  it('resolveAgentTools：readonly 白名单收紧，空则回退 [read, ls]', () => {
    expect(resolveAgentTools({ readonly: true, tools: ['read', 'bash', 'tmux_run'] })).toEqual(['read']);
    expect(resolveAgentTools({ readonly: true, tools: ['bash'] })).toEqual(['read', 'ls']);
    expect(resolveAgentTools({ tools: ['read', 'bash'] })).toEqual(['read', 'bash']);
  });

  it('buildAgentPrompt 对 readonly 追加只读提示', () => {
    expect(buildAgentPrompt({ readonly: true, systemPrompt: 'P' })).toContain('强制只读模式');
    expect(buildAgentPrompt({ systemPrompt: 'P' })).toBe('P');
  });

  it('classifyTaskRisk 分级', () => {
    expect(classifyTaskRisk('rm -rf /tmp/x')).toBe('3σ');
    expect(classifyTaskRisk('chmod +x run.sh')).toBe('2σ');
    expect(classifyTaskRisk('阅读这个文件')).toBe('1σ');
  });

  it('applyPreviousPlaceholder 函数替换（防 $ 注入）并替换全部', () => {
    const out = applyPreviousPlaceholder('基于 {previous} 继续，引用 {previous}', "$& 特殊");
    expect(out).toContain('$& 特殊');
    expect(out).not.toContain('{previous}');
  });

  it('capPreviousOutput 超限截断并标记', () => {
    const big = 'x'.repeat(100);
    expect(capPreviousOutput(big, 10).endsWith('[truncated]')).toBe(true);
    expect(capPreviousOutput('short', 100)).toBe('short');
  });

  it('isLocalProvider 识别本地推理服务', () => {
    expect(isLocalProvider('ollama')).toBe(true);
    expect(isLocalProvider('openai')).toBe(false);
  });

  it('formatTokens 单位', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(2_000_000)).toBe('2.0M');
  });

  it('getFinalOutput / isFailedResult', () => {
    const msgs = [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }];
    expect(getFinalOutput(msgs)).toBe('hi');
    const base: SingleResult = {
      agent: 'a',
      agentSource: 'user',
      task: 't',
      exitCode: 0,
      messages: msgs,
      stderr: '',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    };
    expect(isFailedResult(base)).toBe(false);
    expect(isFailedResult({ ...base, exitCode: 1 })).toBe(true);
    expect(isFailedResult({ ...base, stopReason: 'aborted' })).toBe(true);
  });

  it('truncateParallelOutput 小输出不变', () => {
    expect(truncateParallelOutput('ok')).toBe('ok');
  });
});

describe('mapWithConcurrencyLimit', () => {
  it('保持顺序 + 限制并发', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('外部 abort 停止派发', async () => {
    const ctrl = new AbortController();
    const seen: number[] = [];
    await expect(
      mapWithConcurrencyLimit([1, 2, 3, 4], 1, async (n) => {
        seen.push(n);
        if (n === 1) ctrl.abort();
        return n;
      }, ctrl.signal),
    ).resolves.toBeDefined();
    expect(seen).toContain(1);
  });
});

describe('Termux 限制', () => {
  it('getMaxParallelTasks 为正整数', () => {
    expect(getMaxParallelTasks()).toBeGreaterThan(0);
  });
});

describe('resolveModelId 模型优先级', () => {
  const session = { id: 'deepseek-flash', provider: 'deepseek' };

  it('调用级 model 最高优先', () => {
    expect(resolveModelId('role/model', 'call/model', session)).toBe('call/model');
  });

  it('无调用级时用 agent frontmatter model', () => {
    expect(resolveModelId('role/model', undefined, session)).toBe('role/model');
  });

  it('都未指定时继承主会话模型 provider/id', () => {
    expect(resolveModelId(undefined, undefined, session)).toBe('deepseek/deepseek-flash');
  });

  it('无会话模型时返回 undefined（交给 settings 默认）', () => {
    expect(resolveModelId(undefined, undefined, undefined)).toBeUndefined();
    expect(resolveModelId(undefined, undefined, { id: 'x' })).toBeUndefined();
  });
});

describe('getActivePlanSnippet（复用 plan-mode 活跃计划语义）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'my-pi-subagent-plans-'));
    process.env.PI_PLANS_DIR = join(dir, 'plans');
  });

  afterEach(() => {
    delete process.env.PI_PLANS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  function writePlan(ts: number, content: string): void {
    const planDir = join(dir, 'plans', `plan-${ts}`);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, 'plan.md'), content);
  }

  it('从 PI_PLANS_DIR 读取，而非硬编码 memoryDir/plans', () => {
    const now = Date.now();
    // 干扰项：仅存在于 memoryDir/plans
    const memPlan = join(dir, 'memory', 'plans', `plan-${now - 1000}`);
    mkdirSync(memPlan, { recursive: true });
    writeFileSync(join(memPlan, 'plan.md'), '- [ ] 1. 仅内存目录中的干扰计划\n<!-- nextId: 2 -->');
    expect(getActivePlanSnippet()).toBeNull();

    writePlan(now - 2000, '- [ ] 1. PI_PLANS_DIR 内的计划\n<!-- nextId: 2 -->');
    expect(getActivePlanSnippet()).toContain('PI_PLANS_DIR 内的计划');
  });

  it('按时间倒序取 ≤7 天且含未完成任务的计划', () => {
    const now = Date.now();
    writePlan(now - 8 * 24 * 3600 * 1000, '- [ ] 1. 过期计划\n<!-- nextId: 2 -->');
    writePlan(now - 1000, '- [x] 1. 已完成计划\n<!-- nextId: 2 -->');
    expect(getActivePlanSnippet()).toBeNull();
    writePlan(now - 2000, '- [ ] 1. 待办计划\n<!-- nextId: 2 -->');
    expect(getActivePlanSnippet()).toContain('待办计划');
  });

  it('忽略同名普通文件与损坏 plan.md（statSync 判目录）', () => {
    const now = Date.now();
    mkdirSync(join(dir, 'plans'), { recursive: true });
    writeFileSync(join(dir, 'plans', `plan-${now - 500}`), 'not a directory');
    writePlan(now - 1000, '不是计划文件');
    expect(getActivePlanSnippet()).toBeNull();
    writePlan(now - 1500, '- [ ] 1. 有效计划\n<!-- nextId: 2 -->');
    expect(getActivePlanSnippet()).toContain('有效计划');
  });

  it('超过 2048 字符截断并标记', () => {
    const content = `- [ ] 1. ${'x'.repeat(3000)}\n<!-- nextId: 2 -->`;
    writePlan(Date.now() - 1000, content);
    const snippet = getActivePlanSnippet();
    expect(snippet).not.toBeNull();
    expect(snippet!.endsWith('...（已截断）')).toBe(true);
    expect(snippet!.length).toBe(2048 + '\n...（已截断）'.length);
  });

  it('无计划时返回 null', () => {
    expect(getActivePlanSnippet()).toBeNull();
  });
});
