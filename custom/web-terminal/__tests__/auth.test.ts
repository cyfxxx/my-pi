/**
 * web-terminal/auth 回归测试：令牌、cookie 签名/过期/绑定、Host-Origin 信任栅栏。
 *
 * 这些是安全边界，测试要覆盖"看起来像可信但其实不是"的输入
 * （`127.0.0.1.evil.com`、跨站 Origin、篡改载荷、换 authority 重放）。
 */
import { describe, it, expect } from 'vitest';

import {
  AUTH_COOKIE_PREFIX,
  authCookieHeader,
  authCookieName,
  checkTrust,
  DEFAULT_COOKIE_DAYS,
  isLoopbackHost,
  isTrustedAuthority,
  mintLaunchToken,
  newSigningSecret,
  parseCookieHeader,
  safeEqualText,
  signAuthCookie,
  splitAuthority,
  verifyAuthCookie,
} from '../auth';

describe('auth: 令牌与密钥', () => {
  it('启动令牌与密钥都是 256 位随机且互不相同', () => {
    const tokens = new Set([mintLaunchToken(), mintLaunchToken(), mintLaunchToken()]);
    expect(tokens.size).toBe(3);
    expect(mintLaunchToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSigningSecret()).toHaveLength(32);
  });
});

describe('auth: splitAuthority', () => {
  it('区分 host 与 port，并保留裸 IPv6', () => {
    expect(splitAuthority('127.0.0.1:7717')).toEqual({ host: '127.0.0.1', port: '7717' });
    expect(splitAuthority('LocalHost:80')).toEqual({ host: 'localhost', port: '80' });
    expect(splitAuthority('[::1]:7717')).toEqual({ host: '::1', port: '7717' });
    expect(splitAuthority('::1')).toEqual({ host: '::1' });
    expect(splitAuthority('example.com')).toEqual({ host: 'example.com' });
  });
});

describe('auth: isLoopbackHost', () => {
  it('只认真正的回环地址', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.9.9.9')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('不把域名里的 127 前缀或超大八位组当回环', () => {
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1evil')).toBe(false);
    expect(isLoopbackHost('1270.0.0.1')).toBe(false);
    expect(isLoopbackHost('127.0.0.999')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
  });
});

describe('auth: isTrustedAuthority', () => {
  it('回环始终可信；其余需要显式条目', () => {
    expect(isTrustedAuthority('127.0.0.1:7717')).toBe(true);
    expect(isTrustedAuthority('192.168.1.5:7717')).toBe(false);
    expect(isTrustedAuthority('192.168.1.5:7717', ['192.168.1.5:7717'])).toBe(true);
    expect(isTrustedAuthority('192.168.1.5:9999', ['192.168.1.5:7717'])).toBe(false);
    expect(isTrustedAuthority('192.168.1.5:9999', ['192.168.1.5'])).toBe(true);
    expect(isTrustedAuthority('BOX.local:7717', ['box.local'])).toBe(true);
  });
});

describe('auth: checkTrust', () => {
  it('缺少 Host 或 Host 不可信时拒绝', () => {
    expect(checkTrust({})).toMatchObject({ ok: false, status: 403 });
    expect(checkTrust({ host: 'evil.com' })).toMatchObject({ ok: false, status: 403 });
  });

  it('跨站请求与 Origin 不一致时拒绝', () => {
    expect(checkTrust({ host: '127.0.0.1:7717', secFetchSite: 'cross-site' })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkTrust({ host: '127.0.0.1:7717', origin: 'https://evil.com' })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkTrust({ host: '127.0.0.1:7717', origin: '不是 URL' })).toMatchObject({ ok: false, status: 403 });
  });

  it('回环同源、无 Origin（原生 fetch/健康检查）以及 Origin: null 都放行', () => {
    expect(checkTrust({ host: '127.0.0.1:7717' })).toEqual({ ok: true });
    expect(checkTrust({ host: '127.0.0.1:7717', origin: 'http://127.0.0.1:7717' })).toEqual({ ok: true });
    expect(checkTrust({ host: 'localhost:80', secFetchSite: 'same-origin' })).toEqual({ ok: true });
    expect(checkTrust({ host: '127.0.0.1:7717', origin: 'null' })).toEqual({ ok: true });
    expect(checkTrust({ host: '10.0.0.2:1', origin: 'http://10.0.0.2:1', trustedHosts: ['10.0.0.2:1'] })).toEqual({
      ok: true,
    });
  });
});

