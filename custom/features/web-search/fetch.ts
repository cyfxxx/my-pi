/**
 * HTTP 抓取与 Bing 直搜（免 SearXNG 的 fallback）。
 * 迁移自 pi-tools `pi-web-search/fetch.ts` + `index.ts` 的 fetch_url/web_fetch 实现。
 */

import { isUrlAllowed } from '../../core/net-guard';
import { HTTP_TIMEOUT_MS } from './config';

// ── Bing 直搜（web_fetch） ─────────────────────────────────────

export async function searchDirect(
  query: string,
  maxResults = 5,
  signal?: AbortSignal,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<string> {
  // mkt/setlang 固定中文市场：Bing 会 302 到 cn.bing.com，避免结果随出口 IP 漂移
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-CN&setlang=zh-CN`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // 用户停止生成（signal）转发到内部 controller，与内部超时任一触发即中断
  const onUserAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onUserAbort);
  try {
    return await doSearch(url, maxResults, query, controller.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', onUserAbort);
  }
}

/** 解码 HTML 实体（标题/URL 中常见 &amp; &#39; 等） */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Bing 结果链接匹配。
 * 注意（原项目踩坑）：Bing（尤其 cn.bing.com）当前 HTML 为
 * `<h2 class=""><a target="_blank" href="…">`，属性出现在 href 之前，
 * 旧正则 `/<h2><a href="…">/` 完全匹配不到 → 工具返回"无结果"。这里放宽为
 * "h2 内任意属性顺序的 a[href]"，标题允许含 <strong> 等内联标签。
 */
const BING_LINK_RE = /<h2[^>]*>[\s\S]*?<a[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/gi;

/** 还原 Bing 跳转链接（/ck/a?...&u=a1<base64url>）为真实目标 URL */
export function decodeBingRedirect(url: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)bing\.com$/.test(u.hostname) || !u.pathname.startsWith('/ck/a')) return url;
    const raw = u.searchParams.get('u');
    if (!raw) return url;
    const b64 = raw.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return /^https?:\/\//.test(decoded) ? decoded : url;
  } catch {
    return url;
  }
}

/** 解析 Bing 搜索 HTML 为 ["1. 标题", "   URL", ...]（纯函数，便于测试） */
export function parseBingResults(html: string, maxResults = 5): string[] {
  const out: string[] = [];
  const re = new RegExp(BING_LINK_RE.source, BING_LINK_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length / 2 < maxResults) {
    const title = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (title) {
      out.push(`${out.length / 2 + 1}. ${title}`);
      out.push(`   ${decodeBingRedirect(decodeHtmlEntities(m[1]))}`);
    }
  }
  return out;
}

async function doSearch(
  url: string,
  maxResults: number,
  query: string,
  reqSignal: AbortSignal,
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: reqSignal,
  });
  // fetch 失败必抛异常（网络/DNS/超时 abort），不会返回 null
  if (!res.ok) {
    // 取消未消费的响应体，避免连接悬挂（socket 无法复用/泄漏）
    try {
      await res.body?.cancel();
    } catch {
      /* 已释放 */
    }
    return `搜索失败: HTTP ${res.status}`;
  }
  const html = await res.text();
  const results = parseBingResults(html, maxResults);
  if (results.length === 0) {
    return `搜索 "${query}" 无结果（Bing 可能返回了验证页面）`;
  }
  return `搜索: "${query}"\n\n${results.join('\n')}`;
}

// ── fetch_url 支撑：分块读取响应体（最多 cap 字节） ─────────────

export async function readBodyLimited(
  res: Response,
  cap: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    return { text: await res.text(), truncated: false };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (total < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const room = cap - total;
    if (value.length > room) {
      // 单块即超出 cap：直接判定截断（否则会漏报，pi-tools 原实现在此有缺陷）
      chunks.push(value.subarray(0, room));
      total = cap;
      truncated = true;
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  if (truncated || total >= cap) {
    // 恰好读满 cap 且未确认剩余：再读一块判断（防 truncated 误报）；无论结果都 cancel 释放连接
    if (!truncated) {
      try {
        const { done } = await reader.read();
        truncated = !done;
      } catch {
        truncated = true;
      }
    }
    try {
      await reader.cancel();
    } catch {
      /* 流已结束 */
    }
  }
  return { text: Buffer.concat(chunks).toString('utf-8'), truncated };
}

export const FETCH_BODY_CAP = 512 * 1024;

/** 手动重定向上限（每跳复检 isUrlAllowed） */
const MAX_REDIRECTS = 5;

/** 轻量 HTTP GET（协议白名单 + 超时 + 响应体上限），返回格式化文本 */
export async function fetchUrl(
  url: string,
  maxLength = 8000,
  timeoutMs = HTTP_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `无效 URL：${url}`;
  }
  // 协议白名单：仅放行 http/https（纵深防御，本地 SearXNG 等合法用途不受影响）
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `不支持的协议 "${parsed.protocol}"：fetch_url 仅允许 http:/https: URL`;
  }
  // SSRF 防护：拒绝回环/内网/链路本地/云元数据主机
  if (!isUrlAllowed(url)) {
    return `拒绝访问内网/回环地址：${parsed.hostname}（fetch_url 仅允许公网 http/https）`;
  }
  const cap = Math.max(0, Math.min(maxLength, 200000));
  const controller = new AbortController();
  const onUserAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onUserAbort);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 手动跟随重定向：每跳复检 isUrlAllowed，防止公网 URL 302 跳到内网（SSRF）
    let currentUrl = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PiBot/1.0)' },
        redirect: 'manual',
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get('location');
      try {
        await res.body?.cancel();
      } catch {
        /* 已释放 */
      }
      if (!loc) break;
      if (hop === MAX_REDIRECTS) return `重定向次数过多（上限 ${MAX_REDIRECTS}）：${currentUrl}`;
      let next: string;
      try {
        next = new URL(loc, currentUrl).toString();
      } catch {
        return `重定向目标无效：${loc.slice(0, 120)}`;
      }
      if (!isUrlAllowed(next)) {
        return `拒绝重定向到内网/回环地址：${new URL(next).hostname}（fetch_url 仅允许公网 http/https）`;
      }
      currentUrl = next;
    }
    if (!res) return '请求失败: 未获得响应';
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        /* 已释放 */
      }
      return `HTTP ${res.status}: ${res.statusText}`;
    }
    const { text, truncated: bodyTruncated } = await readBodyLimited(res, FETCH_BODY_CAP);
    const out =
      text.length > cap
        ? text.slice(0, cap) + `\n\n...（共 ${text.length} 字符，仅显示前 ${cap} 字符）`
        : text;
    const suffix = bodyTruncated ? '\n\n[响应体超过 512KB 已截断读取]' : '';
    return out + suffix;
  } catch (e) {
    return `请求失败: ${(e as Error).message}`;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', onUserAbort);
  }
}
