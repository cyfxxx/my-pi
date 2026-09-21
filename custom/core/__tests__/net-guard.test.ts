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

  it('isUrlAllowed 兼顾协议与主机', () => {
    expect(isUrlAllowed('https://example.com/a')).toBe(true);
    expect(isUrlAllowed('http://example.com')).toBe(true);
    expect(isUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(isUrlAllowed('http://127.0.0.1:8080')).toBe(false);
    expect(isUrlAllowed('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isUrlAllowed('not a url')).toBe(false);
  });
});
