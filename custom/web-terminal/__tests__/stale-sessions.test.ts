/**
 * web-terminal/stale-sessions 回归测试：孤儿 pty 会话的识别判据。
 *
 * 背景：`PtySession.dispose()` 只在正常退出时运行。服务器被 SIGKILL / 崩溃 / 断电时
 * `script` → supervisor → pi 被 reparent 到 PID 1 后永不退出——实测一次排查就因此泄漏
 * 12 个会话（24 个进程）。识别依据是临时文件名内嵌的属主 pid：
 * `<tmpdir>/mypi-web-tty-<serverPid>-<8 位 hex>`。
 *
 * 这里的判据必须**保守**：宁可漏回收，也不能误杀活会话。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

import { TTY_FILE_PREFIX, parseOwnerPid, selectStaleSessions, isPidAlive } from '../stale-sessions';

describe('stale-sessions: parseOwnerPid', () => {
  it('解析标准文件名', () => {
    expect(parseOwnerPid('mypi-web-tty-14329-2fb22d97')).toBe(14329);
    expect(parseOwnerPid('mypi-web-tty-1-0')).toBe(1);
    expect(parseOwnerPid('mypi-web-tty-999999-abcdef01')).toBe(999999);
  });

  it('前缀不符或格式不符一律返回 null（不猜）', () => {
    expect(parseOwnerPid('other-web-tty-1-aa')).toBeNull();
    expect(parseOwnerPid('mypi-web-tty-')).toBeNull();
    expect(parseOwnerPid('mypi-web-tty-abc-aa')).toBeNull();
    expect(parseOwnerPid('mypi-web-tty-123')).toBeNull(); // 缺随机段
    expect(parseOwnerPid('mypi-web-tty-123-')).toBeNull();
    expect(parseOwnerPid('mypi-web-tty-123-XYZ')).toBeNull(); // 大写非 hex
    expect(parseOwnerPid('mypi-web-tty-123-aa-extra')).toBeNull();
    expect(parseOwnerPid('mypi-web-tty-0-aa')).toBeNull(); // pid 0 不是会话
    expect(parseOwnerPid('')).toBeNull();
  });

  it('前缀常量与 pty-session 创建的文件名一致', () => {
    expect(TTY_FILE_PREFIX).toBe('mypi-web-tty-');
    expect('mypi-web-tty-4242-deadbeef'.startsWith(TTY_FILE_PREFIX)).toBe(true);
  });
});

describe('stale-sessions: selectStaleSessions', () => {
  const names = [
    'mypi-web-tty-100-aa', // 属主已死 → 回收
    'mypi-web-tty-200-bb', // 属主存活 → 保留
    'mypi-web-tty-300-cc', // 属主就是自己 → 保留
    'mypi-web-tty-bad-dd', // 无法解析 → 保留
    'unrelated-file', // 非本服务 → 保留
  ];

  it('只挑出属主已消失的会话', () => {
    const alive = (pid: number): boolean => pid === 200;
    expect(selectStaleSessions(names, alive, 300)).toEqual([{ name: 'mypi-web-tty-100-aa', ownerPid: 100 }]);
  });

  it('属主等于自身时永不回收（防御性）', () => {
    expect(selectStaleSessions(['mypi-web-tty-300-cc'], () => false, 300)).toEqual([]);
  });

  it('全部属主存活时无事可做', () => {
    expect(selectStaleSessions(names, () => true, 300)).toEqual([]);
  });

  it('空输入返回空', () => {
    expect(selectStaleSessions([], () => false)).toEqual([]);
  });
});

describe('stale-sessions: isPidAlive', () => {
  it('当前进程存活', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('已退出的进程判为不存在', () => {
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    // spawnSync 返回时子进程已退出；pid 立即复用概率极低
    expect(typeof child.pid).toBe('number');
    expect(isPidAlive(child.pid as number)).toBe(false);
  });
});
