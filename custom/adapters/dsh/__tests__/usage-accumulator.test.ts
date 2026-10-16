/**
 * 回合用量累积器单测。
 *
 * 守三条不变式（每条都有反向探针，避免"假绿"）：
 *   ① **字段名逐个对齐**（DSH `TokenUsage` → pi `Usage`）——错一个字段就是把缓存读成新输入，账全错；
 *   ② **没有数据就不合成**（返回 `undefined`），绝不产出全 0 的假用量；
 *   ③ **按回合分桶**且回合内多 step **求和**（真 Host 日志实测：一次任务里 step1 工具调用 + step2 回答
 *      各有一条 usage，两条都属于同一个 `turn: 1`）。
 *
 * 真实负载取自 2026-10-18 的 Host 级冒烟会话日志（解压自 `session.v4.jsonl.zstd`）。
 */

import { describe, expect, it } from 'vitest';

import {
  createTurnUsageAccumulator,
  mergeTurnUsage,
  toPiUsage,
  type DshTokenUsageLike,
} from '../usage-accumulator';

/** 真 Host 日志里的两条 assistant/message 负载（只保留与本模块相关的字段） */
const REAL_STEP1 = {
  type: 'assistant/message',
  turn: 1,
  step: 1,
  usage: { inputTokens: 358, outputTokens: 22, cacheReadTokens: 10240, cacheWriteTokens: 0, totalTokens: 10620 },
};
const REAL_STEP2 = {
  type: 'assistant/message',
  turn: 1,
  step: 2,
  usage: { inputTokens: 249, outputTokens: 89, cacheReadTokens: 10496, cacheWriteTokens: 0, totalTokens: 10834 },
};

