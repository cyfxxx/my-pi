/**
 * bash 命令形态的可观测化（P4 第三批，2026-10-01）
 *
 * 背景：APPEND_SYSTEM.md 的「使用 bash 时优先合并多个独立检查为一次调用，避免逐条执行碎命令」
 * 一直是纯软引导。实测（6 个会话 / 1103 条真实命令）**单命令占比仅 1.4%**、每步 bash 调用
 * p50=1/p90=2/max=3 —— 规则被稳定遵守，故正确处置是"变成可观测指标防漂移"，而不是再加限制。
 *
 * 本测试锁两件事：
 *   1. `analyzeBashCommand` 的判定语义（引号内的连接符不算、段数口径）；
 *   2. `tool_result` 钩子确实把 `merged`/`segments` 写进 `usage.jsonl`（指标的数据来源），
 *      且计时用 `toolCallId` 而非工具名（pi 默认并行执行，同名工具一轮多次调用时按名键会互相覆盖）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { analyzeBashCommand } from '../usage-stats';

type Handler = (event: unknown, ctx?: unknown) => unknown;

function makeFakePi(): { pi: unknown; hooks: Map<string, Handler[]> } {
  const hooks = new Map<string, Handler[]>();
  const pi = {
    registerTool: () => {},
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    on: (ev: string, h: Handler) => {
      const arr = hooks.get(ev) ?? [];
      arr.push(h);
      hooks.set(ev, arr);
    },
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  };
  return { pi, hooks };
}

let root = '';

/**
 * 注册一次扩展、取回钩子。
 *
 * 注意：`tool_call` 与 `tool_result` **必须来自同一次注册**——否则两次 `import` 得到的是
 * 两个模块实例（`vi.resetModules()`），各自的 `toolState` 互不可见，计时必然丢失。
 */
async function hooksOf(...events: string[]): Promise<Map<string, Handler>> {
  vi.resetModules();
  const { register } = await import('../index');
  const { pi, hooks } = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  const out = new Map<string, Handler>();
  for (const ev of events) {
    const hs = hooks.get(ev) ?? [];
    expect(hs.length).toBeGreaterThan(0);
    out.set(ev, hs[hs.length - 1]);
  }
  return out;
}

function usageLines(): Array<Record<string, unknown>> {
  const f = join(root, 'memory', 'context', 'usage.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'my-pi-bashshape-'));
  process.env.PI_MEMORY_DIR = join(root, 'memory');
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  vi.resetModules();
  rmSync(root, { recursive: true, force: true });
});

describe('analyzeBashCommand（命令形态判定）', () => {
  it('单命令 → merged=false, segments=1', () => {
    expect(analyzeBashCommand('git status')).toEqual({ segments: 1, merged: false });
    expect(analyzeBashCommand('  ls -la  ')).toEqual({ segments: 1, merged: false });
  });

  it('各种连接符都算合并，并计入段数', () => {
    expect(analyzeBashCommand('a; b')).toEqual({ segments: 2, merged: true });
    expect(analyzeBashCommand('a && b')).toEqual({ segments: 2, merged: true });
    expect(analyzeBashCommand('a || b')).toEqual({ segments: 2, merged: true });
    expect(analyzeBashCommand('a | b')).toEqual({ segments: 2, merged: true });
    expect(analyzeBashCommand('a\nb\nc')).toEqual({ segments: 3, merged: true });
    expect(analyzeBashCommand('a; b && c | d')).toEqual({ segments: 4, merged: true });
  });

  it('引号内的连接符不算（避免 echo "a;b" 误判）', () => {
    expect(analyzeBashCommand(`echo "a;b"`)).toEqual({ segments: 1, merged: false });
    expect(analyzeBashCommand(`echo 'a && b'`)).toEqual({ segments: 1, merged: false });
    expect(analyzeBashCommand('echo `a | b`')).toEqual({ segments: 1, merged: false });
    // 引号外仍有连接符时照常判定
    expect(analyzeBashCommand(`echo "a;b"; ls`)).toEqual({ segments: 2, merged: true });
  });

  it('空命令 → 单命令（不把空串当碎调用）', () => {
    expect(analyzeBashCommand('')).toEqual({ segments: 1, merged: false });
  });
});

describe('tool_result 写入命令形态（指标数据来源）', () => {
  it('bash：写入 merged/segments', async () => {
    const hook = (await hooksOf('tool_result')).get('tool_result') as Handler;
    await hook({ toolName: 'bash', toolCallId: 'c1', input: { command: 'a; b' }, content: 'ok', isError: false });
    await hook({ toolName: 'bash', toolCallId: 'c2', input: { command: 'git status' }, content: 'ok', isError: false });
    const lines = usageLines().filter((l) => l.tool === 'bash');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ merged: true, segments: 2 });
    expect(lines[1]).toMatchObject({ merged: false, segments: 1 });
  });

  it('非 bash 工具不带这两个字段（口径只针对 bash）', async () => {
    const hook = (await hooksOf('tool_result')).get('tool_result') as Handler;
    await hook({ toolName: 'read', toolCallId: 'c3', input: { file_path: '/x' }, content: 'ok', isError: false });
    const line = usageLines()[0];
    expect(line.merged).toBeUndefined();
    expect(line.segments).toBeUndefined();
  });

  it('并行同名工具：计时按 toolCallId 配对，互不覆盖', async () => {
    const h = await hooksOf('tool_call', 'tool_result');
    const call = h.get('tool_call') as Handler;
    const result = h.get('tool_result') as Handler;
    await call({ toolName: 'bash', toolCallId: 'p1', input: { command: 'a' } });
    await call({ toolName: 'bash', toolCallId: 'p2', input: { command: 'b' } });
    // p2 先返回：按名键的旧实现会把 p1 的起点一起删掉，p1 随后就没有时长
    await result({ toolName: 'bash', toolCallId: 'p2', input: { command: 'b' }, content: 'ok', isError: false });
    await result({ toolName: 'bash', toolCallId: 'p1', input: { command: 'a' }, content: 'ok', isError: false });
    const lines = usageLines().filter((l) => l.tool === 'bash');
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(typeof l.durationMs).toBe('number');
  });
});
