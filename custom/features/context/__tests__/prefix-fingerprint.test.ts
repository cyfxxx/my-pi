/**
 * prefix-fingerprint 纯逻辑测试：分段指纹与变化段判定
 */
import { describe, it, expect } from 'vitest';
import {
  fingerprintRequest,
  formatFingerprint,
  systemTextOf,
  FINGERPRINT_HEAD_MESSAGES,
} from '../budget/prefix-fingerprint';

const base = () => ({
  messages: [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'ok' },
  ],
  tools: [{ name: 'bash' }],
});

describe('fingerprintRequest', () => {
  it('相同请求 → total 相同，changed 为空', () => {
    const a = fingerprintRequest(base(), null, 1);
    const b = fingerprintRequest(base(), a, 2);
    expect(b.total).toBe(a.total);
    expect(b.changed).toEqual([]);
    expect(b.messageCount).toBe(3);
  });

  it('system 变化 → changed 含 system', () => {
    const a = fingerprintRequest(base(), null, 1);
    const p = base();
    p.messages[0].content = 'SYS2';
    expect(fingerprintRequest(p, a, 2).changed).toContain('system');
  });

  it('tools 变化 → changed 含 tools', () => {
    const a = fingerprintRequest(base(), null, 1);
    const p = base();
    p.tools.push({ name: 'read' });
    expect(fingerprintRequest(p, a, 2).changed).toContain('tools');
  });

  it('消息头变化 → changed 含 head', () => {
    const a = fingerprintRequest(base(), null, 1);
    const p = base();
    p.messages[1].content = 'hi2';
    expect(fingerprintRequest(p, a, 2).changed).toContain('head');
  });

  it('消息条数变化 → changed 含 messages（压缩/裁剪信号）', () => {
    const a = fingerprintRequest(base(), null, 1);
    const p = base();
    p.messages.pop();
    const fp = fingerprintRequest(p, a, 2);
    expect(fp.changed).toContain('messages');
    expect(fp.messageCount).toBe(2);
  });

  it('消息头只覆盖前 N 条：尾部追加不改变 head/tools/system', () => {
    const six = {
      messages: Array.from({ length: FINGERPRINT_HEAD_MESSAGES }, (_, i) => ({ role: 'user', content: `m${i}` })),
      tools: [{ name: 'bash' }],
    };
    const a = fingerprintRequest(six, null, 1);
    const more = { ...six, messages: [...six.messages, { role: 'user', content: 'tail' }] };
    const fp = fingerprintRequest(more, a, 2);
    expect(fp.head).toBe(a.head);
    expect(fp.system).toBe(a.system);
    expect(fp.tools).toBe(a.tools);
    expect(fp.changed).toEqual(['messages']);
    expect(FINGERPRINT_HEAD_MESSAGES).toBe(6);
  });

  it('空 payload 不抛错', () => {
    const fp = fingerprintRequest({}, null, 1);
    expect(fp.messageCount).toBe(0);
    expect(fp.total).toHaveLength(12);
  });

  it('记录距上一条请求的间隔（用于归因空闲后的整段失效）', () => {
    const a = fingerprintRequest(base(), null, 1_000);
    expect(a.sinceLastMs).toBeUndefined(); // 首次无参照
    const b = fingerprintRequest(base(), a, 181_000);
    expect(b.sinceLastMs).toBe(180_000);
    expect(formatFingerprint(b)).toContain('idle=180s');
  });

  it('formatFingerprint 输出变化段标记', () => {
    const a = fingerprintRequest(base(), null, 1);
    const p = base();
    p.tools = [];
    const line = formatFingerprint(fingerprintRequest(p, a, 2));
    expect(line).toContain('[tools]');
    expect(line).toContain('msgs=3');
  });
});

describe('systemTextOf', () => {
  it('优先取显式 system 字段', () => {
    expect(systemTextOf({ system: 'explicit', messages: [{ role: 'system', content: 'x' }] })).toBe('explicit');
  });

  it('回退到首条 role=system 消息', () => {
    expect(systemTextOf({ messages: [{ role: 'system', content: 'from-msg' }] })).toBe('"from-msg"');
  });

  it('role=developer 也视为 system', () => {
    expect(systemTextOf({ messages: [{ role: 'developer', content: 'dev' }] })).toBe('"dev"');
  });

  it('system 为非字符串（对象/数组）时序列化而非丢弃', () => {
    expect(systemTextOf({ system: [{ type: 'text', text: 'x' }] })).toBe(
      JSON.stringify([{ type: 'text', text: 'x' }]),
    );
  });

  it('无 system 时返回空串', () => {
    expect(systemTextOf({ messages: [{ role: 'user', content: 'x' }] })).toBe('');
  });
});

/**
 * 回归（2026-09-29）：两处盲区曾让"整段缓存失效"查不出原因——
 *   1. `total` 算了但从不比较，中段消息内容被改写（条数不变）时记为 changed: []；
 *   2. 未记录 thinking 档位，而 DeepSeek 的缓存键含 reasoning_effort，切档即整段失效
 *      （实测 2026-09-27 12:05:59 切 low → cacheRead 0/142,075，其间其它分段无变化）。
 */
describe('prefix-fingerprint 盲区回归', () => {
  it('中段消息内容被改写、条数不变 → changed 含 total（旧实现为 []）', () => {
    const a = fingerprintRequest(
      {
        messages: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'again' },
          { role: 'assistant', content: 'ok2' },
          { role: 'user', content: 'third' },
          { role: 'user', content: 'TAIL-OLD' },
        ],
        tools: [{ name: 'bash' }],
      },
      null,
      1,
      'high',
    );
    // 只改第 7 条（超出 head 覆盖的前 6 条），条数不变
    const b = fingerprintRequest(
      {
        messages: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'again' },
          { role: 'assistant', content: 'ok2' },
          { role: 'user', content: 'third' },
          { role: 'user', content: 'TAIL-NEW' },
        ],
        tools: [{ name: 'bash' }],
      },
      a,
      2,
      'high',
    );
    expect(b.messageCount).toBe(a.messageCount);
    expect(b.head).toBe(a.head);
    expect(b.total).not.toBe(a.total);
    expect(b.changed).toEqual(['total']);
  });

  it('thinking 档位变化 → changed 含 level', () => {
    const a = fingerprintRequest(base(), null, 1, 'high');
    const b = fingerprintRequest(base(), a, 2, 'low');
    expect(b.changed).toContain('level');
    expect(b.level).toBe('low');
  });

  it('档位未变时不产生 level 标记', () => {
    const a = fingerprintRequest(base(), null, 1, 'high');
    const b = fingerprintRequest(base(), a, 2, 'high');
    expect(b.changed).toEqual([]);
  });

  it('formatFingerprint 输出档位', () => {
    expect(formatFingerprint(fingerprintRequest(base(), null, 1, 'high'))).toContain('lvl=high');
  });
});