describe('auth: cookie 名与签名', () => {
  const secret = newSigningSecret();
  const authority = '127.0.0.1:7717';

  it('cookie 名按 authority 绑定且带前缀', () => {
    const name = authCookieName(authority);
    expect(name.startsWith(AUTH_COOKIE_PREFIX)).toBe(true);
    expect(name).toBe(authCookieName('127.0.0.1:7717'));
    expect(name).not.toBe(authCookieName('127.0.0.1:7718'));
    expect(authCookieName('LOCALHOST:1')).toBe(authCookieName('localhost:1'));
  });

  it('签发的 cookie 可校验，且格式为 v1.<payload>.<mac>', () => {
    const now = 1_700_000_000_000;
    const value = signAuthCookie(secret, authority, now);
    expect(value.split('.')).toHaveLength(3);
    expect(value.startsWith('v1.')).toBe(true);
    expect(verifyAuthCookie(secret, authority, value, now)).toBe(true);
  });

  it('默认有效期与 DEFAULT_COOKIE_DAYS 一致', () => {
    const now = 1_700_000_000_000;
    const value = signAuthCookie(secret, authority, now);
    const body = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')) as {
      issuedAt: number;
      expiresAt: number;
    };
    expect(body.expiresAt - body.issuedAt).toBe(DEFAULT_COOKIE_DAYS * 24 * 60 * 60 * 1000);
    expect(verifyAuthCookie(secret, authority, value, now + DEFAULT_COOKIE_DAYS * 24 * 60 * 60 * 1000 - 1)).toBe(true);
    expect(verifyAuthCookie(secret, authority, value, now + DEFAULT_COOKIE_DAYS * 24 * 60 * 60 * 1000 + 1)).toBe(false);
  });

  it('篡改载荷、换密钥、换 authority、换端口都判否', () => {
    const now = 1_700_000_000_000;
    const value = signAuthCookie(secret, authority, now, 30);
    const [version, body, mac] = value.split('.');

    // 把过期时间改到 100 年后（签名不变）→ 必须判否
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload.expiresAt = now + 100 * 365 * 24 * 60 * 60 * 1000;
    const forgedBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    expect(verifyAuthCookie(secret, authority, `v1.${forgedBody}.${mac}`, now)).toBe(false);

    expect(verifyAuthCookie(newSigningSecret(), authority, value, now)).toBe(false);
    expect(verifyAuthCookie(secret, '127.0.0.1:7718', value, now)).toBe(false);
    expect(verifyAuthCookie(secret, 'localhost:7717', value, now)).toBe(false);
    expect(verifyAuthCookie(secret, authority, `${version}.${body}`, now)).toBe(false);
  });

  it('畸形输入一律返回 false 而不抛异常', () => {
    const now = Date.now();
    for (const bad of ['', 'v1', 'v2.a.b', 'v1..', 'v1.!!!.???', 'v1.' + Buffer.from('[]').toString('base64url') + '.x']) {
      expect(verifyAuthCookie(secret, authority, bad, now)).toBe(false);
    }
    expect(verifyAuthCookie(secret, authority, undefined, now)).toBe(false);
  });

  it('Set-Cookie 是 HttpOnly + SameSite=Strict 且不带 Secure（回环 HTTP）', () => {
    const header = authCookieHeader('n', 'v', 60);
    expect(header).toContain('n=v');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=60');
    expect(header).not.toContain('Secure');
  });
});

describe('auth: parseCookieHeader / safeEqualText', () => {
  it('解析多 cookie、跳过无值片段、同名取后者', () => {
    expect(parseCookieHeader('a=1; b=2')).toEqual({ a: '1', b: '2' });
    expect(parseCookieHeader('novalue; a=1')).toEqual({ a: '1' });
    expect(parseCookieHeader('a=1; a=2')).toEqual({ a: '2' });
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it('定长比较：长度不同直接判否，内容相同判真', () => {
    expect(safeEqualText('abc', 'abc')).toBe(true);
    expect(safeEqualText('abc', 'abd')).toBe(false);
    expect(safeEqualText('abc', 'abcd')).toBe(false);
    expect(safeEqualText('', '')).toBe(true);
  });
});
