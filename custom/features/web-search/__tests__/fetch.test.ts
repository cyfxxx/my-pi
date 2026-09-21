/**
 * web-search fetch 纯逻辑回归测试（迁移自 pi-tools pi-web-search/tests/fetch.test.ts 语义）
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readBodyLimited, fetchUrl } from '../logic';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readBodyLimited', () => {
  it('未超 cap → 完整读取，truncated=false', async () => {
    const r = await readBodyLimited(new Response('hello'), 100);
    expect(r.text).toBe('hello');
    expect(r.truncated).toBe(false);
  });

  it('超 cap → 截断读取，truncated=true', async () => {
    const r = await readBodyLimited(new Response('hello world'), 5);
    expect(r.text).toBe('hello');
    expect(r.truncated).toBe(true);
  });
});

describe('fetchUrl', () => {
  it('无效 URL → 提示无效', async () => {
    expect(await fetchUrl('not a url')).toContain('无效 URL');
  });

  it('非 http/https 协议 → 拒绝', async () => {
    expect(await fetchUrl('ftp://example.com/x')).toContain('不支持的协议');
    expect(await fetchUrl('file:///etc/passwd')).toContain('不支持的协议');
  });

  it('正常响应 → 返回正文', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('abcdefg', { status: 200 })));
    expect(await fetchUrl('https://example.com', 100)).toBe('abcdefg');
  });

  it('超过 max_length → 截断并标注总长', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('abcdefg', { status: 200 })));
    const out = await fetchUrl('https://example.com', 3);
    expect(out.startsWith('abc')).toBe(true);
    expect(out).toContain('共 7 字符');
  });

  it('HTTP 非 2xx → 返回状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404, statusText: 'Not Found' })));
    expect(await fetchUrl('https://example.com')).toContain('HTTP 404');
  });

  it('fetch 抛错 → 友好错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('boom');
    }));
    expect(await fetchUrl('https://example.com')).toContain('请求失败: boom');
  });
});
