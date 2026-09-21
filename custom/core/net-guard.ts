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

function blockedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isBlockedHost(hostname: string): boolean {
  const h = String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:')) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (h.startsWith('::ffff:')) return isBlockedHost(h.slice(7));
  if (blockedIpv4(h)) return true;
  return false;
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
