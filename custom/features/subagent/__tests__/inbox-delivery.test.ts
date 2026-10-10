/**
 * 回归测试（注入式）：**中途指令的"真实负载"与"消费策略"**（2026-10-10）
 *
 * 盯住两个真实踩过的根因：
 *  ① 发出的请求负载**必须带 `streamingBehavior:'steer'`** —— 不带则子进程拒绝 ⇒ 从未入队 ⇒ 注入永不生效 ✗；
 *  ② 响应 **`success:false` 时不得消费** —— 否则消息被标记已读而实际没进去 ⇒ "假装成功" ✗（本项目最忌）。
 */
import { describe, expect, it } from 'vitest';
import { deliverInboxRound, type InboxRoundDeps } from '../core/runner';

function makeDeps(over: Partial<InboxRoundDeps> = {}, reply: { success?: boolean; error?: string } = { success: true }) {
  const sent: unknown[] = [];
  const consumedCalls: Array<[string, number]> = [];
  const logs: string[] = [];
  const deps: InboxRoundDeps = {
    send: async (frame) => {
      sent.push(frame);
      return reply;
    },
    drain: () => ({ messages: [{ seq: 2, text: '追加指令：完成后 echo INBOX-OK' }] }),
    markConsumed: (id, seq) => consumedCalls.push([id, seq]),
    unreadTotal: () => 0,
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, sent, consumedCalls, logs };
}

describe('① 负载必须带 steer（否则子进程拒绝 ⇒ 从未入队）', () => {
  it('实际发出的帧带 streamingBehavior=steer、带序号前缀与正文', async () => {
    const { deps, sent } = makeDeps();
    await deliverInboxRound(deps, ['worker#1'], new Map());
    expect(sent).toHaveLength(1);
    const frame = sent[0] as { type: string; message: string; streamingBehavior?: string };
    expect(frame.type).toBe('prompt');
    expect(frame.streamingBehavior).toBe('steer');
    expect(frame.message).toContain('#2');
    expect(frame.message).toContain('INBOX-OK');
  });
});

describe('② success:false ⇒ 必须"不消费"（消息保留未读、下次重试）', () => {
  it('markConsumed 一次都不能被调用，且日志写明保留未读', async () => {
    const { deps, consumedCalls, logs } = makeDeps({}, { success: false, error: 'Agent is already processing.' });
    await deliverInboxRound(deps, ['worker#1'], new Map());
    expect(consumedCalls).toEqual([]);
    expect(logs.join('\n')).toContain('保留未读');
    expect(logs.join('\n')).not.toContain('已投递');
  });

  it('无 error 文案的 success:false 同样不得消费', async () => {
    const { deps, consumedCalls } = makeDeps({}, { success: false });
    await deliverInboxRound(deps, ['worker#1'], new Map());
    expect(consumedCalls).toEqual([]);
  });
});

describe('③ success:true ⇒ 必须消费', () => {
  it('markConsumed 以 (id, seq) 被调用一次，且日志写"已投递"', async () => {
    const { deps, consumedCalls, logs } = makeDeps();
    await deliverInboxRound(deps, ['worker#1'], new Map());
    expect(consumedCalls).toEqual([['worker#1', 2]]);
    expect(logs.join('\n')).toContain('已投递');
  });
});

describe('反向断言：这条测试真能抓住"忽略 success:false"的假实现', () => {
  const runOldBuggyConsumer = async (deps: InboxRoundDeps, ids: string[], consumed: Map<string, number>) => {
    // 旧逻辑（我们刚修掉的那个 bug）：**不检查 success**，发出去就消费 ✗
    for (const id of ids) {
      const { messages } = deps.drain(id, { consumed: consumed.get(id) ?? 0 });
      for (const m of messages) {
        await deps.send({ type: 'prompt', message: m.text, streamingBehavior: 'steer' }, 120_000);
        deps.markConsumed(id, m.seq);
      }
    }
  };

  it('把"必须不消费"的断言用在假实现上 ⇒ 必然失败（证明断言有分辨力）', async () => {
    const { deps, consumedCalls } = makeDeps({}, { success: false, error: 'Agent is already processing.' });
    await runOldBuggyConsumer(deps, ['worker#1'], new Map());
    // 假实现消费了 ⇒ 与"必须不消费"矛盾 ⇒ 断言确实能抓住这个 bug ✓
    expect(() => expect(consumedCalls).toEqual([])).toThrow();
    expect(consumedCalls).toEqual([['worker#1', 2]]);
  });

  it('对照组：真实现下同一断言成立（不是恒假）', async () => {
    const { deps, consumedCalls } = makeDeps({}, { success: false, error: 'Agent is already processing.' });
    await deliverInboxRound(deps, ['worker#1'], new Map());
    expect(consumedCalls).toEqual([]);
  });
});

describe('④ 单轮上限与去重仍成立（引用既有覆盖 + 一处集成检查）', () => {
  it('drain 收到的是当前已读偏移（去重的前提）', async () => {
    const seen: number[] = [];
    const { deps } = makeDeps({
      drain: (_id, opts) => {
        seen.push(opts.consumed);
        return { messages: [] };
      },
    });
    await deliverInboxRound(deps, ['worker#1'], new Map([['worker#1', 7]]));
    expect(seen).toEqual([7]);
  });
});
