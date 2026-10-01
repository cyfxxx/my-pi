/**
 * 子代理命令行组装（P3-3：spawn / fork 两种上下文模式）
 *
 * 背景：DSH 区分 fork（继承历史、复用 KV）与 spawn（空上下文）；my-pi 的子代理此前只有 spawn。
 * `--fork` 让子代理继承父会话历史——父会话刚发过请求时那段前缀是**暖的**，首请求按 cacheRead
 * 计价（约全价的 1/50），于是"既拿上下文又便宜"；缓存已冷时则要为整段历史付全价，故为显式 opt-in。
 * 本测试锁住：默认 spawn、fork 时用 `--fork` 且不带 `--no-session`、空/未给时退回 spawn。
 */
import { describe, it, expect } from 'vitest';
import { buildSubagentArgs } from '../core/runner';

const base = { task: '看看这个文件' };

describe('buildSubagentArgs', () => {
  it('默认 spawn：--no-session，且无 --fork', () => {
    const args = buildSubagentArgs(base);
    expect(args).toContain('--no-session');
    expect(args).not.toContain('--fork');
    expect(args).toContain('--no-extensions');
    expect(args[args.length - 1]).toBe('Task: 看看这个文件');
  });

  it('fork：用 --fork <父会话>，且**不带** --no-session（fork 本身要建会话）', () => {
    const args = buildSubagentArgs({ ...base, forkSession: '/sessions/parent.jsonl' });
    expect(args).toContain('--fork');
    expect(args[args.indexOf('--fork') + 1]).toBe('/sessions/parent.jsonl');
    expect(args).not.toContain('--no-session');
  });

  it('forkSession 为空串/undefined → 退回 spawn（拿不到父会话时不报错）', () => {
    expect(buildSubagentArgs({ ...base, forkSession: undefined })).toContain('--no-session');
    expect(buildSubagentArgs({ ...base, forkSession: '' })).toContain('--no-session');
  });

  it('模型/工具/人设文件按顺序附加，任务始终在最后', () => {
    const args = buildSubagentArgs({
      ...base,
      model: 'deepseek/deepseek-flash',
      tools: ['read', 'grep'],
      promptPath: '/tmp/p.md',
    });
    expect(args).toEqual([
      '--mode', 'json', '-p', '--no-extensions', '--no-session',
      '--model', 'deepseek/deepseek-flash',
      '--tools', 'read,grep',
      '--append-system-prompt', '/tmp/p.md',
      'Task: 看看这个文件',
    ]);
  });

  it('空工具数组不生成 --tools（避免空参）', () => {
    const args = buildSubagentArgs({ ...base, tools: [] });
    expect(args).not.toContain('--tools');
  });
});
