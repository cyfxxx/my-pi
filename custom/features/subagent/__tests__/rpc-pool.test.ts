/**
 * 常驻 RPC 池的纯逻辑守门（S2，见 docs/design/SUBAGENT-POOL.md）
 *
 * 重点：协议层的边界（分帧/关联/完成判定）与"池化启动参数不得带任务文本"这条契约——
 * 后者错了会让任务文本走到命令行上，pooled 路径就静默跑错东西。
 */
import { describe, it, expect } from 'vitest';
import {
  RpcPool,
  createLineFramer,
  encodeRequest,
  isResponseFor,
  isTurnSettled,
  poolEnabled,
  pooledProfileKey,
} from '../core/rpc-pool';
import type { RpcWorker, RpcWorkerOptions } from '../core/rpc-pool';
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

describe('pooledProfileKey：必须按内容，不能按临时文件路径（S2 的坑）', () => {
  it('同 agent 同 model ⇒ 同键（否则池永远不复用、每次都新起进程）', () => {
    const a = pooledProfileKey({ model: 'p/m', agentName: 'worker', systemPromptText: '你是 worker' });
    const b = pooledProfileKey({ model: 'p/m', agentName: 'worker', systemPromptText: '你是 worker' });
    expect(a).toBe(b);
  });

  it('人设/agent/model 任一不同 ⇒ 不同键（不同 profile 不能共用同一个已烘焙 system prompt 的进程）', () => {
    const base = { model: 'p/m', agentName: 'worker', systemPromptText: 'A' };
    expect(pooledProfileKey(base)).not.toBe(pooledProfileKey({ ...base, systemPromptText: 'B' }));
    expect(pooledProfileKey(base)).not.toBe(pooledProfileKey({ ...base, agentName: 'scout' }));
    expect(pooledProfileKey(base)).not.toBe(pooledProfileKey({ ...base, model: 'p/n' }));
  });

  it('键里不含路径形状的东西（回归：曾把 --append-system-prompt 的临时路径拼进键）', () => {
    // 用不带斜杠的 model，这样"含 / 或 tmp"就只可能来自被误拼进去的路径
    const k = pooledProfileKey({ model: 'scout', agentName: 'worker', systemPromptText: '你是 worker' });
    expect(k).not.toContain('/');
    expect(k).not.toContain('tmp');
    expect(k.split('|')).toHaveLength(4); // model | agentName | ext 旗标 | 内容哈希
  });
});

describe('RpcPool 租借语义（用注入的假 worker，不真起进程）', () => {
  function fakeWorker(opts: RpcWorkerOptions): RpcWorker & { disposed: boolean } {
    const w = {
      profileKey: opts.profileKey,
      alive: true,
      disposed: false,
      lastError: '',
      dispose(): void {
        w.alive = false;
        w.disposed = true;
      },
      onEvent: () => () => {},
      send: async () => ({}),
      waitSettled: async () => {},
    };
    return w as unknown as RpcWorker & { disposed: boolean };
  }

  const opts = (profileKey: string): RpcWorkerOptions => ({
    args: ['--mode', 'rpc'],
    command: 'node',
    cwd: '/tmp',
    env: {},
    profileKey,
  });

  it('同一 profile 的**并发**租借必须拿到不同 worker（rpc 是单会话，共用会互相踩）', () => {
    const pool = new RpcPool((o) => fakeWorker(o));
    const a = pool.lease(opts('k'));
    const b = pool.lease(opts('k'));
    expect(a.worker).not.toBe(b.worker);
    expect(pool.size()).toBe(2);
  });

  it('release 后回到 idle，下一次租借**复用同一个**（这才是省 19.1s 的地方）', () => {
    const pool = new RpcPool((o) => fakeWorker(o));
    const a = pool.lease(opts('k'));
    a.release();
    expect(pool.idleCount()).toBe(1);
    const b = pool.lease(opts('k'));
    expect(b.worker).toBe(a.worker);
    expect(pool.size()).toBe(1);
  });

  it('不同 profile 不互相复用', () => {
    const pool = new RpcPool((o) => fakeWorker(o));
    const a = pool.lease(opts('k1'));
    a.release();
    const b = pool.lease(opts('k2'));
    expect(b.worker).not.toBe(a.worker);
  });

  it('已死的 worker 不回 idle、不被复用', () => {
    const pool = new RpcPool((o) => fakeWorker(o));
    const a = pool.lease(opts('k'));
    a.worker.dispose(); // 模拟崩溃
    a.release();
    expect(pool.idleCount()).toBe(0);
    const b = pool.lease(opts('k'));
    expect(b.worker).not.toBe(a.worker);
  });

  it('idle 池有上限：超出的空闲 worker 被回收（防 profile 多/峰值高时进程堆积）', () => {
    const pool = new RpcPool((o) => fakeWorker(o), 2);
    const leases = ['a', 'b', 'c'].map((k) => pool.lease(opts(k)));
    for (const l of leases) l.release();
    expect(pool.idleCount()).toBe(2);
  });

  // ⚠️ 2026-10-10 修正：**这条测试原来把 bug 当成了契约** —— 它断言"在租的 worker 也被回收"
  // （`a.worker.alive === false` ✗），而 `shutdown()` 由 `session_shutdown` 钩子在**任务仍在跑**时触发
  // ⇒ 在跑的 worker 被 SIGTERM ⇒ 待处理请求全 reject 成「worker 被池回收」⇒ 回退到**无投递通道**的
  // spawn 路径 ⇒ **中途投递的消息永远没被消费**（并行时必现）。有测试保护，bug 才长期存活 ✓。
  // 新契约：**非 force 只回收空闲；在租的留活，交还时才销毁**（既不断任务、也不漏进程）。
  it('shutdown（非 force）：只回收空闲；**在租的留活**，交还即销毁（不断任务、不漏进程）', () => {
    const pool = new RpcPool((o) => fakeWorker(o));
    const a = pool.lease(opts('k1')); // 在租（模拟"任务还在跑"）
    const b = pool.lease(opts('k2'));
    b.release(); // b 回到空闲
    pool.shutdown();
    expect(pool.idleCount()).toBe(0); // 空闲的已回收
    expect(a.worker.alive).toBe(true); // ★ 在租的**不得**被杀（这正是旧行为错的地方）
    expect(pool.size()).toBe(1); // 仍在追踪它（不是"忘了它"）
    a.release(); // 任务结束、交还 ⇒ 收工态下直接销毁
    expect(a.worker.alive).toBe(false);
    expect(pool.size()).toBe(0);
  });

  it('shutdown(force)：连在租的一起回收（确定没有在跑的任务时用）', () => {
    const pool = new RpcPool((o) => fakeWorker(o));
    const a = pool.lease(opts('k1'));
    pool.shutdown(true);
    expect(a.worker.alive).toBe(false);
    expect(pool.size()).toBe(0);
  });
});

describe('extensions 逐次 opt-in（默认关闭）', () => {
  it('pooledProfileKey 必须区分 extensions —— 否则裸 worker 会被拿去跑"要扩展"的任务', () => {
    const base = { model: 'm', agentName: 'worker', systemPromptText: 'x' };
    expect(pooledProfileKey(base)).not.toBe(pooledProfileKey({ ...base, allowExtensions: true }));
  });

  it('池化启动参数：默认带 --no-extensions；显式 opt-in 才去掉', () => {
    expect(buildPooledSpawnArgs({})).toContain('--no-extensions');
    expect(buildPooledSpawnArgs({ allowExtensions: false })).toContain('--no-extensions');
    expect(buildPooledSpawnArgs({ allowExtensions: true })).not.toContain('--no-extensions');
  });
});
