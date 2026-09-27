/**
 * memory_search 工具层冒烟测试
 *
 * 背景：memory_recall 已并入 memory_search 的 summaries 参数（2026-09-27）。
 * 工具 execute 位于 Pi 依赖层（index.ts），无法用纯逻辑单测覆盖，
 * 故用 fake pi 驱动 register() 捕获工具定义后直接调用 execute。
 * 数据目录经 PI_MEMORY_DIR 隔离。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Pi 工具定义的运行时形状（adapters 编译后的 execute 签名） */
interface FakeTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    piCtx?: unknown,
  ) => Promise<{ content: { type: string; text: string }[] }>;
}

interface FakePi {
  tools: Map<string, FakeTool>;
  registerTool: (t: FakeTool) => void;
  registerCommand: () => void;
  on: () => void;
}

function makeFakePi(): { pi: FakePi } {
  const tools = new Map<string, FakeTool>();
  const pi: FakePi = {
    tools,
    registerTool: (t) => {
      tools.set(t.name, t);
    },
    registerCommand: () => {},
    on: () => {},
  };
  return { pi };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-search-tool-'));
  process.env.PI_MEMORY_DIR = dir;
  delete process.env.PI_MEMORY_NAMESPACE;
  delete process.env.PI_MEMORY_TRACE_FILE;
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function loadRegisteredTools(): Promise<Map<string, FakeTool>> {
  const { register } = await import('../index');
  const { pi } = makeFakePi();
  register(pi as unknown as ExtensionAPI);
  return pi.tools;
}

function writeSummaries(): void {
  writeFileSync(
    join(dir, 'summaries.json'),
    JSON.stringify({
      version: 1,
      summaries: [
        {
          id: 's1',
          sessionId: 'sess-1',
          ts: '2026-09-27T10:00:00.000Z',
          title: '工具面收窄',
          fullText: '讨论了 enable_tool 与 memory_recall 的处置',
          decisions: [],
          facts: [],
          prefs: [],
          lessons: [],
        },
      ],
    }),
  );
}

describe('memory_search 工具（含 summaries 参数）', () => {
  it('注册 memory_search，且不再注册 memory_recall', async () => {
    const tools = await loadRegisteredTools();
    expect(tools.has('memory_search')).toBe(true);
    expect(tools.has('memory_recall')).toBe(false);
  });

  it('无匹配记忆时返回提示', async () => {
    const tools = await loadRegisteredTools();
    const tool = tools.get('memory_search')!;
    const res = await tool.execute('c1', { query: '绝对不存在的关键词zzq' });
    expect(res.content[0].text).toContain('无匹配的记忆');
  });

  it('summaries=true 附带最近会话摘要，缺省时不附带', async () => {
    writeSummaries();
    const tools = await loadRegisteredTools();
    const tool = tools.get('memory_search')!;

    const withSummaries = await tool.execute('c1', { summaries: true });
    const text = withSummaries.content[0].text;
    expect(text).toContain('最近会话摘要');
    expect(text).toContain('工具面收窄');
    expect(text).toContain('讨论了 enable_tool 与 memory_recall 的处置');

    const without = await tool.execute('c2', {});
    expect(without.content[0].text).not.toContain('最近会话摘要');
  });
});
