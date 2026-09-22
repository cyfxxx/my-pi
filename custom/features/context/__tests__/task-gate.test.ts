/**
 * task-gate / context-resolver 纯逻辑测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvRatio, resolveContext, hasBackgroundTask } from '../budget/task-gate';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'task-gate-'));
  process.env.PI_TMUX_REGISTRY = join(dir, 'tmux-registry.json');
});

afterEach(() => {
  delete process.env.PI_TMUX_REGISTRY;
  delete process.env.PI_SESSION_ID;
  delete process.env.PI_CONTEXT_RATIO_TEST;
  rmSync(dir, { recursive: true, force: true });
});

describe('readEnvRatio', () => {
  it('合法 0-1 返回数值，其余 undefined', () => {
    process.env.PI_CONTEXT_RATIO_TEST = '0.8';
    expect(readEnvRatio('PI_CONTEXT_RATIO_TEST')).toBe(0.8);
    process.env.PI_CONTEXT_RATIO_TEST = '1.2';
    expect(readEnvRatio('PI_CONTEXT_RATIO_TEST')).toBeUndefined();
    process.env.PI_CONTEXT_RATIO_TEST = 'abc';
    expect(readEnvRatio('PI_CONTEXT_RATIO_TEST')).toBeUndefined();
    delete process.env.PI_CONTEXT_RATIO_TEST;
    expect(readEnvRatio('PI_CONTEXT_RATIO_TEST')).toBeUndefined();
  });
});

describe('resolveContext', () => {
  it('优先真实 getContextUsage', () => {
    const r = resolveContext({ getContextUsage: () => ({ tokens: 123, contextWindow: 1000 }) }, 500, 2000);
    expect(r).toEqual({ tokens: 123, window: 1000 });
  });

  it('usage 不可用时回退到 provider token + 窗口', () => {
    expect(resolveContext({}, 500, 2000)).toEqual({ tokens: 500, window: 2000 });
    expect(resolveContext({ getContextUsage: () => ({ tokens: 0 }) }, 500, 2000)).toEqual({ tokens: 500, window: 2000 });
  });

  it('都不可用返回 null', () => {
    expect(resolveContext({}, 0, 2000)).toBeNull();
    expect(resolveContext({}, 500, 0)).toBeNull();
  });
});

describe('hasBackgroundTask', () => {
  it('无 PI_SESSION_ID 时为 false（门惰性安全）', () => {
    expect(hasBackgroundTask()).toBe(false);
  });

  it('注册表不存在时为 false', () => {
    process.env.PI_SESSION_ID = 'sess-1';
    expect(hasBackgroundTask()).toBe(false);
  });

  it('注册表中无本会话条目时为 false', () => {
    process.env.PI_SESSION_ID = 'sess-1';
    writeFileSync(process.env.PI_TMUX_REGISTRY!, JSON.stringify({ sessions: { a: { owner: 'other', name: 'x' } } }));
    expect(hasBackgroundTask()).toBe(false);
  });
});
