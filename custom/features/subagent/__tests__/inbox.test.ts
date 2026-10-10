/**
 * 收件箱（中途通信父侧）单测 —— 2026-10-10
 *
 * 只测**公开面**（runner 真正用的那几个函数），并全部通过注入 `env.PI_MEMORY_DIR` 指向临时目录 ⇒ 不碰真实运行时状态 ✓。
 * 磁盘格式与 `scripts/subagent-inbox.mjs` 一致（这是两边共享的**契约**，故意在测试里按格式手写，以固定契约 ✓）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MAX_PER_ROUND, drainInbox, markConsumed, readConsumed, unreadTotal } from '../core/inbox';
import { resolveInboxIds } from '../core/runner';

let root = '';
let env: NodeJS.ProcessEnv = {};
const ID = 'general';

function writeInbox(lines: string[]): void {
  const dir = join(root, 'subagent');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ID}.inbox.jsonl`), lines.join('\n') + '\n', 'utf8');
}
function msg(seq: number, text: string): string {
  return JSON.stringify({ ts: '2026-10-10T00:00:00.000Z', seq, text });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'subagent-inbox-test-'));
  env = { PI_MEMORY_DIR: root };
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('收件箱：中途通信的父侧读取', () => {
  it('按 seq 顺序取未读', () => {
    writeInbox([msg(1, '第一条'), msg(2, '第二条')]);
    const r = drainInbox(ID, { env });
    expect(r.messages.map((m) => m.text)).toEqual(['第一条', '第二条']);
    expect(r.messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('去重：已消费的消息不会再被投递（同一消息只执行一次）', () => {
    writeInbox([msg(1, 'A'), msg(2, 'B')]);
    markConsumed(ID, 2, env);
    expect(readConsumed(ID, env)).toBe(2);
    expect(drainInbox(ID, { env }).messages).toEqual([]);
    expect(unreadTotal(ID, env)).toBe(0);
  });

  it('单轮上限：一次最多 MAX_PER_ROUND 条，其余留到下一轮', () => {
    writeInbox([msg(1, 'a'), msg(2, 'b'), msg(3, 'c'), msg(4, 'd'), msg(5, 'e')]);
    const first = drainInbox(ID, { env });
    expect(first.messages).toHaveLength(MAX_PER_ROUND);
    expect(unreadTotal(ID, env)).toBe(5); // 尚未消费
    markConsumed(ID, first.messages[first.messages.length - 1].seq, env);
    const second = drainInbox(ID, { env });
    expect(second.messages.map((m) => m.text)).toEqual(['d', 'e']);
  });

  it('坏行：跳过、计数、不崩（fail-open）', () => {
    writeInbox([msg(1, '好行'), '{"ts":"x","seq":2,"text":"半行', msg(3, '另一个好行')]);
    const r = drainInbox(ID, { env });
    expect(r.bad).toBe(1);
    expect(r.messages.map((m) => m.text)).toEqual(['好行', '另一个好行']);
    expect(r.note).toContain('坏行');
  });

  it('fail-open：收件箱不存在 / 内容完全不是 JSON ⇒ 返回空且不抛', () => {
    expect(() => drainInbox(ID, { env })).not.toThrow();
    expect(drainInbox(ID, { env }).messages).toEqual([]);
    writeInbox(['这不是 JSON', '也不是']);
    const r = drainInbox(ID, { env });
    expect(r.messages).toEqual([]);
    expect(r.bad).toBe(2);
  });

  it('安全：不安全的 id 直接拒绝（防路径穿越）', () => {
    const r = drainInbox('../evil', { env });
    expect(r.messages).toEqual([]);
    expect(r.note).toContain('不安全');
    expect(() => markConsumed('../evil', 1, env)).not.toThrow();
  });

  it('反向断言：两个假实现必然违反上述期望（否则这些断言没有分辨力）', () => {
    writeInbox([msg(1, 'A'), msg(2, 'B')]);
    markConsumed(ID, 2, env);
    const expectedAfterConsume: unknown[] = [];
    const expectedBeforeConsume = ['A', 'B'];

    const fakeAlwaysEmpty = (): string[] => []; // 永远说"没有新消息"
    const fakeAlwaysAll = (all: string[]): string[] => all; // 永远无视 consumed，全量重投
    const all = ['A', 'B'];

    // "永远空"在"未消费时应拿到两条"这一条上必然错
    expect(JSON.stringify(fakeAlwaysEmpty())).not.toBe(JSON.stringify(expectedBeforeConsume));
    // "永远全部"在"消费后应为空"这一条上必然错
    expect(JSON.stringify(fakeAlwaysAll(all))).not.toBe(JSON.stringify(expectedAfterConsume));
    // 而真实现两边都对（对照组）
    expect(JSON.stringify(drainInbox(ID, { env }).messages.map((m) => m.text))).toBe(JSON.stringify(expectedAfterConsume));
  });
});

/**
 * 每运行实例独立收件箱（2026-10-10 追加）
 *
 * 重点证明三件事：
 *   ① **运行级 id 与 agent 名两条通道并存**（向后兼容 + 精确投递）；
 *   ② **各 id 已读偏移相互独立** ⇒ 并行运行互不串箱（这就是"每实例独立收件箱"的实质）；
 *   ③ **反向断言**：一个"永远返回空 / 永远返回全部"的假实现**必然违反**上述契约（⇒ 断言有分辨力）。
 */
