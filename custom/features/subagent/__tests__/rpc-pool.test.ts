/**
 * 常驻 RPC 池的纯逻辑守门（S2，见 docs/design/SUBAGENT-POOL.md）
 *
 * 重点：协议层的边界（分帧/关联/完成判定）与"池化启动参数不得带任务文本"这条契约——
 * 后者错了会让任务文本走到命令行上，pooled 路径就静默跑错东西。
 */
import { describe, it, expect } from 'vitest';
import {
  createLineFramer,
  encodeRequest,
  isResponseFor,
  isTurnSettled,
  poolEnabled,
} from '../core/rpc-pool';
import { applyAgentEvent, buildPooledSpawnArgs } from '../core/runner';

describe('encodeRequest', () => {
  it('一行 JSON + 换行（rpc 协议按行分帧）', () => {
    const s = encodeRequest('7', { type: 'prompt', message: 'hi' });
    expect(s.endsWith('\n')).toBe(true);
    expect(s.trimEnd().includes('\n')).toBe(false);
    expect(JSON.parse(s)).toEqual({ id: '7', type: 'prompt', message: 'hi' });
  });

  it('带 parentSession 的 new_session（分叉语义的载体）', () => {
    expect(JSON.parse(encodeRequest('1', { type: 'new_session', parentSession: '/s/x.jsonl' }))).toEqual({
      id: '1',
      type: 'new_session',
      parentSession: '/s/x.jsonl',
    });
  });
});

describe('createLineFramer', () => {
  it('半行到达不会提前触发；补齐后才成行', () => {
    const got: string[] = [];
    const f = createLineFramer((l) => got.push(l));
    f.feed('{"type":"a"');
    expect(got).toEqual([]);
    f.feed('}\n');
    expect(got).toEqual(['{"type":"a"}']);
  });

  it('一次多行全部切出；空行忽略', () => {
    const got: string[] = [];
    const f = createLineFramer((l) => got.push(l));
    f.feed('1\n2\n\n3\n');
    expect(got).toEqual(['1', '2', '3']);
  });

  it('一个 JSON 被切成三片也能拼回（真实 stdout 分片）', () => {
    const got: string[] = [];
    const f = createLineFramer((l) => got.push(l));
    f.feed('{"ty');
    f.feed('pe":"age');
    f.feed('nt_settled"}\n');
    expect(got).toEqual(['{"type":"agent_settled"}']);
    expect(JSON.parse(got[0]).type).toBe('agent_settled');
  });

  it('flush 交出没有换行结尾的残留', () => {
    const got: string[] = [];
    const f = createLineFramer((l) => got.push(l));
    f.feed('{"type":"x"}');
    expect(got).toEqual([]);
    f.flush();
    expect(got).toEqual(['{"type":"x"}']);
  });
});

describe('完成判定与响应关联', () => {
  it('agent_settled 是本轮结束（与 my-pi 空闲门同一事件）', () => {
    expect(isTurnSettled({ type: 'agent_settled' })).toBe(true);
    expect(isTurnSettled({ type: 'message_end' })).toBe(false);
    expect(isTurnSettled(null)).toBe(false);
    expect(isTurnSettled('agent_settled')).toBe(false);
  });

  it('响应必须 id 对得上（否则会把别人的响应当自己的）', () => {
    expect(isResponseFor({ type: 'response', id: '3' }, '3')).toBe(true);
    expect(isResponseFor({ type: 'response', id: '4' }, '3')).toBe(false);
    expect(isResponseFor({ type: 'agent_settled' }, '3')).toBe(false);
    expect(isResponseFor(undefined, '3')).toBe(false);
  });
});

describe('poolEnabled：PI_SUBAGENT_POOL=off 回退', () => {
  it('默认启用；显式 off 才关闭', () => {
    expect(poolEnabled({})).toBe(true);
    expect(poolEnabled({ PI_SUBAGENT_POOL: 'on' })).toBe(true);
    expect(poolEnabled({ PI_SUBAGENT_POOL: 'off' })).toBe(false);
  });
});

describe('buildPooledSpawnArgs：只放 worker 级固定参数', () => {
  it('用 rpc 模式、不再是一次性的 -p；且**绝不带任务文本**', () => {
    const args = buildPooledSpawnArgs({});
    expect(args).toContain('--mode');
    expect(args[args.indexOf('--mode') + 1]).toBe('rpc');
    expect(args).toContain('--no-extensions');
    expect(args).toContain('--no-session');
    expect(args).not.toContain('-p');
    // 契约：池化参数里不得出现任何任务文本形状的东西（任务只走 prompt 请求）
    expect(args.some((a) => /^Task: /.test(a))).toBe(false);
    // S2 不覆盖 fork：池化参数里不得出现 --fork
    expect(args).not.toContain('--fork');
  });

  it('model / append-system-prompt 是 worker 级参数（人设仍是 system prompt）', () => {
    const args = buildPooledSpawnArgs({ model: 'p/m', promptPath: '/tmp/p.md' });
    expect(args).toContain('--model');
    expect(args).toContain('--append-system-prompt');
    expect(args).toContain('/tmp/p.md');
  });
});

describe('applyAgentEvent（两条路径共用的事件映射）', () => {
  function newResult() {
    return {
      agent: 'a',
      agentSource: 'user',
      task: 't',
      exitCode: 0,
      messages: [] as unknown[],
      stderr: '',
      model: undefined as string | undefined,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    };
  }

  it('assistant 消息累加用量与轮次，并采纳 model/stopReason', () => {
    const r = newResult();
    applyAgentEvent(
      r as never,
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          model: 'scenario-model',
          stopReason: 'stop',
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0.01 } },
        },
      },
      () => {},
    );
    expect(r.usage.turns).toBe(1);
    expect(r.usage.input).toBe(10);
    expect(r.usage.output).toBe(5);
    expect(r.usage.cacheRead).toBe(2);
    expect(r.usage.cost).toBeCloseTo(0.01);
    expect(r.model).toBe('scenario-model');
    expect(r.messages.length).toBe(1);
  });

  it('tool_result_end 直接入 messages；非这两类事件被忽略', () => {
    const r = newResult();
    applyAgentEvent(r as never, { type: 'tool_result_end', message: { role: 'toolResult' } }, () => {});
    expect(r.messages.length).toBe(1);
    applyAgentEvent(r as never, { type: 'turn_end' }, () => {});
    expect(r.messages.length).toBe(1);
    expect(r.usage.turns).toBe(0);
  });

  it('每次命中都会触发一次 UI 更新（进度可见）', () => {
    const r = newResult();
    let n = 0;
    applyAgentEvent(r as never, { type: 'tool_result_end', message: {} }, () => n++);
    expect(n).toBe(1);
    applyAgentEvent(r as never, { type: 'unknown' }, () => n++);
    expect(n).toBe(1);
  });
});
