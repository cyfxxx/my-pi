/**
 * 会话收件箱桥的单测。
 *
 * 守四件事：
 *   ① 解析要**容错**：坏行跳过并计数（不能一行坏数据卡死整条桥）；
 *   ② `seq` 语义：只投递未消费的行、按序、成功后推进 state（幂等、可重放）；
 *   ③ **保守投递**：sessionId 没有对应的活 agent 时**一个字都不投**、也**不动 state**；
 *   ④ 投递失败**不推进** state（下一轮重试），并把原因报出来（不静默）。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  parseInbox,
  readConsumed,
  startSessionInboxBridge,
  userMessageFor,
  writeConsumed,
  type InboxFs,
} from '../session-inbox';

/** 内存文件系统（够这个模块用的最小面） */
function memFs(initial: Record<string, string> = {}): InboxFs & { files: Record<string, string> } {
  const files: Record<string, string> = { ...initial };
  return {
    files,
    readFileSync: (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    writeFileSync: (p, d) => {
      files[p] = d;
    },
    renameSync: (from, to) => {
      files[to] = files[from];
      delete files[from];
    },
    readdirSync: (p) =>
      Object.keys(files)
        .filter((f) => f.startsWith(`${p}/`))
        .map((f) => f.slice(p.length + 1))
        .filter((f) => !f.includes('/')),
    existsSync: (p) => p in files,
    mkdirSync: () => undefined,
  };
}

const dir = '/inbox';
const line = (seq: number, text: string, deliverAs?: string): string =>
  JSON.stringify({ ts: '2026-10-17T00:00:00Z', seq, text, ...(deliverAs ? { deliverAs } : {}) });

describe('parseInbox', () => {
  it('按 seq 升序返回未消费的行；坏行/空 text/seq<1 一律计数跳过', () => {
    const raw = [line(2, 'b'), '{broken', line(0, 'zero'), line(1, 'a'), JSON.stringify({ seq: 3 }), ''].join('\n');
    const { lines, skipped } = parseInbox(raw, 0);
    // seq=0 与"未消费=0"语义冲突 ⇒ 按坏行处理（不静默丢）
    expect(lines.map((l) => l.seq)).toEqual([1, 2]);
    expect(skipped).toBe(3);
  });

  it('startSeq 之后的行才算（已消费的不重复）', () => {
    const { lines } = parseInbox([line(1, 'a'), line(2, 'b'), line(3, 'c')].join('\n'), 2);
    expect(lines.map((l) => l.seq)).toEqual([3]);
  });

  it('deliverAs 只认 steer，其余（含缺省）都是 followup', () => {
    const { lines } = parseInbox([line(1, 'a', 'steer'), line(2, 'b', 'nonsense'), line(3, 'c')].join('\n'));
    expect(lines.map((l) => l.deliverAs)).toEqual(['steer', 'followup', 'followup']);
  });
});

describe('readConsumed / writeConsumed', () => {
  it('缺文件/坏 JSON 都按 0（不抛）；写入后可读回', () => {
    const fs = memFs();
    expect(readConsumed(fs, '/inbox/x.inbox.state.json')).toBe(0);
    fs.files['/inbox/x.inbox.state.json'] = '{oops';
    expect(readConsumed(fs, '/inbox/x.inbox.state.json')).toBe(0);
    writeConsumed(fs, '/inbox/x.inbox.state.json', 7);
    expect(readConsumed(fs, '/inbox/x.inbox.state.json')).toBe(7);
  });
});

describe('userMessageFor', () => {
  it('形状对齐宿主 UserMessage（id/role/content/source）', () => {
    const msg = userMessageFor('s1', { seq: 3, text: '你好', deliverAs: 'followup' }) as Record<string, unknown>;
    expect(msg.id).toBe('inbox-s1-3');
    expect(msg.role).toBe('user');
    expect(msg.content).toEqual([{ type: 'text', text: '你好' }]);
    expect(msg.source).toEqual({ kind: 'user' });
  });
});

describe('startSessionInboxBridge', () => {
  const fakeCtx = (agents: readonly unknown[]) => {
    const listeners: Record<string, (...a: readonly unknown[]) => unknown> = {};
    return {
      on: (event: string, listener: (...a: readonly unknown[]) => unknown) => {
        listeners[event] = listener;
        if (event === 'agent/created') for (const a of agents) listener({ agent: a });
        return () => delete listeners[event];
      },
      listeners,
    };
  };
  const fakeAgent = (id: string) => ({
    session: { id },
    steer: vi.fn(),
    followup: vi.fn(),
  });

  it('★ 给活会话投递 followup/steer，并按 seq 推进 state', () => {
    const agent = fakeAgent('s1');
    const fs = memFs({
      [`${dir}/s1.inbox.jsonl`]: [line(1, '第一条'), line(2, '第二条', 'steer')].join('\n'),
    });
    const reports: string[] = [];
    const bridge = startSessionInboxBridge(fakeCtx([agent]), fs, {
      dir,
      intervalMs: 0,
      report: (m) => reports.push(m),
    });
    expect(bridge.sessions()).toEqual(['s1']);
    expect(bridge.drain()).toBe(2);
    expect(agent.followup).toHaveBeenCalledTimes(1);
    expect(agent.steer).toHaveBeenCalledTimes(1);
    expect(readConsumed(fs, `${dir}/s1.inbox.state.json`)).toBe(2);
    // 再 drain 一次：已消费 ⇒ 不再重复投递（幂等）
    expect(bridge.drain()).toBe(0);
    bridge.stop();
    expect(reports.some((r) => r.includes('seq=2（steer）'))).toBe(true);
  });

  it('★ 保守：没有活会话的文件一个字都不投、也不动它的 state', () => {
    const fs = memFs({ [`${dir}/other.inbox.jsonl`]: line(1, 'x') });
    const bridge = startSessionInboxBridge(fakeCtx([]), fs, { dir, intervalMs: 0, report: () => undefined });
    expect(bridge.drain()).toBe(0);
    expect(fs.files[`${dir}/other.inbox.state.json`]).toBeUndefined();
    bridge.stop();
  });

  it('★ 投递失败不推进 state（下一轮重试）并报出原因', () => {
    const agent = { session: { id: 's1' }, steer: vi.fn(), followup: vi.fn(() => { throw new Error('boom'); }) };
    const fs = memFs({ [`${dir}/s1.inbox.jsonl`]: line(1, 'x') });
    const reports: string[] = [];
    const bridge = startSessionInboxBridge(fakeCtx([agent]), fs, { dir, intervalMs: 0, report: (m) => reports.push(m) });
    expect(bridge.drain()).toBe(0);
    expect(readConsumed(fs, `${dir}/s1.inbox.state.json`)).toBe(0);
    expect(reports.some((r) => r.includes('投递失败') && r.includes('boom'))).toBe(true);
    bridge.stop();
  });

  it('agent 被 dispose 后不再投递；stop() 幂等', () => {
    const agent = fakeAgent('s1');
    const ctx = fakeCtx([agent]);
    const fs = memFs({ [`${dir}/s1.inbox.jsonl`]: line(1, 'x') });
    const bridge = startSessionInboxBridge(ctx, fs, { dir, intervalMs: 0, report: () => undefined });
    (ctx.listeners['agent/disposed'] as (p: unknown) => void)({ agent });
    expect(bridge.sessions()).toEqual([]);
    expect(bridge.drain()).toBe(0);
    bridge.stop();
    bridge.stop();
  });
});
