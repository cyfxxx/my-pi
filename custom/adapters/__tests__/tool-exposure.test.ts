/**
 * 工具"暴露方式"守门（2026-10-07）
 *
 * 背景：browser 的 18 个工具（实测约 6.3KB 声明、30 天调用全部挤在 1 天内、此后 10 天零调用）
 * 改为 `exposure: 'deferred'` —— **注册但不声明**（不占请求前缀字节），模型用 `tool_search`
 * 按需拉出。这条链有三个必须同时成立的环节，任一断掉都会**静默**退化成"白占前缀"或"工具不可达"：
 *
 *   ① `custom/adapters/tool-adapter.ts` 必须把 `exposure` 透传给 pi（漏了 = 静默变成默认声明）；
 *   ② pi 的分词必须认识中文——原生 `split(/[^a-z0-9]+/)` 把 CJK 全部当分隔符丢掉，中文 query
 *      得到 0 个词、`tool_search` 永远答"No matching tools found."；而模型**不可能知道被隐藏的
 *      工具名**，于是只会得出"没有这个工具"。修正是 `patches/011-tool-search-cjk.patch`；
 *   ③ `tool_search` 本身必须处于激活状态（`portable/agent/settings.json` 的 `defaultTools`）。
 *
 * 本文件驱动的是 **pi 的真实实现**（`tokenize` / `createToolSearchDocument` / `tool_search` 定义），
 * 不是复刻——所以上游同步把补丁冲掉时，②会在这里变红，而不是等到线上"浏览器怎么不能用了"。
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerTool } from '../tool-adapter';

/**
 * 用**运行时拼出的路径**导入 vendor 源码（而不是写死的静态 import）。
 *
 * 原因：静态 import 会让 `tsc -p custom/` 顺着 import 把整棵 `vendor/pi` 源码纳入**自定义层**的
 * 类型检查，vendor 自身的类型问题（与本次改动无关）就会污染本仓库的 tsc 门禁。动态 specifier
 * tsc 无法解析，因此只做运行时加载；`__tests__/` 在 `check-conventions.sh` 里对动态 import 豁免。
 */
const VENDOR_TOOL_SEARCH = [
  '..',
  '..',
  '..',
  'vendor',
  'pi',
  'packages',
  'coding-agent',
  'src',
  'extensions',
  'tool-search',
  'tool',
].join('/');

/** vendor 侧用到的形状（只声明本文件真正调用的部分） */
interface VendorToolSearchModule {
  tokenize(text: string): string[];
  createToolSearchDocument(tool: unknown, namespace?: unknown): { name: string; text: string };
  createToolSearchToolDefinition(opts: { tools?: unknown }): {
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: unknown,
      onUpdate?: unknown,
      ctx?: unknown,
    ): Promise<{ content: { type: string; text: string }[]; details?: { loaded?: string[] } }>;
  };
}

let vendor: VendorToolSearchModule;
beforeAll(async () => {
  vendor = (await import(VENDOR_TOOL_SEARCH)) as VendorToolSearchModule;
});

interface Captured {
  name: string;
  description?: string;
  parameters?: unknown;
  exposure?: string;
}

/** 极简假 pi：收集 registerTool，并对功能注册期的钩子/命令等调用给空实现 */
function capturingPi(sink: Captured[]): ExtensionAPI {
  return {
    registerTool: (t: Captured) => sink.push(t),
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    on: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getThinkingLevel: () => 'high',
    setThinkingLevel: () => {},
    getFlag: () => undefined,
  } as unknown as ExtensionAPI;
}

let tmpRoot = '';
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'my-pi-exposure-'));
  process.env.PI_MEMORY_DIR = join(tmpRoot, 'memory');
  process.env.PI_CODING_AGENT_DIR = join(tmpRoot, 'agent');
});
afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('① 适配器必须透传 exposure', () => {
  it('deferred 工具会带着 exposure 传给 pi（漏转发 = 静默退化成默认声明）', () => {
    const sink: Captured[] = [];
    registerTool(capturingPi(sink), {
      name: 'probe_deferred',
      description: '探针',
      parameters: {},
      exposure: 'deferred',
      execute: async () => 'ok',
    });
    registerTool(capturingPi(sink), {
      name: 'probe_default',
      description: '探针',
      parameters: {},
      execute: async () => 'ok',
    });
    expect(sink[0].exposure).toBe('deferred');
    // 未声明的保持不传（让 pi 用它自己的默认值，而不是被我们写死成 direct）
    expect('exposure' in sink[1]).toBe(false);
  });
});

