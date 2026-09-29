/**
 * web-terminal/auth.ts — 浏览器访问的令牌、cookie 与信任栅栏（纯逻辑，零 Pi 依赖）
 *
 * 设计对齐 dsh web 的浏览器鉴权（`@deepseek-ai/dsh-client-connection`）：
 *   1. 进程启动时生成一次性随机 token 并随 URL 打印；浏览器首次 `GET /?token=…` 用它换取
 *      签名 cookie，随后 303 重定向到干净路径（token 不再出现在地址栏/历史里）；
 *   2. cookie 用 HMAC-SHA256 签名，密钥持久化在 agentDir（每环境独立），因此重启 web-terminal
 *      不会让已授权的浏览器掉线；
 *   3. cookie 名与载荷都绑定 authority（host:port），同一浏览器访问不同端口互不串用；
 *   4. 每个请求先过 Host / Origin 栅栏，防 DNS rebinding 与跨站请求。栅栏只决定"能不能谈"，
 *      不建立身份——身份仍由 cookie 决定。
 *
 * 本文件是纯函数层：不碰 HTTP、不碰文件系统，便于单测覆盖（见 __tests__/auth.test.ts）。
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** cookie 名前缀。名字里带 authority 摘要，避免多端口/多主机互相覆盖。 */
export const AUTH_COOKIE_PREFIX = 'mypi-web-auth-'

/** 根路径上用于换取 cookie 的查询参数名。 */
export const AUTH_TOKEN_PARAM = 'token'

/** cookie 载荷版本，便于将来换签名方案时识别旧值。 */
const AUTH_COOKIE_VERSION = 'v1'

/** 默认 cookie 有效期（天）。对齐 dsh web 的 `cookieMaxAgeDays` 默认值。 */
export const DEFAULT_COOKIE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** 生成一次性启动 token（256 位随机，base64url）。 */
export function mintLaunchToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 生成 cookie 签名密钥（256 位随机）。 */
export function newSigningSecret(): Buffer {
  return randomBytes(32)
}

/**
 * 拆分 authority 为 host 与 port。
 *
 * 支持三种写法：`host:port`、`[::1]:port`、裸 IPv6（`::1`）。裸 IPv6 整体视为主机名，
 * 否则会把 `::1` 的冒号误判成端口分隔符。
 */
export function splitAuthority(authority: string): { host: string; port?: string } {
  const raw = authority.trim().toLowerCase()
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end < 0) return { host: raw }
    const host = raw.slice(1, end)
    const rest = raw.slice(end + 1)
    return rest.startsWith(':') ? { host, port: rest.slice(1) } : { host }
  }
  const first = raw.indexOf(':')
  const last = raw.lastIndexOf(':')
  // 只有一个冒号才可能是 host:port；多个冒号说明是裸 IPv6。
  if (first >= 0 && first === last) return { host: raw.slice(0, first), port: raw.slice(first + 1) }
  return { host: raw }
}

/** 判定主机名是否属于本机回环。`127.0.0.1.evil.com` 之类必须判否。 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (m === null) return false
  const octets = m.slice(1).map((part) => Number(part))
  if (octets.some((n) => n > 255)) return false
  return octets[0] === 127
}

/**
 * 判定 authority 是否可信：回环一律可信；此外允许 `trustedHosts` 里的显式条目。
 * 条目写成 `host:port` 时要求端口完全一致；写成无端口 `host` 时匹配该主机的任意端口。
 */
export function isTrustedAuthority(authority: string, trustedHosts: readonly string[] = []): boolean {
  const normalized = authority.trim().toLowerCase()
  const { host } = splitAuthority(normalized)
  if (isLoopbackHost(host)) return true
  for (const entry of trustedHosts) {
    const candidate = entry.trim().toLowerCase()
    if (candidate === '') continue
    if (candidate === normalized) return true
    if (!candidate.includes(':') && splitAuthority(candidate).host === host) return true
  }
  return false
}

export interface TrustInput {
  host?: string
  origin?: string
  secFetchSite?: string
  trustedHosts?: readonly string[]
}

export type TrustDecision = { ok: true } | { ok: false; status: number; reason: string }

