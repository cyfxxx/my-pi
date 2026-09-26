/**
 * web-search fetch 纯逻辑回归测试（迁移自 pi-tools pi-web-search/tests/fetch.test.ts 语义）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readBodyLimited,
  fetchUrl,
  resolveSearxngUrl,
  resolveSearchTimeout,
  parseBingResults,
  decodeHtmlEntities,
  decodeBingRedirect,
} from '../logic';

const OLD_AGENT = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
  // 隔离 settings.json（避免读取真实 portable/agent/settings.json 的 pi-web-search 段）
  process.env.PI_CODING_AGENT_DIR = '/tmp/opencode/__nonexistent_agent_dir__';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SEARXNG_URL;
  delete process.env.PI_WEB_TOOLKIT_SEARXNG_URL;
  delete process.env.PI_WEB_TOOLKIT_SEARCH_TIMEOUT;
  if (OLD_AGENT === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = OLD_AGENT;
});

describe('resolveSearxngUrl', () => {
  it('优先 SEARXNG_URL，其次 pi-tools 兼容名，未配置为 null', () => {
    expect(resolveSearxngUrl()).toBeNull();
    process.env.PI_WEB_TOOLKIT_SEARXNG_URL = 'http://127.0.0.1:8889';
    expect(resolveSearxngUrl()).toBe('http://127.0.0.1:8889');
    process.env.SEARXNG_URL = 'https://searx.be';
    expect(resolveSearxngUrl()).toBe('https://searx.be');
  });
});

describe('resolveSearchTimeout', () => {
  it('默认 30s；环境变量覆盖', () => {
    expect(resolveSearchTimeout()).toBe(30000);
    process.env.PI_WEB_TOOLKIT_SEARCH_TIMEOUT = '5000';
    expect(resolveSearchTimeout()).toBe(5000);
  });
});

describe('parseBingResults（原项目踩坑：属性顺序/实体/跳转）', () => {
  const html = `<div class="b_algo"><h2 class=""><a target="_blank" target="_blank" href="https://juejin.cn/post/1" h="ID=SERP,1"><strong>Rust Web</strong> 框架 &amp; 选型</a></h2></div>
    <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9yb2NrZXQucnMv" h="ID=SERP,2">Rocket &lt;Rust&gt;</a></h2></li>`;

  it('匹配带属性/内联标签的 h2>a，解码实体', () => {
    const r = parseBingResults(html, 5);
    expect(r[0]).toContain('Rust Web 框架 & 选型');
    expect(r[1]).toBe('   https://juejin.cn/post/1');
  });

  it('还原 bing /ck/a 跳转为真实 URL', () => {
    const r = parseBingResults(html, 5);
    expect(r[3]).toBe('   https://rocket.rs/');
    expect(r[2]).toContain('Rocket <Rust>');
  });

  it('无结果时返回空数组', () => {
    expect(parseBingResults('<html><body>no results</body></html>', 5)).toEqual([]);
  });
});

describe('decodeHtmlEntities / decodeBingRedirect', () => {
  it('解码常见实体', () => {
    expect(decodeHtmlEntities('a &amp; b &#39;c&#39; &lt;d&gt;')).toBe("a & b 'c' <d>");
  });
  it('非 bing 链接原样返回', () => {
    expect(decodeBingRedirect('https://example.com/a?u=a1x')).toBe('https://example.com/a?u=a1x');
  });
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

describe('fetchUrl: SSRF 防护', () => {
  it('拒绝回环/内网/元数据地址', async () => {
    for (const u of [
      'http://127.0.0.1:8080/x',
      'http://localhost/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://[::1]/',
    ]) {
      expect(await fetchUrl(u), u).toContain('拒绝访问内网');
    }
  });

  it('重定向到内网 → 拒绝且不再请求目标（回归：审计发现跟进 302 绕过）', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    }));
    const out = await fetchUrl('https://example.com/start');
    expect(out).toContain('拒绝重定向到内网');
    expect(calls).toHaveLength(1);
  });

  it('重定向到公网 → 跟随并返回最终内容', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: 'https://example.com/final' } })
        : new Response('ok-final', { status: 200 });
    }));
    expect(await fetchUrl('https://example.com/start')).toBe('ok-final');
    expect(calls).toEqual(['https://example.com/start', 'https://example.com/final']);
  });
});

describe('sanitizeMaxResults', () => {
  it('非有限/小于 1 → 回退 5；其余向下取整', async () => {
    const { sanitizeMaxResults } = await import('../logic');
    expect(sanitizeMaxResults(undefined)).toBe(5);
    expect(sanitizeMaxResults(NaN)).toBe(5);
    expect(sanitizeMaxResults(0)).toBe(5);
    expect(sanitizeMaxResults(0.5)).toBe(5);
    expect(sanitizeMaxResults(-3)).toBe(5);
    expect(sanitizeMaxResults(3.9)).toBe(3);
  });
});

describe('fetchWithRetry: 取消即停', () => {
  it('signal 已 abort 时不重试，直接抛错', async () => {
    const { fetchWithRetry } = await import('../logic');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(fetchWithRetry('https://example.com', { signal: ctrl.signal, headers: {} }, 3)).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
