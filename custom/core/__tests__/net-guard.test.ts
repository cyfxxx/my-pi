import { describe, it, expect } from 'vitest';
import { isBlockedHost, isUrlAllowed } from '../net-guard';

describe('net-guard: SSRF 防护', () => {
  it('拦截回环/内网/链路本地/元数据主机', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      'metadata.google.internal',
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it('放行公网主机', () => {
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });

  it('拦截 URL 规范化后的 IPv4-mapped / 尾点 / 链路本地变体（回归：审计发现绕过）', () => {
    for (const h of [
      '[::ffff:7f00:1]',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '::ffff:a00:1',
      '::127.0.0.1',
      '::7f00:1',
      '::ffff:0:127.0.0.1',
      '[::ffff:0:7f00:1]',
      'localhost.',
      'metadata.google.internal.',
      'fe90::1',
      'febf::1',
      'fec0::1',
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
    for (const u of [
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/',
      'http://localhost./',
      'http://metadata.google.internal./',
      'http://[fe90::1]/',
      'http://[::127.0.0.1]/',
      'http://[::ffff:0:7f00:1]/',
      'http://[64:ff9b::7f00:1]/',
    ]) {
      expect(isUrlAllowed(u), u).toBe(false);
    }
  });

  it('放行公网 IPv6/IPv4 与域名（防误伤）', () => {
    for (const h of ['example.com', '8.8.8.8', '198.20.0.1', '2606:4700::1111', '2001:db8::1']) {
      expect(isBlockedHost(h), h).toBe(false);
    }
    for (const u of ['https://example.com/a', 'http://8.8.8.8/', 'http://[2606:4700::1111]/']) {
      expect(isUrlAllowed(u), u).toBe(true);
    }
  });

  it('isUrlAllowed 兼顾协议与主机', () => {
    expect(isUrlAllowed('https://example.com/a')).toBe(true);
    expect(isUrlAllowed('http://example.com')).toBe(true);
    expect(isUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(isUrlAllowed('http://127.0.0.1:8080')).toBe(false);
    expect(isUrlAllowed('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isUrlAllowed('not a url')).toBe(false);
  });
});
