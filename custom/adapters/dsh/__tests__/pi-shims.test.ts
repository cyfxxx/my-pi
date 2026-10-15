/**
 * pi 包 shim 的守门测试
 *
 * 两件事：
 *   ① **漂移守门**（最重要）：从 `ui-adapter.ts` / `session-adapter.ts` 里抠出对 pi 包的
 *      **运行时** import 名单，逐名断言 shim 真的导出了它 —— 否则 DSH 部署会在加载期
 *      报 `ERR_MODULE_NOT_FOUND`（而本仓的 tsc 用的是 vendor/pi 的类型映射，**查不出来**）。
 *   ② 降级行为：纯计算函数要真算；惰性组件要能构造；会话枚举要**返回空 + 上报**而不是抛错。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { resetShimReports } from '../pi-shims/report.js';
import * as tuiShim from '../pi-shims/tui/index.js';
import * as codingAgentShim from '../pi-shims/coding-agent/index.js';

const ADAPTER_DIR = join(__dirname, '..', '..');

/** 抠出某文件里对某 specifier 的**运行时** import 名单（`import type` 不算） */
function runtimeImportsOf(file: string, specifier: string): string[] {
  const source = readFileSync(join(ADAPTER_DIR, file), 'utf8');
  const names: string[] = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('import ')) continue;
    if (trimmed.startsWith('import type ')) continue;
    if (!trimmed.includes(`'${specifier}'`)) continue;
    const match = /\{([^}]*)\}/.exec(trimmed);
    if (!match) continue; // 默认导入/命名空间导入（本仓没有）——若有，测试会因名单为空而漏，故下面另有断言
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('pi 包 shim：漂移守门', () => {
  it('ui-adapter 运行时用到的 pi-tui 符号，shim 全都导出', () => {
    const used = runtimeImportsOf('ui-adapter.ts', '@earendil-works/pi-tui');
    expect(used.length).toBeGreaterThan(0); // 名单为空说明解析口径失效（不是"没有依赖"）
    for (const name of used) {
      expect(Object.keys(tuiShim), `pi-tui shim 缺 ${name}`).toContain(name);
    }
  });

  it('两个适配器运行时用到的 pi-coding-agent 符号，shim 全都导出', () => {
    const used = [
      ...runtimeImportsOf('ui-adapter.ts', '@earendil-works/pi-coding-agent'),
      ...runtimeImportsOf('session-adapter.ts', '@earendil-works/pi-coding-agent'),
    ];
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      expect(Object.keys(codingAgentShim), `pi-coding-agent shim 缺 ${name}`).toContain(name);
    }
  });
});

describe('pi-tui shim：纯计算部分是真实现', () => {
  it('visibleWidth 按东亚宽度算列数', () => {
    expect(tuiShim.visibleWidth('abc')).toBe(3);
    expect(tuiShim.visibleWidth('中文')).toBe(4);
    expect(tuiShim.visibleWidth('中a文b')).toBe(6);
    expect(tuiShim.visibleWidth('')).toBe(0);
  });

  it('truncateToWidth 按列宽截断并追加省略号', () => {
    expect(tuiShim.truncateToWidth('abcdef', 10)).toBe('abcdef');
    expect(tuiShim.truncateToWidth('abcdef', 4)).toBe('abc…');
    expect(tuiShim.truncateToWidth('abcdef', 4, '')).toBe('abcd');
    expect(tuiShim.visibleWidth(tuiShim.truncateToWidth('中文中文', 5))).toBeLessThanOrEqual(5);
  });
});

describe('pi-tui shim：惰性组件可构造、不抛错', () => {
  it('Text/Spacer/Markdown/Container 可构造并拼接（DSH 不渲染，但注册期不能崩）', () => {
    const container = new tuiShim.Container();
    container.addChild(new tuiShim.Text('a'));
    container.addChild(new tuiShim.Spacer(1));
    container.addChild(new tuiShim.Markdown('# t'));
    expect(container.render()).toEqual([]);
    container.clear();
    expect(container.children.length).toBe(0);
  });

  it('已知键可用；未知键返回占位并上报（不静默给 undefined）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    resetShimReports();
    expect(tuiShim.Key.ctrlAlt('p')).toBe('ctrl+alt+p');
    const unknown = (tuiShim.Key as Record<string, (key: string) => unknown>).someFutureKey('x');
    expect(String(unknown)).toContain('unknown-key:someFutureKey');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('pi-coding-agent shim：降级但显式', () => {
  beforeEach(() => resetShimReports());

  it('getMarkdownTheme 返回可用的占位对象（渲染路径不崩）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const theme = codingAgentShim.getMarkdownTheme();
    expect(typeof theme).toBe('object');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('SessionManager 列出会话返回空数组并上报（不是抛错，也不是假装成功）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(codingAgentShim.SessionManager.list('/tmp')).resolves.toEqual([]);
    await expect(codingAgentShim.SessionManager.listAll()).resolves.toEqual([]);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('SessionManager'))).toBe(true);
    warn.mockRestore();
  });
});
