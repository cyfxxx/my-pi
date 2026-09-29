/**
 * web-terminal/args 回归测试：非法输入必须回退默认，不能把 NaN 传进 listen()。
 */
import { describe, it, expect } from 'vitest';

import { DEFAULT_PORT, parseArgs } from '../args';
import { DEFAULT_COOKIE_DAYS } from '../auth';

describe('args: parseArgs', () => {
  it('无参数时用默认端口与默认 cookie 天数', () => {
    expect(parseArgs([])).toEqual({
      port: DEFAULT_PORT,
      cookieDays: DEFAULT_COOKIE_DAYS,
      trustedHosts: [],
      command: undefined,
      cwd: undefined,
      sweep: false,
      help: false,
    });
  });

  it('解析各选项；端口 0 是合法值（系统分配）', () => {
    expect(parseArgs(['--port', '8080']).port).toBe(8080);
    expect(parseArgs(['--port', '0']).port).toBe(0);
    expect(parseArgs(['--cookie-days', '7']).cookieDays).toBe(7);
    expect(parseArgs(['--command', 'echo hi']).command).toBe('echo hi');
    expect(parseArgs(['--cwd', '/tmp']).cwd).toBe('/tmp');
    expect(parseArgs(['--sweep']).sweep).toBe(true);
    expect(parseArgs([]).sweep).toBe(false);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('--trusted-host 可重复累积', () => {
    expect(parseArgs(['--trusted-host', 'a:1', '--trusted-host', 'b:2']).trustedHosts).toEqual(['a:1', 'b:2']);
  });

  it('非法端口与非法天数回退默认，而不是 NaN', () => {
    for (const bad of ['abc', '-1', '70000', '', '1.5']) {
      expect(parseArgs(['--port', bad]).port).toBe(DEFAULT_PORT);
    }
    for (const bad of ['abc', '0', '-3']) {
      expect(parseArgs(['--cookie-days', bad]).cookieDays).toBe(DEFAULT_COOKIE_DAYS);
    }
    expect(parseArgs(['--port']).port).toBe(DEFAULT_PORT);
  });

  it('未知选项被忽略，不影响其它选项', () => {
    const parsed = parseArgs(['--nope', '--port', '9000', 'extra']);
    expect(parsed.port).toBe(9000);
    expect(parsed.help).toBe(false);
  });
});
