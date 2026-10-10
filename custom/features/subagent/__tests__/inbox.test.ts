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
