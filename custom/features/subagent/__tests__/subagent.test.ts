/**
 * subagent 纯逻辑回归测试
 * 迁移自 pi-tools subagent/tests 的核心语义（frontmatter/agents/helpers/concurrency）。
 */
import { describe, it, expect } from 'vitest';
import { parseFrontmatter, discoverAgents } from '../agents';
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
} from '../helpers';
import type { SingleResult } from '../types';

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