describe('② pi 的分词必须认识中文（patches/011）', () => {
  it('中文 query 不再被丢成 0 个词', () => {
    expect(vendor.tokenize('screenshot')).toContain('screenshot');
    const zh = vendor.tokenize('截图');
    expect(zh.length, `中文查询被丢空了：${JSON.stringify(zh)}（011 补丁是否还在？）`).toBeGreaterThan(0);
    expect(zh).toContain('截图');
  });

  it('中文工具描述会贡献检索词（文档不再只剩英文标识符）', () => {
    const doc = vendor.createToolSearchDocument({
      name: 'browser_screenshot',
      description: '对当前页面截图并保存到本地，返回文件路径。',
      parameters: { full_page: { description: '是否整页截图' } },
    });
    const terms = vendor.tokenize(doc.text);
    expect(terms).toContain('browser');
    expect(terms).toContain('screenshot');
    // 描述里的中文必须也能被检索到（上游原生行为下这里只有 6 个纯英文词）
    expect(terms).toContain('截图');
    expect(new Set(terms).size).toBeGreaterThan(8);
  });
});

describe('③ deferred 工具能被 tool_search 激活（pi 真实实现）', () => {
  const browserScreenshot = {
    name: 'browser_screenshot',
    description: '对当前页面截图并保存到本地，返回文件路径。',
    parameters: { full_page: { description: '是否整页截图' } },
    exposure: 'deferred',
  };
  const directTool = { name: 'bash', description: 'Run a shell command.', parameters: {}, exposure: 'direct' };

  function harness() {
    let active: string[] = ['tool_search', 'bash'];
    const calls: string[][] = [];
    const tools = {
      getAllTools: () => [browserScreenshot, directTool],
      getActiveTools: () => active,
      setActiveTools: (next: string[]) => {
        active = [...next];
        calls.push([...next]);
      },
    };
    return { tools, calls, activeNow: () => active };
  }

  it('中文 query 能命中 deferred 工具，并把它加入激活集（= 下一次请求才声明）', async () => {
    const h = harness();
    const def = vendor.createToolSearchToolDefinition({ tools: h.tools });
    const result = await def.execute('call-1', { query: '截图' });
    expect(h.calls.length, '中文 query 没能激活任何工具（011 补丁是否还在？）').toBeGreaterThan(0);
    expect(h.activeNow()).toContain('browser_screenshot');
    expect(result.details?.loaded).toContain('browser_screenshot');
    expect(result.content[0].text).toContain('browser_screenshot');
  });

  it('direct 工具不会被误加载（已在激活集里的也不重复）', async () => {
    const h = harness();
    const def = vendor.createToolSearchToolDefinition({ tools: h.tools });
    await def.execute('call-1', { query: 'bash' });
    expect(h.activeNow()).toEqual(['tool_search', 'bash']);
  });

  it('英文 query 仍然可用（补丁不得破坏原有路径）', async () => {
    const h = harness();
    const def = vendor.createToolSearchToolDefinition({ tools: h.tools });
    await def.execute('call-1', { query: 'screenshot' });
    expect(h.activeNow()).toContain('browser_screenshot');
  });
});

describe('④ browser 全部 18 个工具都是 deferred', () => {
  it('注册面里每个 browser_* 都必须带 exposure=deferred', async () => {
    const sink: Captured[] = [];
    const mod = await import('../../features/browser/index');
    mod.register(capturingPi(sink));
    const browserTools = sink.filter((t) => t.name.startsWith('browser_'));
    expect(browserTools.length, '没抓到 browser 工具（注册面变了？）').toBe(18);
    const notDeferred = browserTools.filter((t) => t.exposure !== 'deferred').map((t) => t.name);
    expect(notDeferred, `这些 browser 工具没有 deferred，会白占前缀：${notDeferred.join(', ')}`).toEqual([]);
  });
});
