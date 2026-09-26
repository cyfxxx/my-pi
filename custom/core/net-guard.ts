/**
 * net-guard.ts — URL/主机安全判定（纯逻辑，零 Pi 依赖）
 *
 * 防止工具被 prompt injection 诱导访问内网/回环/云元数据地址（SSRF）。
 * 基于主机名/字面 IP 判定，不做 DNS 解析，因此无法防御 DNS rebinding；
 * 作为纵深防御的第一道闸，覆盖常见内网与元数据端点。
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'metadata',
  'metadata.google.internal',
]);

/** 归一化主机名：去方括号、小写、去 FQDN 尾点 */
function normalizeHost(hostname: string): string {
  return String(hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
}

/** IPv4 前两段的内网/特殊网段判定（回环、私有、链路本地、共享、基准、组播/保留） */
function blockedIpv4Parts(a: number, b: number): boolean {
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function blockedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  return blockedIpv4Parts(a, b);
}

/**
 * 解析 IPv6 为 8 组 16 位整数：支持 `::` 压缩与内嵌点分 IPv4（如 `::ffff:127.0.0.1`）。
 * URL 会把 IPv4-mapped 规范化为十六进制组（`http://[::ffff:127.0.0.1]/` → `[::ffff:7f00:1]`），
 * 因此必须数值解析后判定，不能只匹配点分字符串。非法输入返回 null。
 */
function parseIpv6Groups(host: string): number[] | null {
  if (!host.includes(':')) return null;
  let body = host;
  let embedded: number[] | null = null;
  const v4 = host.match(/^(.*):(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = [Number(v4[2]), Number(v4[3]), Number(v4[4]), Number(v4[5])];
    if (parts.some((n) => n > 255)) return null;
    body = v4[1];
    // 贪婪匹配会吃掉 `::` 的第二个冒号（`::127.0.0.1` → body `:`），补回再解析
    if (body.endsWith(':') && !body.endsWith('::')) body += ':';
    embedded = [(parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]];
  }
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const left = parseGroups(halves[0]);
  const right = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!left || !right) return null;
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length - (embedded ? 2 : 0);
    if (missing < 0) return null;
    return [...left, ...Array(missing).fill(0), ...right, ...(embedded ?? [])];
  }
  const all = [...left, ...(embedded ?? [])];
  return all.length === 8 ? all : null;
}

/** 内网/回环/链路本地/唯一本地/IPv4 映射与 NAT64 形态的 IPv6 判定 */
function blockedIpv6(host: string): boolean {
  const g = parseIpv6Groups(host);
  if (!g) return false;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 站点本地（已弃用仍拦截）
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
  const mappedV4 = (hi: number): boolean => blockedIpv4Parts((hi >> 8) & 0xff, hi & 0xff);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return mappedV4(g[6]); // ::ffff:0:0/96
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return mappedV4(g[6]); // ::ffff:0:0:0/96 IPv4-translated
  if (g.slice(0, 6).every((x) => x === 0)) return mappedV4(g[6]); // ::/96 IPv4-compatible
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return mappedV4(g[6]); // 64:ff9b::/96 NAT64
  }
  return false;
}

export function isBlockedHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.includes(':')) return blockedIpv6(h);
  return blockedIpv4(h);
}

/** 仅放行 http/https 且主机不在内网/回环/元数据范围 */
export function isUrlAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return !isBlockedHost(parsed.hostname);
}