describe('每运行实例独立收件箱', () => {
  const writeInboxFor = (id: string, lines: string[]): void => {
    const dir = join(root, 'subagent');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.inbox.jsonl`), lines.join('\n') + '\n', 'utf8');
  };

  it('resolveInboxIds：运行级在前、agent 名在后（两条通道都在）', () => {
    expect(resolveInboxIds('worker', 'worker#1')).toEqual(['worker#1', 'worker']);
    expect(resolveInboxIds('worker')).toEqual(['worker#0', 'worker']); // 防御性默认
    expect(resolveInboxIds('worker', '   ')).toEqual(['worker#0', 'worker']); // 只有空白 ⇒ 退化，不产生空 id
    // `#` 现在是合法 id 字符（运行级 id 的分隔符）⇒ 单独的 `#` 会被原样保留（安全，只是没用）
    expect(resolveInboxIds('worker', ' # ')).toEqual(['#', 'worker']);
  });

  it('并行互不串箱：worker#1 的消息只出现在 worker#1，worker#2 只出现在 worker#2', () => {
    writeInboxFor('worker#1', [msg(1, '给 A 的追加指令')]);
    writeInboxFor('worker#2', [msg(1, '给 B 的追加指令')]);
    const a = drainInbox('worker#1', { env });
    const b = drainInbox('worker#2', { env });
    expect(a.messages.map((m) => m.text)).toEqual(['给 A 的追加指令']);
    expect(b.messages.map((m) => m.text)).toEqual(['给 B 的追加指令']);
    // 反向：A 的箱子里**不含** B 的消息（若实现按 agent 名共用一个箱子，这条会红）
    expect(a.messages.some((m) => m.text.includes('给 B'))).toBe(false);
  });

  it('已读偏移相互独立：消费 worker#1 不影响 worker#2 的未读', () => {
    writeInboxFor('worker#1', [msg(1, 'A1')]);
    writeInboxFor('worker#2', [msg(1, 'B1')]);
    markConsumed('worker#1', 1, env);
    expect(unreadTotal('worker#1', env)).toBe(0);
    expect(unreadTotal('worker#2', env)).toBe(1); // 未被牵连 ✓
  });

  it('向后兼容：只按 agent 名投递仍然有效（老用法不变）', () => {
    writeInboxFor('worker', [msg(1, '老用法的消息')]);
    expect(drainInbox('worker', { env }).messages.map((m) => m.text)).toEqual(['老用法的消息']);
  });

  it('单轮上限仍然成立（多出的留到下一轮，不丢）', () => {
    writeInboxFor('worker#3', [msg(1, 'a'), msg(2, 'b'), msg(3, 'c'), msg(4, 'd')]);
    const first = drainInbox('worker#3', { env });
    expect(first.messages.length).toBe(MAX_PER_ROUND);
    // drainInbox **只读不消费**（消费由调用方在投递成功后 markConsumed）⇒ 断言剩余前要先标记
    expect(unreadTotal('worker#3', env)).toBe(4);
    markConsumed('worker#3', MAX_PER_ROUND, env);
    expect(unreadTotal('worker#3', env)).toBe(1); // 第 4 条仍在，没丢 ✓
  });

  it('反向断言：假实现必然违反（"永远空"与"永远全部"各错一处）', () => {
    writeInboxFor('worker#4', [msg(1, 'x'), msg(2, 'y')]);
    const real = () => drainInbox('worker#4', { env }).messages.length;
    const fakeAlwaysEmpty = () => 0;
    const fakeAlwaysAll = () => 99;
    expect(fakeAlwaysEmpty()).not.toBe(real()); // 未消费时真值是 2 ⇒ "永远空"必错
    markConsumed('worker#4', 2, env);
    expect(fakeAlwaysAll()).not.toBe(drainInbox('worker#4', { env }).messages.length); // 消费后真值 0 ⇒ "永远全部"必错
  });

  it('# 是合法 id 字符（运行级 id 的分隔符）且仍防路径穿越', () => {
    writeInboxFor('worker#5', [msg(1, 'ok')]);
    expect(drainInbox('worker#5', { env }).messages.length).toBe(1);
    expect(drainInbox('../etc/passwd', { env }).note).toContain('id 不安全');
  });
});
