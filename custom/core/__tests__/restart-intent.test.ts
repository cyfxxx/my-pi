/**
 * restart-intent 单测 — "重启后要不要继续执行任务"的判据
 *
 * 背景（2026-10-06 用户反馈）：重启后无条件注入"请从中断处继续"会触发一个模型回合，
 * 但很多重启没有在途任务（切模式/换模型/切会话/模型刚收尾就重启）→ 白烧一次
 * "重启后首轮全量重放"（实测 ≈80k），还可能让模型凭空编任务。
 *
 * 本测试锁三层判据与盘面读取：
 *   1. 意图（intent none/continue/auto）与 env 强制（PI_RESTART_RESUME）的优先级；
 *   2. 盘面尾部七种形态的归类（含"只读最后 256KB"的截断容错、元数据条目跳过）；
 *   3. 两条注入文案（续跑指令 / 不续跑备注）把"不要凭空开工"写进去。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decideRestartResume,
  formatResumePrompt,
  formatResumeSkippedNote,
  normalizeResumeIntent,
  tailKindFromLines,
  tailKindFromSessionFile,
} from '../restart-intent';
import type { TranscriptTailKind } from '../restart-intent';

const msg = (role: string, content: unknown = []) => JSON.stringify({ type: 'message', id: 'x', message: { role, content } });
const assistantText = () => msg('assistant', [{ type: 'text', text: 'done' }]);
const assistantTool = () => msg('assistant', [{ type: 'text', text: 'let me' }, { type: 'toolCall', name: 'bash' }]);
const toolResult = () => msg('toolResult', [{ type: 'text', text: 'ok' }]);
const userMsg = () => msg('user', [{ type: 'text', text: 'hi' }]);
const customMsg = () => JSON.stringify({ type: 'custom_message', customType: 'my-pi-context-advice', content: 'x' });
const systemMsg = () => msg('system', [{ type: 'text', text: 'sys' }]);
const meta = (type: string) => JSON.stringify({ type, id: 'y' });

describe('decideRestartResume：意图 → env → 盘面的优先级', () => {
  it('写入端声明 none → 不续跑（切模式/换模型/切会话）', () => {
    expect(decideRestartResume({ intent: 'none', tail: 'user' })).toEqual({ resume: false, reason: 'intent-none' });
  });

  it('写入端声明 continue → 续跑（看门狗/failover：工作在途被中断）', () => {
    expect(decideRestartResume({ intent: 'continue', tail: 'assistant-text' })).toEqual({ resume: true, reason: 'intent-continue' });
  });

  it('auto（含脏值/缺省）→ 交给盘面判', () => {
    expect(decideRestartResume({ intent: 'auto', tail: 'user' }).reason).toBe('tail-pending-user-message');
    expect(decideRestartResume({ intent: undefined, tail: 'assistant-text' }).reason).toBe('tail-assistant-text');
    expect(decideRestartResume({ intent: 'bogus', tail: 'user' }).resume).toBe(true);
    expect(decideRestartResume({ intent: 123, tail: 'user' }).resume).toBe(true);
  });

  it('env 强制优先于一切（测试/用户偏好）', () => {
    expect(decideRestartResume({ intent: 'continue', tail: 'user', env: 'off' })).toEqual({ resume: false, reason: 'env-off' });
    expect(decideRestartResume({ intent: 'none', tail: 'assistant-text', env: 'always' })).toEqual({ resume: true, reason: 'env-always' });
    expect(decideRestartResume({ intent: 'none', tail: 'empty', env: ' ALWAYS ' }).resume).toBe(true);
    expect(decideRestartResume({ intent: 'continue', tail: 'user', env: 'off' }).resume).toBe(false);
  });

  it('盘面判据：有在途工作 → 续跑；收尾/空 → 不续跑', () => {
    const cases: Array<[TranscriptTailKind, boolean]> = [
      ['user', true],
      ['assistant-tool-calls', true],
      ['tool-result', true],
      ['custom', true],
      ['assistant-text', false],
      ['system', false],
      ['empty', false],
    ];
    for (const [tail, expected] of cases) {
      expect(decideRestartResume({ intent: 'auto', tail }).resume, tail).toBe(expected);
    }
  });

  it('normalizeResumeIntent：白名单外的值一律回落 auto', () => {
    expect(normalizeResumeIntent('continue')).toBe('continue');
    expect(normalizeResumeIntent('none')).toBe('none');
    expect(normalizeResumeIntent('auto')).toBe('auto');
    expect(normalizeResumeIntent(undefined)).toBe('auto');
    expect(normalizeResumeIntent('yes')).toBe('auto');
    expect(normalizeResumeIntent(null, 'none')).toBe('none');
  });
});

describe('tailKindFromLines：盘面尾部归类', () => {
  it('倒着找最后一条实质条目，跳过元数据', () => {
    expect(tailKindFromLines(['', meta('session'), meta('model_change'), meta('thinking_level_change')])).toBe('empty');
    expect(tailKindFromLines([userMsg(), meta('thinking_level_change')])).toBe('user');
  });

  it('assistant 带工具调用 = 被中断（工具还没返回）', () => {
    expect(tailKindFromLines([userMsg(), assistantTool()])).toBe('assistant-tool-calls');
  });

  it('assistant 纯文本 = 回合已收尾', () => {
    expect(tailKindFromLines([userMsg(), assistantText()])).toBe('assistant-text');
  });

  it('toolResult = 模型还没消化', () => {
    expect(tailKindFromLines([assistantTool(), toolResult()])).toBe('tool-result');
  });

  it('custom_message = 回合已开始但没跑完', () => {
    expect(tailKindFromLines([userMsg(), customMsg()])).toBe('custom');
  });

  it('system = 保守视为没有在途工作', () => {
    expect(tailKindFromLines([userMsg(), systemMsg()])).toBe('system');
  });

  it('空/全坏行 → empty（读不到盘面就不自动开工）', () => {
    expect(tailKindFromLines([])).toBe('empty');
    expect(tailKindFromLines(['', '  '])).toBe('empty');
    expect(tailKindFromLines(['{ not json', 'also bad'])).toBe('empty');
  });

  it('被截断的窗口：首行是半个 JSON 也能继续往前找', () => {
    expect(tailKindFromLines(['{"type":"message","message":{"role":"assist', userMsg()])).toBe('user');
  });
});

describe('tailKindFromSessionFile：真实文件读取（含 256KB 截断）', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'my-pi-tail-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, lines: string[]) => {
    const p = join(dir, name);
    writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };

  it('缺文件 / 空文件 → empty', () => {
    expect(tailKindFromSessionFile(join(dir, 'nope.jsonl'))).toBe('empty');
    expect(tailKindFromSessionFile(write('empty.jsonl', ['']))).toBe('empty');
    expect(tailKindFromSessionFile(undefined)).toBe('empty');
  });

  it('大文件只读尾部：一条 300KB 的超大 thinking 之后仍有 user 消息 → user', () => {
    const huge = JSON.stringify({ type: 'message', id: 'big', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x'.repeat(300 * 1024) }] } });
    const p = write('big.jsonl', [meta('session'), huge, userMsg()]);
    expect(tailKindFromSessionFile(p)).toBe('user');
  });
});

describe('两条注入文案', () => {
  it('续跑指令：明确允许"没有下一步就停下"，防止为继续而编任务', () => {
    const text = formatResumePrompt('系统已重启。操作: restart | 原因: 看门狗');
    expect(text).toContain('如果你还有下一步行动，请继续执行');
    expect(text).toContain('如果任务已完成或不确定，请停下来向用户说明，不要凭空开工');
  });

  it('不续跑备注：写明判据，便于事后解释"为什么这次没继续"', () => {
    const text = formatResumeSkippedNote('系统已重启。操作: set_model', 'intent-none');
    expect(text).toContain('本次重启不需要继续执行任务（判据: intent-none）');
    expect(text).toContain('等用户指示');
  });
});