/**
 * 请求信任栅栏。返回 403 的具体理由，便于排查（对端拿到的是粗粒度 403，细节只进服务端日志）。
 */
export function checkTrust(input: TrustInput): TrustDecision {
  const host = input.host?.trim() ?? ''
  if (host === '') return { ok: false, status: 403, reason: '缺少 Host 头' }
  if (!isTrustedAuthority(host, input.trustedHosts)) {
    return { ok: false, status: 403, reason: `Host 不在信任范围: ${host}` }
  }
  // 浏览器明确的跨站请求直接拒绝（DNS rebinding / CSRF 的第一道闸）。
  if ((input.secFetchSite ?? '').trim().toLowerCase() === 'cross-site') {
    return { ok: false, status: 403, reason: '拒绝跨站请求（sec-fetch-site: cross-site）' }
  }
  const origin = input.origin?.trim() ?? ''
  if (origin !== '' && origin !== 'null') {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return { ok: false, status: 403, reason: `Origin 无法解析: ${origin}` }
    }
    if (originHost.toLowerCase() !== host.toLowerCase()) {
      return { ok: false, status: 403, reason: `Origin 与 Host 不一致: ${originHost} vs ${host}` }
    }
  }
  return { ok: true }
}

/** cookie 名 = 前缀 + authority 摘要，authority 变化即换名（旧 cookie 自然失效）。 */
export function authCookieName(authority: string): string {
  const digest = createHash('sha256').update(authority.trim().toLowerCase()).digest('base64url')
  return `${AUTH_COOKIE_PREFIX}${digest}`
}

export interface AuthCookiePayload {
  version: string
  authority: string
  issuedAt: number
  expiresAt: number
}

/**
 * 签发 cookie 值：`v1.<base64url(payload)>.<base64url(hmac)>`。
 * 载荷是**明文**的（只含 authority 与时间戳，无秘密）；签名保证不可伪造。
 */
export function signAuthCookie(
  secret: Buffer,
  authority: string,
  issuedAt: number,
  cookieDays: number = DEFAULT_COOKIE_DAYS,
): string {
  const payload: AuthCookiePayload = {
    version: AUTH_COOKIE_VERSION,
    authority: authority.trim().toLowerCase(),
    issuedAt,
    expiresAt: issuedAt + Math.max(1, Math.floor(cookieDays)) * DAY_MS,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const mac = createHmac('sha256', secret).update(`${AUTH_COOKIE_VERSION}.${body}`).digest('base64url')
  return `${AUTH_COOKIE_VERSION}.${body}.${mac}`
}

/**
 * 校验 cookie 值。任何结构/签名/归属/过期问题都返回 false，绝不抛异常
 * （调用点在 HTTP 热路径上，畸形输入必须视为未授权而不是 500）。
 */
export function verifyAuthCookie(
  secret: Buffer,
  authority: string,
  value: string | undefined,
  now: number,
): boolean {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 3) return false
  const [version, body, mac] = parts
  if (version !== AUTH_COOKIE_VERSION || body === '' || mac === '') return false

  const expected = createHmac('sha256', secret).update(`${version}.${body}`).digest('base64url')
  if (!safeEqualText(expected, mac)) return false

  let payload: AuthCookiePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AuthCookiePayload
  } catch {
    return false
  }
  if (payload === null || typeof payload !== 'object') return false
  if (payload.version !== AUTH_COOKIE_VERSION) return false
  if (typeof payload.authority !== 'string') return false
  if (payload.authority !== authority.trim().toLowerCase()) return false
  if (typeof payload.expiresAt !== 'number' || !Number.isFinite(payload.expiresAt)) return false
  return payload.expiresAt > now
}

/** 定长安全的字符串比较；长度不同直接判否（长度不构成秘密泄露）。 */
export function safeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** 解析 Cookie 头为映射（同名取最后一个，与浏览器行为一致）。 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name === '') continue
    out[name] = part.slice(eq + 1).trim()
  }
  return out
}

/**
 * 组装 Set-Cookie 头。
 *
 * 刻意**不加** `Secure`：服务只监听回环 HTTP，加了浏览器会直接丢弃该 cookie。
 * 这也意味着不要把本服务暴露到非回环网络——若要，请自行加 TLS 反向代理并改这里。
 */
export function authCookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict`
}