describe('toPiUsage（字段名翻译）', () => {
  it('把 DSH 的 *Tokens 字段逐个映射到 pi 的字段名', () => {
    const pi = toPiUsage(REAL_STEP1.usage as DshTokenUsageLike);
    expect(pi).toBeDefined();
    expect(pi!.input).toBe(358);
    expect(pi!.output).toBe(22);
    expect(pi!.cacheRead).toBe(10240);
    expect(pi!.cacheWrite).toBe(0);
    expect(pi!.totalTokens).toBe(10620);
  });

  it('cacheWrite/reasoning 缺失时按契约补 0 / 不出现（不编造 reasoning）', () => {
    const pi = toPiUsage({ inputTokens: 1, outputTokens: 2 } as DshTokenUsageLike);
    expect(pi!.cacheRead).toBe(0);
    expect(pi!.cacheWrite).toBe(0);
    expect(pi!.reasoning).toBeUndefined();
    // totalTokens 缺失 ⇒ 由四项求和推导（DSH 契约里 totalTokens 是可选的）
    expect(pi!.totalTokens).toBe(3);
  });

  it('reasoning 有值时保留', () => {
    expect(toPiUsage({ inputTokens: 1, outputTokens: 9, reasoningTokens: 7 } as DshTokenUsageLike)!.reasoning).toBe(7);
  });

  it('★ 反向探针：两条计数都缺 ⇒ 返回 undefined（不产出 0 用量的假数据）', () => {
    expect(toPiUsage({} as DshTokenUsageLike)).toBeUndefined();
    expect(toPiUsage(undefined)).toBeUndefined();
    expect(toPiUsage({ cacheReadTokens: 5 } as DshTokenUsageLike)).toBeUndefined();
  });

  it('cost 是占位 0 并显式标注（DSH TokenUsage 不含定价，不假装算了钱）', () => {
    const pi = toPiUsage(REAL_STEP1.usage as DshTokenUsageLike)!;
    expect(pi.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
    expect(pi.costUnavailable).toBe(true);
  });
});

describe('createTurnUsageAccumulator', () => {
  it('回合内多 step 求和（真日志的两条 step 合成一条）', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    acc.record('s1', REAL_STEP2);
    const patch = acc.read('s1', 1);
    expect(patch).toBeDefined();
    expect(patch!.turnIndex).toBe(1);
    expect(patch!.usageCalls).toBe(2);
    expect(patch!.message.usage.input).toBe(358 + 249);
    expect(patch!.message.usage.output).toBe(22 + 89);
    expect(patch!.message.usage.cacheRead).toBe(10240 + 10496);
    expect(patch!.message.usage.totalTokens).toBe(10620 + 10834);
  });

  it('★ read 是"读"不是"取走"：多条桥接（多个特性都注册 turn_end）都能拿到同一份用量', () => {
    // 这是 2026-10-18 Host 冒烟实测的致命细节：一条 turn/end 会触发**多条**桥接，
    // 销毁式取值会让除第一条外的特性永远拿不到用量（recordUsage 恰好不是第一条 ⇒ 用量丢失）。
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    const first = acc.read('s1', 1);
    const second = acc.read('s1', 1);
    const third = acc.read('s1', 1);
    expect(first).toBeDefined();
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(acc.size()).toBe(1); // 桶还在，直到被 drop 或 LRU 淘汰
  });

  it('drop 才清桶（会话切换/取消时防串账）', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    acc.drop('s1', 1);
    expect(acc.read('s1', 1)).toBeUndefined();
    expect(acc.size()).toBe(0);
  });

  it('★ 反向探针：不同会话的相同回合号不串账（新会话的回合号会重新从 1 开始）', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    acc.record('s2', REAL_STEP2);
    expect(acc.read('s1', 1)!.message.usage.input).toBe(358);
    expect(acc.read('s2', 1)!.message.usage.input).toBe(249);
    // 会话 id 缺失时归到同一个兜底桶（不丢数据，但也不冒充某个会话）
    acc.record(undefined, REAL_STEP1);
    expect(acc.read(undefined, 1)!.message.usage.input).toBe(358);
  });

  it('★ 反向探针：没有该回合的用量 ⇒ undefined（不合成假用量）', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    expect(acc.read('s1', 2)).toBeUndefined();
    expect(acc.read('s1', undefined)).toBeUndefined();
    expect(acc.read('s1', 1)).toBeDefined();
  });

  it('★ 反向探针：回合之间不串账', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    acc.record('s1', { ...REAL_STEP2, turn: 2 });
    expect(acc.read('s1', 2)!.message.usage.input).toBe(249);
    expect(acc.read('s1', 1)!.message.usage.input).toBe(358);
  });

  it('只认 assistant/message；其它事件（含 turn/end 自身）被忽略', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', { type: 'turn/end', turn: 1, usage: { inputTokens: 5, outputTokens: 5 } });
    acc.record('s1', { type: 'user/message', turn: 1, usage: { inputTokens: 5, outputTokens: 5 } });
    acc.record('s1', null);
    acc.record(undefined, undefined);
    acc.record('s1', 'assistant/message');
    expect(acc.size()).toBe(0);
    expect(acc.read('s1', 1)).toBeUndefined();
  });

  it('负载异常（usage 非对象 / turn 缺失）时不崩、不入桶', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', { type: 'assistant/message', turn: 1, usage: 'nope' });
    acc.record('s1', { type: 'assistant/message', usage: { inputTokens: 1, outputTokens: 1 } });
    expect(acc.size()).toBe(0);
  });

  it('回合数有上限（长跑进程里"没有 end 的回合"不会无限增长）', () => {
    const acc = createTurnUsageAccumulator();
    for (let i = 1; i <= 40; i += 1) acc.record('s1', { ...REAL_STEP1, turn: i });
    expect(acc.size()).toBeLessThanOrEqual(32);
    // 保留的是最近的回合：最早的被淘汰，最后一个一定在
    expect(acc.read('s1', 40)).toBeDefined();
    expect(acc.read('s1', 1)).toBeUndefined();
  });

  it('drop 丢弃指定回合（会话切换/取消时防串账）', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    acc.drop('s1', 1);
    expect(acc.read('s1', 1)).toBeUndefined();
  });
});
describe('mergeTurnUsage', () => {
  it('把合成的用量补进 turn/end 的 pi 负载，并给出 turnIndex', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    // 真 Host 日志里 turn/end 的原始负载
    const payload = { type: 'turn_end', turn: 1, reason: { kind: 'completed' }, data: { turn: 1, reason: { kind: 'completed' } } };
    const merged = mergeTurnUsage(payload, acc.read('s1', 1));
    expect(merged.message).toEqual({ usage: expect.objectContaining({ input: 358, output: 22 }) });
    expect(merged.turnIndex).toBe(1);
    expect(merged.usage).toEqual(expect.objectContaining({ input: 358 }));
    // 原有字段不能丢（reason/data 是 DSH 侧信息）
    expect(merged.reason).toEqual({ kind: 'completed' });
    expect(merged.type).toBe('turn_end');
  });

  it('★ 无补丁时原样返回（不是"补一个空 message"）', () => {
    const payload = { type: 'turn_end', turn: 1, reason: { kind: 'completed' } };
    expect(mergeTurnUsage(payload, undefined)).toEqual(payload);
  });

  it('只补缺失：DSH 将来自己带了 message/usage 时以它为准', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    const own = { inputTokens: 999 };
    const payload = { type: 'turn_end', turn: 1, message: { role: 'assistant', usage: own }, usage: own };
    const merged = mergeTurnUsage(payload, acc.read('s1', 1));
    expect(merged.message).toEqual({ role: 'assistant', usage: own });
    expect(merged.usage).toBe(own);
  });

  it('DSH 给了 message 但没有 usage ⇒ 用量挂进原 message，不覆盖 message 本体', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    const payload = { type: 'turn_end', turn: 1, message: { role: 'assistant', content: [] } };
    const merged = mergeTurnUsage(payload, acc.read('s1', 1));
    expect(merged.message).toEqual({
      role: 'assistant',
      content: [],
      usage: expect.objectContaining({ input: 358 }),
    });
  });

  it('不改原对象（避免就地污染事件负载）', () => {
    const acc = createTurnUsageAccumulator();
    acc.record('s1', REAL_STEP1);
    const payload: Record<string, unknown> = { type: 'turn_end', turn: 1 };
    mergeTurnUsage(payload, acc.read('s1', 1));
    expect(payload.message).toBeUndefined();
  });
});
