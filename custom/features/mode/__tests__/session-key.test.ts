/**
 * 会话稳定键的单测：pi 的文件路径 vs DSH 的 `dsh-session:<id>`
 *
 * 守的是**静默失效**：DSH 没有会话文件路径，如果这里退回 `undefined`，
 * 所有"按会话存档"的功能（模式、记忆命名空间）都会悄悄退化成"全局共用一份"。
 */

import { describe, expect, it } from 'vitest';

import { DSH_SESSION_KEY_PREFIX, isSessionPath, sessionKeyOf } from '../session-key';

describe('sessionKeyOf', () => {
  it('pi：用会话文件路径（并且优先于 id）', () => {
    const key = sessionKeyOf({
      sessionManager: {
        getSessionFile: () => '/home/u/.pi/sessions/abc.jsonl',
        getSessionId: () => 'abc',
      },
    });
    expect(key).toBe('/home/u/.pi/sessions/abc.jsonl');
    expect(isSessionPath(key)).toBe(true);
  });

  it('DSH：没有文件路径时退回 `dsh-session:<id>`（稳定键，不是路径）', () => {
    const key = sessionKeyOf({ sessionManager: { getSessionId: () => 'sess-42' } });
    expect(key).toBe(`${DSH_SESSION_KEY_PREFIX}sess-42`);
    expect(isSessionPath(key)).toBe(false);
  });

  it('两者都没有 / 返回空串 ⇒ undefined（内存会话、--no-session）', () => {
    expect(sessionKeyOf({})).toBeUndefined();
    expect(sessionKeyOf({ sessionManager: {} })).toBeUndefined();
    expect(sessionKeyOf({ sessionManager: { getSessionFile: () => '' } })).toBeUndefined();
    expect(sessionKeyOf({ sessionManager: { getSessionId: () => '' } })).toBeUndefined();
  });

  it('取值抛错时不炸（退化为 undefined，而不是让功能注册失败）', () => {
    expect(
      sessionKeyOf({
        sessionManager: {
          getSessionFile: () => {
            throw new Error('boom');
          },
        },
      }),
    ).toBeUndefined();
  });
});

describe('isSessionPath', () => {
  it('路径 = true；DSH 键 / 空值 = false', () => {
    expect(isSessionPath('/tmp/s.jsonl')).toBe(true);
    expect(isSessionPath('C:\\Users\\x\\s.jsonl')).toBe(true);
    expect(isSessionPath(`${DSH_SESSION_KEY_PREFIX}abc`)).toBe(false);
    expect(isSessionPath('')).toBe(false);
    expect(isSessionPath(undefined)).toBe(false);
  });
});
