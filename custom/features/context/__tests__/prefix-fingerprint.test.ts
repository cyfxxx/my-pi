/**
 * prefix-fingerprint 纯逻辑测试：分段指纹与变化段判定
 */
import { describe, it, expect } from 'vitest';
import {
  fingerprintRequest,
  formatFingerprint,
  messageSegments,
  firstDivergentSegment,
  systemTextOf,
  systemSectionSizes,
  changedSectionNames,
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

  it('回退到首条 role=system 消息（字符串原样返回，不 JSON 转义）', () => {
    // 2026-10-07 改：早先无条件 stable() 会加引号并把换行转义成字面量 \n，
    // 导致 system 文本的分段字节统计整体失效。
    expect(systemTextOf({ messages: [{ role: 'system', content: 'from-msg' }] })).toBe('from-msg');
    expect(systemTextOf({ messages: [{ role: 'system', content: 'a\n<b>\nc' }] })).toBe('a\n<b>\nc');
  });

  it('role=developer 也视为 system', () => {
    expect(systemTextOf({ messages: [{ role: 'developer', content: 'dev' }] })).toBe('dev');
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
  it('中段消息内容被改写、条数不变 → 定位到首个分叉段（旧实现只记 total/messages，无法定位）', () => {
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
    // 第 7 条落在第 0 段（0-7）→ 分叉点就是段 0，说明这次改写让整段前缀作废
    expect(b.changed).toEqual(['messages@0-7']);
  });

  it('分叉段随改写位置后移（越靠后越便宜）', () => {
    const mk = (n: number, mutateAt = -1) =>
      Array.from({ length: n }, (_, i) => ({ role: 'user', content: i === mutateAt ? 'MUT' : `m${i}` }));
    const a = fingerprintRequest({ messages: mk(40) }, null, 1);
    const b = fingerprintRequest({ messages: mk(40, 35) }, a, 2);
    expect(b.changed).toContain('messages@32-39');
    const c = fingerprintRequest({ messages: mk(40, 1) }, a, 3);
    expect(c.changed).toContain('messages@0-7');
  });

  it('尾部追加（公共段一致、条数变）→ 只记 messages，不误报分叉', () => {
    const base = Array.from({ length: 16 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const a = fingerprintRequest({ messages: base }, null, 1);
    const b = fingerprintRequest({ messages: [...base, { role: 'user', content: 'new' }] }, a, 2);
    expect(b.changed).toEqual(['messages']);
    expect(b.segments.slice(0, 2)).toEqual(a.segments.slice(0, 2));
  });

  it('messageSegments / firstDivergentSegment 边界', () => {
    expect(messageSegments([])).toEqual([]);
    expect(messageSegments(Array.from({ length: 17 }, (_, i) => ({ role: 'user', content: i })))).toHaveLength(3);
    // prev 缺失（首次请求）或长度为零 → 不分叉
    expect(firstDivergentSegment(undefined, ['x'], 0, 9)).toBeNull();
    expect(firstDivergentSegment([], [], 0, 0)).toBeNull();
    // 完整段（两条 8 条序列）第 1 段不同 → 分叉点 = 消息下标 8
    expect(firstDivergentSegment(['a', 'b'], ['a', 'c'], 16, 16)).toBe(8);
    // 完整段全同 + 条数相同 + 尾段不同 → 原地改写最后一小段
    expect(firstDivergentSegment(['a', 'b'], ['a', 'z'], 9, 9)).toBe(8);
    // 条数变化（9 → 10 追加）→ 不算分叉，交给 messages 计数
    expect(firstDivergentSegment(['a', 'b'], ['a', 'z'], 9, 10)).toBeNull();
    // 6 → 7 条：唯一那段是不完整段，内容虽然变了但属于追加
    expect(firstDivergentSegment(['a'], ['z'], 6, 7)).toBeNull();
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

/**
 * 2026-10-07 实测：同一进程内 system 在 8020B ↔ 7239B 两个变体之间来回翻，两次翻转
 * = 147,555 + 10,308 token 全价重算（占该会话全部未命中的 60.8%）。原来的指纹只记
 * system 的总哈希，只能说"system 变了"，说不出"是哪一段变了、以及是不是 my-pi 的
 * 加固块整块丢了"。下面这组测试钉住新增的两个判据。
 */
describe('system 分段与追加块诊断（2026-10-07）', () => {
  const b = (s: string): number => Buffer.byteLength(s, 'utf-8');
  // pi 的真实渲染形态：preamble 不打标签，其余段为 <name>\n…\n</name>，段间以 \n\n 连接
  const PREAMBLE = 'You are an expert coding assistant.';
  const TOOLS = '<tools>\n- read: Read file contents\n- bash: Execute bash commands\n</tools>';
  const RULES = '<rules>\n- Use read to examine files instead of cat or sed.\n</rules>';
  const SKILLS =
    '<skills>\n<available_skills>\n  <skill>\n    <name>x</name>\n    <description>d</description>\n  </skill>\n</available_skills>\n</skills>';
  const CWD = '<cwd>\n/root/my-pi\n</cwd>';
  const SYS = [PREAMBLE, TOOLS, RULES, SKILLS, CWD].join('\n\n');
  /** my-pi 的加固块（真实取值来自 hard-rules 的 EFFICIENCY_ADVICE，这里是同形替身） */
  const APPEND = '效率建议：使用更具体的工具调用可以提高响应速度。';

  it('systemSectionSizes 切出每段字节数，嵌套 <skill> 不被误切', () => {
    const s = systemSectionSizes(SYS);
    // preamble = 第一个标签之前的全部文本，含它与首个标签之间的 \n\n 连接符
    expect(s.preamble).toBe(b(PREAMBLE + '\n\n'));
    expect(s.tools).toBe(b(TOOLS));
    expect(s.rules).toBe(b(RULES));
    expect(s.skills).toBe(b(SKILLS));
    expect(s.cwd).toBe(b(CWD));
    // 反向引用保证闭合在 </skills>，嵌套的 <skill> 不会被单独计一段
    expect(s.skill).toBeUndefined();
    expect(s.available_skills).toBeUndefined();
  });

  it('systemSectionSizes 空文本返回空表', () => {
    expect(systemSectionSizes('')).toEqual({});
  });

  it('changedSectionNames 给出发生变化的段名', () => {
    expect(changedSectionNames({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(['b']);
    expect(changedSectionNames(undefined, { a: 1 })).toEqual(['a']);
    expect(changedSectionNames({ a: 1 }, { a: 1 })).toEqual([]);
    // 消失的段也算变化（用 -1 哨兵，和"变成 0 字节"区分开）
    expect(changedSectionNames({ a: 1, gone: 5 }, { a: 1 })).toEqual(['gone']);
  });

  it('加固块丢失 → system:append-lost，且没有任何分段被改写', () => {
    const a = fingerprintRequest(
      { messages: [{ role: 'system', content: `${SYS}\n\n${APPEND}` }] },
      null,
      1,
      'high',
      APPEND,
    );
    expect(a.systemAppend).toBe(true);

    const lost = fingerprintRequest({ messages: [{ role: 'system', content: SYS }] }, a, 2, 'high', APPEND);
    expect(lost.systemAppend).toBe(false);
    expect(lost.changed).toContain('system');
    expect(lost.changed).toContain('system:append-lost');
    // 关键判据：加固块挂在所有分段之外，所以"段字节数全未变、system 却变了"
    // 只能解释为"末尾那块整块丢了"，而不是"某段被改写"。
    expect(lost.systemChangedSections).toEqual([]);
    expect(lost.systemSections).toEqual(a.systemSections);
    expect(formatFingerprint(lost)).toContain('app=LOST');
  });

  it('加固块恢复 → system:append-back', () => {
    const lost = fingerprintRequest({ messages: [{ role: 'system', content: SYS }] }, null, 1, 'high', APPEND);
    expect(lost.systemAppend).toBe(false);
    const back = fingerprintRequest(
      { messages: [{ role: 'system', content: `${SYS}\n\n${APPEND}` }] },
      lost,
      2,
      'high',
      APPEND,
    );
    expect(back.systemAppend).toBe(true);
    expect(back.changed).toContain('system:append-back');
  });

  it('某一段被改写 → 能指出是哪一段（区别于加固块丢失）', () => {
    const a = fingerprintRequest(
      { messages: [{ role: 'system', content: `${SYS}\n\n${APPEND}` }] },
      null,
      1,
      'high',
      APPEND,
    );
    const bigger = `${RULES}\n`.replace('</rules>', '- 额外一条规则。\n</rules>');
    const changedSys = [PREAMBLE, TOOLS, bigger, SKILLS, CWD].join('\n\n');
    const c = fingerprintRequest(
      { messages: [{ role: 'system', content: `${changedSys}\n\n${APPEND}` }] },
      a,
      2,
      'high',
      APPEND,
    );
    expect(c.systemAppend).toBe(true);
    expect(c.changed).toContain('system');
    expect(c.changed).not.toContain('system:append-lost');
    expect(c.systemChangedSections).toContain('rules');
    expect(c.systemChangedSections).not.toContain('tools');
  });

  it('不给判据文本时不产生 systemAppend（老调用方行为不变）', () => {
    const a = fingerprintRequest({ messages: [{ role: 'system', content: SYS }] }, null, 1);
    expect(a.systemAppend).toBeUndefined();
    const bb = fingerprintRequest({ messages: [{ role: 'system', content: `${SYS} more` }] }, a, 2);
    expect(bb.changed).toContain('system');
    // 判据缺失时不得把"追加块丢失"误报出来
    expect(bb.changed).not.toContain('system:append-lost');
    expect(bb.changed).not.toContain('system:append-back');
    expect(formatFingerprint(bb)).toContain('app=-');
  });
});
