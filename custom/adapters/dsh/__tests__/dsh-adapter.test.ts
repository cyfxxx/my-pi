/**
 * DSH 适配层单测（纯逻辑，不需要真的装 DSH 包）
 *
 * 覆盖三件事：
 *   ① 映射表完整性（18 个事件、档位分布与 `DSH-HOOK-MAPPING.md` 一致、漏登记会抛错）
 *   ② 工具载荷合成（参数/输出 schema/并发语义/deferLoading/signal 透传）
 *   ③ 钩子桥接（**waterfall 的 `next()` 纪律**、`block → deny` 翻译、改参数检测、形态差异上报）
 *   ④ 外观层（注册落到 DSH 服务、未支持成员**显式上报**而不是静默空转、surfaceReport 可查）
 */

import { describe, expect, it, vi } from 'vitest';

import { PI_TO_DSH_EVENTS, assertEventsMapped, mappingSummary, resolveDshEvent } from '../events';
import { createDshExtensionApi } from '../facade';
import {
  dedupeByTurn,
  translateStreamFrame,
  deriveSessionInfo,
  idleOnly,
  inputTextFromPayload,
  makeDshListener,
  mapToolCallDecision,
  mapToolResultDecision,
  withSessionContext,
} from '../hooks';
import { toDshToolPayload } from '../tool';
import type { DshCommandDefinition, DshContext, DshDefineToolOptions, DshEventListener } from '../types';

// ── 假 DSH ctx（记录注册与订阅，模拟 waterfall 调用）─────────────────────────

interface FakeDsh {
  ctx: DshContext;
  tools: DshDefineToolOptions[];
  unregistered: string[];
  commands: DshCommandDefinition[];
  listeners: Map<string, DshEventListener[]>;
  disposeListeners: string[];
}

/**
 * 取 `session/event` 上**给 pi 处理器用**的那条桥接监听器。
 *
 * ★ 索引不是随手写的：适配层自己会在 `session/event` 上注册一条**基础设施**订阅
 *   （回合用量累积，见 `usage-accumulator.ts`），它在 `createDshExtensionApi` 内部就注册好、
 *   早于调用方的任何 `api.on(...)` ⇒ 基础设施恒在索引 0，pi 面桥接从索引 1 起。
 *   这条不变量由下面「session/event 的订阅顺序」一测钉住。
 */
function sessionBridge(fake: FakeDsh, nth = 1): DshEventListener | undefined {
  return fake.listeners.get('session/event')?.[nth];
}

function makeFakeDsh(options: { withTools?: boolean; withCommands?: boolean } = {}): FakeDsh {
  const withTools = options.withTools ?? true;
  const withCommands = options.withCommands ?? false;
  const fake: FakeDsh = {
    ctx: {} as DshContext,
    tools: [],
    unregistered: [],
    commands: [],
    listeners: new Map(),
    disposeListeners: [],
  };
  const on = (event: string, listener: DshEventListener): (() => void) => {
    const list = fake.listeners.get(event) ?? [];
    list.push(listener);
    fake.listeners.set(event, list);
    return () => fake.disposeListeners.push(event);
  };
  const tools = withTools
    ? {
        register: (definition: DshDefineToolOptions): (() => void) => {
          fake.tools.push(definition);
          return () => fake.unregistered.push(definition.name);
        },
      }
    : undefined;
  const commands = withCommands
    ? {
        register: (definition: DshCommandDefinition): (() => void) => {
          fake.commands.push(definition);
          return () => undefined;
        },
      }
    : undefined;
  // 一次性构造（`DshContext.tools` 是 readonly，不能先建对象再赋值）
  fake.ctx = { on, ...(tools ? { tools } : {}), ...(commands ? { commands } : {}) };
  return fake;
}

// ── ① 映射表 ────────────────────────────────────────────────────────────────

describe('events 映射表', () => {
  it('19 个 pi 事件、名字唯一、都有落点与理由', () => {
    // 19 = DSH-HOOK-MAPPING.md 的 18 个（2026-10-10 静态普查）+ session_before_switch
    //      （2026-10-14 会话切换守卫新增；漏登记时适配层会**当场抛错**——这条就是被它抓出来的）
    expect(PI_TO_DSH_EVENTS).toHaveLength(19);
    expect(new Set(PI_TO_DSH_EVENTS.map((m) => m.pi)).size).toBe(19);
    for (const m of PI_TO_DSH_EVENTS) {
      expect(m.dsh.length, `${m.pi} 缺落点`).toBeGreaterThan(0);
      expect(m.note.length, `${m.pi} 缺理由`).toBeGreaterThan(0);
    }
  });

  it('档位分布：①9 / ②10 / ③0（2026-10-17 把 context 与 before_provider_request 从 ① 降到 ②：语义面不同）', () => {
    const s = mappingSummary();
    expect(s.direct).toHaveLength(9);
    expect(s.semantic).toHaveLength(10);
    expect(s.none).toHaveLength(0);
  });

  it('未登记的事件会抛错（不允许静默注册一个永不触发的钩子）', () => {
    expect(() => assertEventsMapped(['tool_call', 'not_a_real_event'])).toThrow(/not_a_real_event/);
    expect(assertEventsMapped(PI_TO_DSH_EVENTS.map((m) => m.pi))).toBeUndefined();
  });

  it('查表能拿到落点类型（cordis / session-event / service）', () => {
    expect(resolveDshEvent('tool_call')?.dsh[0]).toBe('tools/pre-execute');
    expect(resolveDshEvent('turn_start')?.via).toBe('session-event');
    // 2026-10-16 更正：压缩生命周期是会话日志事件 ⇒ 走 session/event（不再判为服务替换）。
    // 表里现在**没有** via:'service' 的条目；facade 仍保留该分支以备将来（防御性，不是当前路径）。
    expect(resolveDshEvent('session_before_compact')?.via).toBe('session-event');
    expect(PI_TO_DSH_EVENTS.some((m) => m.via === 'service')).toBe(false);
    expect(resolveDshEvent('nonexistent')).toBeUndefined();
  });
});

// ── ② 工具载荷（输入是 **pi 形状**：JSON Schema 参数 + pi 的 execute 签名）─────────

/** 一个 pi 形状的工具定义（参数是 TypeBox/JSON Schema 根对象，execute 是 pi 的五参签名） */
function samplePiTool(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'sample_tool',
    description: '示例工具',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', description: '必填文本' },
        count: { type: 'number', description: '可选数字' },
        flag: { type: 'boolean', description: '可选布尔' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签' },
        payload: { description: '任意 JSON（TypeBox Type.Unknown）' },
        mode: { anyOf: [{ const: 'a' }, { const: 'b' }], description: '枚举' },
        note: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '可空串' },
      },
    },
    // pi 的五参签名：(toolCallId, params, signal, onUpdate, piCtx)
    execute: async (toolCallId: string, params: { text: string }, signal?: AbortSignal) =>
      ({ content: [{ type: 'text', text: `got:${params.text}:id=${toolCallId}:signal=${signal ? 'yes' : 'no'}` }], details: undefined }),
    ...overrides,
  };
}

describe('tool 载荷合成（pi 形状 → DSH）', () => {
  it('参数映射：JSON Schema → 逐属性 spec，并以 required[] 反转 required 语义', () => {
    const payload = toDshToolPayload(samplePiTool() as never);
    expect(payload.parameters).toEqual({
      text: { type: 'string', description: '必填文本', required: true },
      count: { type: 'number', description: '可选数字' },
      flag: { type: 'boolean', description: '可选布尔' },
      tags: { type: 'array', description: '可选标签', items: { type: 'string' } },
      payload: { type: 'json', description: '任意 JSON（TypeBox Type.Unknown）' },
      mode: { type: 'string', enum: ['a', 'b'], description: '枚举' },
      note: { type: 'string', description: '可空串' },
    });
  });

  it('output 通用合成：canonical=string、render=文本块（"零额外工作"的根据）', () => {
    const payload = toDshToolPayload(samplePiTool() as never);
    expect(payload.output.schema).toEqual({ type: 'string' });
    expect(payload.output.render(undefined, 'hello')).toEqual([{ type: 'text', text: 'hello' }]);
    expect(payload.output.render(undefined, 42)).toEqual([{ type: 'text', text: '42' }]);
  });

  it('execute 复刻 pi 的五参签名，并把 pi 的 content 块转成 canonical 字符串', async () => {
    const payload = toDshToolPayload(samplePiTool() as never);
    const controller = new AbortController();
    const value = await payload.execute(
      { text: 'x' },
      { signal: controller.signal, name: 'sample_tool', arguments: { text: 'x' }, callId: 'c9' },
    );
    expect(value).toBe('got:x:id=c9:signal=yes');
  });

  it('pi 返回多个文本块 ⇒ 用换行拼接；非文本块 ⇒ 上报', async () => {
    const reports: string[] = [];
    const payload = toDshToolPayload(
      samplePiTool({
        execute: async () => ({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] }),
      }) as never,
      { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) },
    );
    await expect(payload.execute({}, { signal: new AbortController().signal, name: 't', arguments: {}, callId: 'c' })).resolves.toBe('a\nb');
    expect(reports.some((m) => m.includes('非文本块'))).toBe(true);
  });

  it('并发语义必须转发：executionMode=sequential ⇒ isConcurrencySafe 返回 false', () => {
    const seq = toDshToolPayload(samplePiTool({ executionMode: 'sequential' }) as never);
    expect(seq.isConcurrencySafe?.({})).toBe(false);
    const par = toDshToolPayload(samplePiTool() as never);
    expect(par.isConcurrencySafe).toBeUndefined();
  });

  it('exposure=deferred ⇒ deferLoading:true；其它 exposure ⇒ 显式上报', () => {
    const reports: string[] = [];
    const deferred = toDshToolPayload(samplePiTool({ exposure: 'deferred' }) as never, { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) });
    expect(deferred.deferLoading).toBe(true);
    expect(reports.some((m) => m.includes('exposure'))).toBe(false);

    const hidden = toDshToolPayload(samplePiTool({ exposure: 'hidden' }) as never, { onUnsupported: (m) => reports.push(m) });
    expect(hidden.deferLoading).toBeUndefined();
    expect(reports.some((m) => m.includes('exposure'))).toBe(true);
  });

  it('string|null 收窄会被上报（显式传 null 会被 DSH 拒绝）', () => {
    const reports: string[] = [];
    toDshToolPayload(samplePiTool() as never, { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) });
    expect(reports.some((r) => r.includes('note') && r.includes('string|null'))).toBe(true);
  });

  it('无法精确映射的参数**降级为 json**而不是丢掉（保住工具签名）+ 上报路径带工具名', () => {
    const reports: string[] = [];
    const payload = toDshToolPayload(
      samplePiTool({
        parameters: {
          type: 'object',
          required: [],
          properties: { weird: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
        },
      }) as never,
      { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) },
    );
    expect(payload.parameters.weird).toEqual({ type: 'json' });
    expect(reports.some((r) => r.startsWith('tool.sample_tool.parameters.weird'))).toBe(true);
  });

  it('pi 的 TUI 渲染回调在 DSH 无对应 ⇒ 上报而不是丢弃', () => {
    const reports: string[] = [];
    toDshToolPayload(samplePiTool({ renderCall: () => undefined }) as never, { onUnsupported: (m) => reports.push(m) });
    expect(reports.some((m) => m.includes('render'))).toBe(true);
  });
});

// ── ③ 钩子桥接（waterfall 纪律）──────────────────────────────────────────────

describe('hooks 桥接', () => {
  const report = () => vi.fn();

  it('不干预必须调用 next()（否则 DSH 的 waterfall 会崩）', async () => {
    const next = vi.fn().mockResolvedValue({ kind: 'allow' });
    const listener = makeDshListener('tool_call', () => undefined, { report: report() });
    const out = await listener({ callId: 'c1', name: 'bash', arguments: { cmd: 'ls' } }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: 'allow' });
  });

  it('{block:true,reason} → {kind:"deny",reason}，且不再调用 next()', async () => {
    const next = vi.fn();
    const listener = makeDshListener('tool_call', () => ({ block: true, reason: '计划模式禁止' }), { report: report() });
    const out = await listener({ callId: 'c1', name: 'bash', arguments: {} }, next);
    expect(out).toEqual({ kind: 'deny', reason: '计划模式禁止' });
    expect(next).not.toHaveBeenCalled();
  });

  it('处理器就地改 event.input ⇒ 被检测并上报（DSH 不支持改参数）', async () => {
    const rep = vi.fn();
    const next = vi.fn().mockResolvedValue(undefined);
    const listener = makeDshListener(
      'tool_call',
      (event) => {
        (event as { input: Record<string, unknown> }).input.cmd = 'rm -rf /';
        return undefined;
      },
      { report: rep },
    );
    await listener({ callId: 'c1', name: 'bash', arguments: { cmd: 'ls' } }, next);
    expect(rep).toHaveBeenCalledWith('hook.tool_call.input', expect.stringContaining('不支持改写参数'));
    // 原始参数不应被改（DSH 侧 arguments 是冻结的 lossless JSON）
    expect(next).toHaveBeenCalled();
  });

  it('terminate 无对应 ⇒ 上报', async () => {
    const rep = vi.fn();
    await makeDshListener('tool_call', () => ({ terminate: true }), { report: rep })({ callId: 'c', name: 'x', arguments: {} }, vi.fn());
    expect(rep).toHaveBeenCalledWith('hook.tool_call.terminate', expect.any(String));
  });

  it('tool_result 返回 content ⇒ {kind:"accept",content}', async () => {
    const listener = makeDshListener('tool_result', () => ({ content: [{ type: 'text', text: '改过' }] }), { report: report() });
    const out = await listener({ callId: 'c', name: 'bash', arguments: {} }, { isError: false, content: [] }, vi.fn());
    expect(out).toEqual({ kind: 'accept', content: [{ type: 'text', text: '改过' }] });
  });

  it('非 waterfall（无 next）时返回 undefined，不抛错', async () => {
    const listener = makeDshListener('agent_settled', () => undefined, { report: report() });
    await expect(listener({ status: 'idle' })).resolves.toBeUndefined();
  });

  it('决策翻译函数本身：未知形状不算干预', () => {
    expect(mapToolCallDecision(undefined)).toBeUndefined();
    expect(mapToolCallDecision({ block: false })).toBeUndefined();
    expect(mapToolCallDecision({ somethingElse: 1 })).toBeUndefined();
    expect(mapToolResultDecision({ details: {} })).toBeUndefined();
  });
});

// ── ④ 外观层 ────────────────────────────────────────────────────────────────

describe('会话身份派生（DSH 没有会话文件路径）', () => {
  it('从 session/created 的负载读出 id 与 cwd', () => {
    const info = deriveSessionInfo({ session: { id: 's1', header: { id: 's1', cwd: '/work/x' } } });
    expect(info).toEqual({ sessionId: 's1', cwd: '/work/x' });
  });

  it('从 agent/created 的负载读出 id（agent.session）', () => {
    const info = deriveSessionInfo({ agent: { session: { id: 's2', header: { id: 's2', cwd: '/work/y' } } } });
    expect(info).toEqual({ sessionId: 's2', cwd: '/work/y' });
  });

  it('**原始 Session 对象**（session/created 的负载就是 Session 本身）也能读出身份', () => {
    // 实测形态：dsh-session 的 session/created 把 Session 直接作为负载传出
    // （`{id, header:{version,id,createdAt,cwd?,isSeeded}}`），不是 `{session}` 包裹
    const info = deriveSessionInfo({ id: 'raw-1', header: { id: 'raw-1', cwd: '/work/raw' } });
    expect(info).toEqual({ sessionId: 'raw-1', cwd: '/work/raw' });
    // 只有 header、没有顶层 id 时同样成立（Session 的 id 就是从 header 派生的）
    expect(deriveSessionInfo({ header: { id: 'raw-2' } })).toEqual({ sessionId: 'raw-2' });
  });

  it('读不出身份时**原样返回**基准上下文（不编造）', () => {
    const base = { hasUI: false, cwd: '/base' };
    expect(withSessionContext(base, { type: 'turn/end' })).toBe(base);
  });

  it('合入身份时给 getSessionId/getSessionCwd，但**不给** getSessionFile（不伪造路径）', () => {
    const base = { hasUI: true, cwd: '/base', sessionManager: { getSessionFile: () => undefined } };
    const merged = withSessionContext(base, { session: { id: 's9', header: { cwd: '/work/z' } } }) as {
      cwd?: string;
      sessionManager?: Record<string, () => string | undefined>;
    };
    expect(merged.cwd).toBe('/work/z');
    expect(merged.sessionManager?.getSessionId?.()).toBe('s9');
    expect(merged.sessionManager?.getSessionCwd?.()).toBe('/work/z');
    // 关键：不新增 getSessionFile 的"可用"返回值（上面那个仍返回 undefined）
    expect(merged.sessionManager?.getSessionFile?.()).toBeUndefined();
  });

  it('经外观层：session/created 的处理器能从第二个参数拿到会话 id', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx, { cwd: '/base' });
    const seen: Array<string | undefined> = [];
    facade.api.on('session_start' as never, ((_event: unknown, ctx: unknown) => {
      const sm = (ctx as { sessionManager?: { getSessionId?: () => string | undefined } }).sessionManager;
      seen.push(sm?.getSessionId?.());
      return undefined;
    }) as never);

    // 2026-10-17：session_start 的首选落点已改为**会话级** session/created。
    // ★ 注意外观层自己也会订阅 session/created（用于跟踪当前会话对象）⇒ 取**最后一个**才是处理器。
    const sessionCreated = fake.listeners.get('session/created') ?? [];
    expect(sessionCreated.length).toBeGreaterThanOrEqual(2);
    const listener = sessionCreated[sessionCreated.length - 1];
    expect(listener).toBeDefined();
    // 会话级负载就是 Session 本身（首参）
    await listener?.({ id: 'sess-7', header: { id: 'sess-7', cwd: '/work/w' } });
    expect(seen).toEqual(['sess-7']);
    // agent 级形状（`{agent:{session}}`）同样能读出身份（备用落点）
    const viaAgent = withSessionContext({ hasUI: false }, { agent: { session: { id: 'sess-8', header: { id: 'sess-8' } } } }) as {
      sessionManager?: { getSessionId?: () => string | undefined };
    };
    expect(viaAgent.sessionManager?.getSessionId?.()).toBe('sess-8');
  });
});

describe('流帧翻译（agent/assistant-stream → pi 的 assistantMessageEvent）', () => {
  const chunkFrame = (chunk: unknown) => ({ type: 'chunk', attemptId: 'a1', revision: 1, index: 0, time: 1, chunk });

  it('text-delta / reasoning-delta / tool-call-delta 各自映射到 pi 变体，并提示 partial 丢失', () => {
    const text = translateStreamFrame(chunkFrame({ type: 'text-delta', index: 2, text: '你好' }));
    expect(text.event).toMatchObject({ type: 'text_delta', contentIndex: 2, delta: '你好' });
    expect(text.note).toContain('partial');

    const thinking = translateStreamFrame(chunkFrame({ type: 'reasoning-delta', index: 0, text: '想' }));
    expect(thinking.event).toMatchObject({ type: 'thinking_delta', delta: '想' });

    const tool = translateStreamFrame(chunkFrame({ type: 'tool-call-delta', index: 1, argumentsDelta: '{"a"' }));
    expect(tool.event).toMatchObject({ type: 'toolcall_delta', contentIndex: 1, delta: '{"a"' });
  });

  it('block-start / block-end 按块类型映射', () => {
    expect(translateStreamFrame(chunkFrame({ type: 'block-start', index: 0, blockType: 'text' })).event).toMatchObject({ type: 'text_start' });
    expect(translateStreamFrame(chunkFrame({ type: 'block-start', index: 1, blockType: 'reasoning' })).event).toMatchObject({ type: 'thinking_start' });
    expect(translateStreamFrame(chunkFrame({ type: 'block-end', index: 0, block: { type: 'text', text: '完' } })).event).toMatchObject({
      type: 'text_end',
      content: '完',
    });
    // toolcall_end 需要 pi 的 ToolCall 形状 ⇒ 不猜，显式上报
    const toolEnd = translateStreamFrame(chunkFrame({ type: 'block-end', index: 2, block: { type: 'tool-call' } }));
    expect(toolEnd.event).toBeUndefined();
    expect(toolEnd.unsupported).toContain('ToolCall');
  });

  it('usage / finish / start / end 帧没有对应变体 ⇒ 显式上报而不是静默丢', () => {
    expect(translateStreamFrame(chunkFrame({ type: 'usage', usage: { input: 1 } })).unsupported).toContain('usage');
    expect(translateStreamFrame(chunkFrame({ type: 'finish', reason: 'stop' })).unsupported).toContain('finish');
    expect(translateStreamFrame({ type: 'start' }).unsupported).toContain('start');
    expect(translateStreamFrame({ type: 'end' }).unsupported).toContain('end');
    expect(translateStreamFrame(undefined).unsupported).toBeDefined();
  });

  it('经桥接层：message_update 处理器拿到翻译后的 assistantMessageEvent', async () => {
    const seen: unknown[] = [];
    const listener = makeDshListener(
      'message_update',
      (event) => {
        seen.push((event as { assistantMessageEvent?: unknown }).assistantMessageEvent);
        return undefined;
      },
      { report: () => undefined },
    );
    const next = vi.fn().mockResolvedValue(undefined);
    await listener({ agent: { id: 'a' }, frame: chunkFrame({ type: 'text-delta', index: 0, text: '增量' }) }, next);
    expect(seen[0]).toMatchObject({ type: 'text_delta', delta: '增量' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('消息投递（sendUserMessage / sendMessage / appendEntry）', () => {
  const agentSpy = () => {
    const calls: Array<{ method: string; message: unknown }> = [];
    return {
      calls,
      agent: {
        status: 'idle',
        followup: (message: unknown) => calls.push({ method: 'followup', message }),
        steer: (message: unknown) => calls.push({ method: 'steer', message }),
      },
    };
  };

  it('sendUserMessage：默认 → agent.followup(UserMessage)；deliverAs=steer → agent.steer', () => {
    const fake = makeFakeDsh();
    const spy = agentSpy();
    (fake.ctx as unknown as Record<string, unknown>).agents = { currentInitiator: () => spy.agent };
    const facade = createDshExtensionApi(fake.ctx);

    facade.api.sendUserMessage('你好');
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.method).toBe('followup');
    const msg = spy.calls[0]?.message as { id: string; role: string; content: Array<{ type: string; text: string }>; source: { kind: string } };
    expect(msg.role).toBe('user');
    expect(msg.content).toEqual([{ type: 'text', text: '你好' }]);
    expect(msg.source).toEqual({ kind: 'user' });
    expect(typeof msg.id).toBe('string'); // brand 在运行时是恒等函数 ⇒ 普通字符串即可

    facade.api.sendUserMessage([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], { deliverAs: 'steer' });
    expect(spy.calls[1]?.method).toBe('steer');
    expect((spy.calls[1]?.message as { content: unknown[] }).content).toHaveLength(2);
    expect(facade.surfaceReport().find((e) => e.member === 'sendUserMessage')?.status).toBe('degraded');
  });

  it('sendMessage：自定义消息字段丢失**会被上报**，文本照投', () => {
    const fake = makeFakeDsh();
    const spy = agentSpy();
    const reports: string[] = [];
    (fake.ctx as unknown as Record<string, unknown>).agents = { currentInitiator: () => spy.agent };
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) });
    facade.api.sendMessage({ customType: 'my-pi/notice', content: '状态更新', display: true, details: { a: 1 } }, { deliverAs: 'nextTurn' });
    expect(spy.calls[0]?.method).toBe('followup');
    expect((spy.calls[0]?.message as { content: Array<{ text: string }> }).content[0]?.text).toBe('状态更新');
    expect(reports.some((r) => r.startsWith('sendMessage') && r.includes('customType=my-pi/notice'))).toBe(true);
  });

  it('拿不到 agent ⇒ 上报且不抛错', () => {
    const fake = makeFakeDsh();
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m) => reports.push(m) });
    expect(() => facade.api.sendUserMessage('x')).not.toThrow();
    expect(reports).toContain('sendUserMessage');
  });

  it('appendEntry：**显式不支持**（日志类型是封闭声明，写入有污染风险）', () => {
    const fake = makeFakeDsh();
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) });
    facade.api.appendEntry('my-pi/x', { a: 1 });
    expect(reports.some((r) => r.startsWith('appendEntry') && r.includes('SessionEventMap'))).toBe(true);
  });
});

describe('会话事件桥（session/event 的真实签名与负载）', () => {
  it('`(session, event)` 两参形态能被识别；按 event.type 过滤；type 换成 pi 名；data 摊平到顶层', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const hit: unknown[] = [];
    facade.api.on('turn_start' as never, ((event: unknown) => {
      hit.push(event);
      return undefined;
    }) as never);

    const listener = sessionBridge(fake);
    expect(listener).toBeDefined();
    // 真实签名：(session, event)；事件是日志事件 {type, seq, time, data}
    const session = { id: 's-1', header: { id: 's-1' } };
    await listener?.(session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 7 } });
    expect(hit).toHaveLength(1);
    const seen = hit[0] as { type?: string; turn?: number; data?: { turn?: number } };
    expect(seen.type).toBe('turn_start'); // pi 事件名
    expect(seen.turn).toBe(7);            // data 已摊平
    expect(seen.data?.turn).toBe(7);      // 原始 data 保留

    // 不同 type 不串台
    await listener?.(session, { type: 'turn/end', seq: 1, time: 2, data: { turn: 7, reason: 'completed' } });
    expect(hit).toHaveLength(1);
  });

  it('不是本事件的 type / 没有 type 的负载 ⇒ 不调处理器', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const handler = vi.fn();
    facade.api.on('turn_start' as never, handler as never);
    const listener = sessionBridge(fake);
    await listener?.({ id: 's' }, { type: 'step/start', data: {} });
    await listener?.({ id: 's' });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('回合用量：从 assistant/message 累积并补进 turn/end（Host 日志实测的负载差异）', () => {
  it('★ 订阅顺序不变量：基础设施（用量累积）恒在索引 0，pi 面桥接从 1 起', () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    // 一条 pi 面事件都没注册时，session/event 上就该已经有且只有基础设施那一条
    expect(fake.listeners.get('session/event')).toHaveLength(1);
    facade.api.on('turn_end' as never, vi.fn() as never);
    expect(fake.listeners.get('session/event')).toHaveLength(2);
  });

  it('★ 端到端：assistant/message 的用量被累积，turn_end 处理器能读到 event.message.usage', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const seen: unknown[] = [];
    facade.api.on('turn_end' as never, ((event: unknown) => {
      seen.push(event);
      return undefined;
    }) as never);
    const bridge = sessionBridge(fake);
    const infra = fake.listeners.get('session/event')?.[0];

    // 真 Host 日志里的两条用量（同一回合的两个 step）——先喂给基础设施订阅
    await infra?.({ id: 's' }, { type: 'assistant/message', seq: 16, data: { turn: 1, step: 1, usage: { inputTokens: 358, outputTokens: 22, cacheReadTokens: 10240, cacheWriteTokens: 0, totalTokens: 10620 } } });
    await infra?.({ id: 's' }, { type: 'assistant/message', seq: 23, data: { turn: 1, step: 2, usage: { inputTokens: 249, outputTokens: 89, cacheReadTokens: 10496, cacheWriteTokens: 0, totalTokens: 10834 } } });
    // turn_end 桥接此时才该看到（处理器没注册 message_end 也能拿到 ⇒ 这是关键）
    await bridge?.({ id: 's' }, { type: 'turn/end', seq: 25, data: { turn: 1, reason: { kind: 'completed' } } });

    expect(seen).toHaveLength(1);
    const event = seen[0] as { turnIndex?: number; message?: { usage?: { input?: number; output?: number; cacheRead?: number } }; reason?: unknown };
    expect(event.message?.usage?.input).toBe(358 + 249);   // 多 step 求和
    expect(event.message?.usage?.output).toBe(22 + 89);
    expect(event.message?.usage?.cacheRead).toBe(10240 + 10496);
    expect(event.turnIndex).toBe(1);
    expect(event.reason).toEqual({ kind: 'completed' }); // DSH 原有字段不丢

    // ★ 语义说明：`read` 不销毁桶 ⇒ 再 end 一次仍带用量（这是**故意的**：
    //   多特性各自收到一条 turn/end 时都必须拿到用量，不能"谁先谁得"）。
    seen.length = 0;
    await bridge?.({ id: 's' }, { type: 'turn/end', seq: 26, data: { turn: 1, reason: { kind: 'completed' } } });
    expect((seen[0] as { message?: { usage?: { input?: number } } }).message?.usage?.input).toBe(358 + 249);
  });

  it('★ 反向探针：没有 assistant/message 用量时，turn_end 处理器拿到的负载保持原样（不合成假用量）', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const seen: unknown[] = [];
    facade.api.on('turn_end' as never, ((event: unknown) => {
      seen.push(event);
      return undefined;
    }) as never);
    await sessionBridge(fake)?.({ id: 's' }, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } });
    const event = seen[0] as { message?: unknown; usage?: unknown; turnIndex?: number };
    expect(event.message).toBeUndefined();
    expect(event.usage).toBeUndefined();
    // 也没编 turnIndex（DSH 的 data.turn 摊平后是 turn，处理器要 turnIndex 时我们才补）
    expect(event.turnIndex).toBeUndefined();
  });

  it('★ 反向探针：别的会话事件不会被误当用量（含 turn/end 自身带 usage 的异常负载）', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const seen: unknown[] = [];
    facade.api.on('turn_end' as never, ((event: unknown) => {
      seen.push(event);
      return undefined;
    }) as never);
    const infra = fake.listeners.get('session/event')?.[0];
    await infra?.({ id: 's' }, { type: 'turn/end', data: { turn: 1, usage: { inputTokens: 5, outputTokens: 5 } } });
    await sessionBridge(fake)?.({ id: 's' }, { type: 'turn/end', seq: 1, data: { turn: 1 } });
    expect((seen[0] as { message?: unknown }).message).toBeUndefined();
  });

  it('★ 多特性注册 turn_end 时**每个**处理器都能拿到用量（Host 冒烟实测：销毁式取值会丢）', async () => {
    // 真 Host 里 3 个特性都注册了 turn_end ⇒ 一条 turn/end 触发 3 条桥接。
    // 若桥接是"取走即清桶"，只有第一条能拿到用量，其余全部拿到 undefined。
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const got: Array<number | undefined> = [];
    for (let i = 0; i < 3; i += 1) {
      facade.api.on('turn_end' as never, ((event: unknown) => {
        got.push((event as { message?: { usage?: { input?: number } } }).message?.usage?.input);
        return undefined;
      }) as never);
    }
    const infra = fake.listeners.get('session/event')?.[0];
    await infra?.({ id: 's' }, { type: 'assistant/message', seq: 16, data: { turn: 1, step: 1, usage: { inputTokens: 300, outputTokens: 20 } } });
    await infra?.({ id: 's' }, { type: 'assistant/message', seq: 17, data: { turn: 1, step: 2, usage: { inputTokens: 200, outputTokens: 10 } } });
    // 三条桥接（索引 1/2/3）都该收到同一条 turn/end
    for (const listener of (fake.listeners.get('session/event') ?? []).slice(1)) {
      await listener({ id: 's' }, { type: 'turn/end', seq: 18, data: { turn: 1, reason: { kind: 'completed' } } });
    }
    expect(got).toEqual([500, 500, 500]);
  });

  it('★ 反向探针：不同会话的相同回合号不串账（桥接按会话 id 分桶）', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const got: Array<number | undefined> = [];
    facade.api.on('turn_end' as never, ((event: unknown) => {
      got.push((event as { message?: { usage?: { input?: number } } }).message?.usage?.input);
      return undefined;
    }) as never);
    const infra = fake.listeners.get('session/event')?.[0];
    const bridge = sessionBridge(fake);
    // 真实 Session 形状（既有 id 也有 header.id）
    await infra?.({ id: 's-A', header: { id: 's-A' } }, { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 111, outputTokens: 1 } } });
    // 只带顶层 id 的中间层形状（兜底路径）
    await infra?.({ id: 's-B' }, { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 222, outputTokens: 2 } } });
    await bridge?.({ id: 's-B', header: { id: 's-B' } }, { type: 'turn/end', data: { turn: 1 } });
    await bridge?.({ id: 's-A', header: { id: 's-A' } }, { type: 'turn/end', data: { turn: 1 } });
    expect(got).toEqual([222, 111]);
  });
});

describe('工具必须注册**编译产物**（defineTool；Host 冒烟实测的致命 bug）', () => {
  it('提供 compileTool 时：注册的是编译结果，不是原始 options', () => {
    const fake = makeFakeDsh();
    const compiled: unknown[] = [];
    const compileTool = (options: unknown) => {
      const o = options as { name: string; parameters: Record<string, unknown> };
      const out = { ...o, parameters: { type: 'object', properties: o.parameters } };
      compiled.push(out);
      return out;
    };
    const facade = createDshExtensionApi(fake.ctx, { compileTool });
    facade.api.registerTool(samplePiTool() as never);
    expect(compiled).toHaveLength(1);
    expect(fake.tools[0]).toBe(compiled[0]); // 注册的是编译产物本身
    expect((fake.tools[0]?.parameters as { type?: string }).type).toBe('object');
  });

  it('**不提供** compileTool 时显式上报（否则真实 provider 会拒掉每个请求）', () => {
    const fake = makeFakeDsh();
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) });
    facade.api.registerTool(samplePiTool() as never);
    expect(reports.some((r) => r.startsWith('registerTool.compile') && r.includes('type object'))).toBe(true);
  });
});

describe('同名冲突必须**就地隔离**（Host 冒烟实测：冒泡会连带丢掉该特性后面的注册）', () => {
  /** 让第 n 次注册抛"已注册"（模拟 DSH 的 NamedEntries.duplicateError） */
  function makeDuplicateAt(fake: FakeDsh, names: readonly string[]) {
    const register = (fake.ctx.tools as { register: (d: { name: string }) => () => void }).register;
    (fake.ctx.tools as { register: unknown }).register = (definition: { name: string }) => {
      if (names.includes(definition.name)) throw new Error(`tool "${definition.name}" is already registered`);
      return register(definition);
    };
  }

  it('★ 一个工具同名冲突 ⇒ 只跳过它，**后面注册的工具照常进注册表**', () => {
    const fake = makeFakeDsh();
    const reports: string[] = [];
    // 用**真实施策里会让位**的那个名字（`subagent`）：DSH 底座上宿主自带同名工具
    makeDuplicateAt(fake, ['subagent']);
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) });
    // 模拟 subagent 特性真实的注册顺序：subagent（冲突、让位）→ 后面的注册必须照常成功
    facade.api.registerTool({ ...samplePiTool(), name: 'subagent' } as never);
    facade.api.registerTool({ ...samplePiTool(), name: 'fetch_url' } as never);
    expect(fake.tools.map((t) => t.name)).toEqual(['fetch_url']);
    // 冲突必须点名上报（不静默）
    expect(reports.some((r) => r.startsWith('registerTool.duplicate:subagent') && r.includes('already registered'))).toBe(true);
    // 注册汇总必须可量（真 Host 上就靠这行核对"到底少了什么"）
    expect(facade.registrationSummary()).toEqual({
      tools: ['fetch_url'],
      commands: [],
      skippedDuplicates: ['工具:subagent'],
      hooks: [],
    });
  });

  it('★ 命令同名冲突同理：不冒泡（Host 实测 plan-mode 的 3 个钩子排在命令注册之后）', () => {
    const fake = makeFakeDsh({ withCommands: true });
    const reports: string[] = [];
    const register = (fake.ctx as unknown as { commands: { register: (d: { name: string }) => () => void } }).commands.register;
    (fake.ctx as unknown as { commands: { register: unknown } }).commands.register = (definition: { name: string }) => {
      if (definition.name === 'plan') throw new Error('command "plan" is already registered');
      return register(definition);
    };
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) });
    expect(() => facade.api.registerCommand('plan' as never, { description: '计划模式' } as never)).not.toThrow();
    facade.api.registerCommand('memory' as never, { description: '记忆' } as never);
    expect(fake.commands.map((c) => c.name)).toEqual(['memory']);
    expect(reports.some((r) => r.startsWith('registerCommand.duplicate:plan'))).toBe(true);
    expect(facade.registrationSummary().skippedDuplicates).toEqual(['命令:plan']);
  });

  it('★ 反向探针：非同名错误也**不**吞（注册表故障必须冒泡，别被当成"冲突"掩盖）', () => {
    const fake = makeFakeDsh();
    (fake.ctx.tools as { register: unknown }).register = () => {
      throw new Error('registry exploded');
    };
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m, d) => reports.push(`${m} :: ${d}`) });
    facade.api.registerTool(samplePiTool() as never);
    // 仍要上报（不静默），但报文里要带真实错误文本，便于区分"冲突"与"真故障"
    expect(reports.some((r) => r.includes('registry exploded'))).toBe(true);
  });
});

describe('工具清单与会话名（2026-10-17 新增落点）', () => {
  it('getActiveTools/getAllTools 落到 ctx.tools.schemas()（状态 degraded，不再报 unsupported）', () => {
    const fake = makeFakeDsh();
    (fake.ctx.tools as { schemas?: () => Array<{ name: string }> }).schemas = () => [
      { name: 'searxng' },
      { name: 'fetch_url' },
      { name: 'subagent' },
    ];
    const facade = createDshExtensionApi(fake.ctx);
    expect(facade.api.getActiveTools()).toEqual(['searxng', 'fetch_url', 'subagent']);
    expect(facade.api.getAllTools()).toEqual(['searxng', 'fetch_url', 'subagent']);
    expect(facade.surfaceReport().find((e) => e.member === 'getAllTools')?.status).toBe('degraded');
  });

  it('schemas() 缺失 ⇒ 上报且返回空（不假装有清单）', () => {
    const fake = makeFakeDsh();
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m) => reports.push(m) });
    expect(facade.api.getAllTools()).toEqual([]);
    expect(reports).toContain('getAllTools');
  });

  it('setSessionName：rename(跟踪到的会话, 标题)；没有 sessionTitle 服务时上报', () => {
    const fake = makeFakeDsh();
    const renamed: Array<{ session: unknown; title: string }> = [];
    const renamedCtx = fake.ctx as unknown as Record<string, unknown>;
    renamedCtx.sessionTitle = { get: () => undefined, rename: (session: unknown, title: string) => renamed.push({ session, title }) };
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m) => reports.push(m) });

    // 外观层订阅了 session/created ⇒ 先喂一个会话（最后一个监听器是处理器，基础设施在地一个）
    const created = fake.listeners.get('session/created') ?? [];
    const session = { id: 's-1', header: { id: 's-1' } };
    created[0]?.({ ...session, session });
    created[0]?.(session);

    facade.api.setSessionName('新标题');
    expect(renamed).toEqual([{ session, title: '新标题' }]);

    // 没有 sessionTitle 服务：显式上报（不静默丢弃）
    const bareReports: string[] = [];
    const bare = createDshExtensionApi(makeFakeDsh().ctx, { onUnsupported: (m, d) => bareReports.push(`${m} :: ${d}`) });
    bare.api.setSessionName('x');
    expect(bareReports.some((m) => m.includes('sessionTitle'))).toBe(true);
  });
});

describe('命令映射（pi 形状 → DSH CommandDefinition）', () => {
  /** pi 形状的命令定义（我们的 ui-adapter 就是这么注册的） */
  const piCommand = (overrides: Record<string, unknown> = {}) => ({
    description: '切换模式',
    handler: async (args: string, ctx: unknown) => {
      (piCommand.seen as unknown[]).push({ args, ctx });
    },
    ...overrides,
  });
  piCommand.seen = [] as unknown[];

  it('名称规范化（去斜杠 + 小写）并上报；description 缺失时用命令名兜底', () => {
    const fake = makeFakeDsh({ withCommands: true });
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m) => reports.push(m) });
    facade.api.registerCommand('Mode' as never, { handler: async () => undefined } as never);
    expect(fake.commands[0]?.name).toBe('mode');
    expect(fake.commands[0]?.description).toBe('mode');
    expect(reports).toContain('command.Mode.name');
    expect(reports).toContain('command.mode.description');
  });

  it('handler 收到 rawInput，并返回 {kind:"success"}；上下文带会话身份', async () => {
    const fake = makeFakeDsh({ withCommands: true });
    const facade = createDshExtensionApi(fake.ctx, { cwd: '/base' });
    piCommand.seen = [];
    // 注意：注册的是**构造出的定义**（`piCommand()`），不是工厂函数本身
    facade.api.registerCommand('mode', piCommand() as never);
    const result = await fake.commands[0]?.handler({
      rawInput: ' roleplay',
      agent: { session: { id: 's-1', header: { id: 's-1', cwd: '/work' } } },
    });
    expect(result).toEqual({ kind: 'success' });
    const seen = piCommand.seen[0] as { args: string; ctx: { cwd?: string; sessionManager?: { getSessionId?: () => string | undefined } } };
    expect(seen.args).toBe(' roleplay'); // 原文透传（含前导空白）
    expect(seen.ctx.sessionManager?.getSessionId?.()).toBe('s-1');
    expect(seen.ctx.cwd).toBe('/work');
  });

  it('handler 抛错 ⇒ 映射为 {kind:"error"}，消息带命令名与原因', async () => {
    const fake = makeFakeDsh({ withCommands: true });
    const facade = createDshExtensionApi(fake.ctx);
    facade.api.registerCommand('boom', {
      description: 'x',
      handler: async () => {
        throw new Error('配置损坏');
      },
    } as never);
    const result = await fake.commands[0]?.handler({ rawInput: '' });
    expect(result).toEqual({ kind: 'error', text: expect.stringContaining('配置损坏') });
  });

  it('getArgumentCompletions 在 DSH 无对应 ⇒ 上报（其余照常注册）', () => {
    const fake = makeFakeDsh({ withCommands: true });
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m) => reports.push(m) });
    facade.api.registerCommand('todo', { description: '待办', getArgumentCompletions: () => null, handler: async () => undefined } as never);
    expect(fake.commands).toHaveLength(1);
    expect(reports).toContain('command.todo.getArgumentCompletions');
  });

  it('命令服务缺失时上报 unsupported（不静默丢弃）', () => {
    const fake = makeFakeDsh();
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m) => reports.push(m) });
    facade.api.registerCommand('mode', piCommand() as never);
    expect(reports).toContain('registerCommand');
    expect(facade.surfaceReport().find((e) => e.member === 'registerCommand')?.status).toBe('unsupported');
  });
});

describe('每步 → 每回合一次（before_agent_start 的语义适配）', () => {
  it('同一 turn 只调一次处理器，但 **next() 每次都调**（waterfall 不能被打断）', async () => {
    const handler = vi.fn(() => undefined);
    const next = vi.fn().mockResolvedValue(undefined);
    const listener = makeDshListener('before_agent_start', handler, { report: () => undefined, dedupeKey: dedupeByTurn });

    await listener({ turn: 7, step: 1 });
    await listener({ turn: 7, step: 2 });
    await listener({ turn: 7, step: 3 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled(); // 无 next 入参（emit 形态）时不应报错

    await listener({ turn: 7, step: 4 }, next);
    expect(handler).toHaveBeenCalledTimes(1); // 仍同回合
    expect(next).toHaveBeenCalledTimes(1);     // 但 next 必须调

    await listener({ turn: 8, step: 1 }, next);
    expect(handler).toHaveBeenCalledTimes(2); // 新回合 ⇒ 再跑一次
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('负载没有回合号时**不去重**（宁可多跑，不静默少跑）', async () => {
    const handler = vi.fn(() => undefined);
    const listener = makeDshListener('before_agent_start', handler, { report: () => undefined, dedupeKey: dedupeByTurn });
    await listener({ step: 1 });
    await listener({ step: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(dedupeByTurn({ step: 1 })).toBeUndefined();
    expect(dedupeByTurn({ turn: 0 })).toBe('turn:0');
  });

  it('经外观层：before_agent_start 走 agent/pre-step 且按 turn 去重（状态为 degraded）', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const handler = vi.fn(() => undefined);
    facade.api.on('before_agent_start' as never, handler as never);
    const listener = fake.listeners.get('agent/pre-step')?.[0];
    expect(listener).toBeDefined();
    await listener?.({ turn: 1, step: 1 });
    await listener?.({ turn: 1, step: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    const entry = facade.surfaceReport().find((e) => e.member === 'on(before_agent_start)');
    expect(entry?.status).toBe('degraded');
    expect(entry?.detail).toContain('每步');
  });
});

describe('input：pi 的 decision → agent/pre-step 的 PreStepDecision', () => {
  const payloadWithText = (text: string) => ({
    messages: [
      { role: 'user', content: [{ type: 'text', text: '早期消息' }] },
      { role: 'user', content: [{ type: 'text', text }, { type: 'text', text: '（附图）' }] },
    ],
  });

  it('inputTextFromPayload：取**最后一条**含文本块的 user 消息（多块换行拼接）', () => {
    expect(inputTextFromPayload(payloadWithText('你好'))).toBe('你好\n（附图）');
    expect(inputTextFromPayload({ messages: [] })).toBe('');
    expect(inputTextFromPayload({})).toBe('');
    expect(inputTextFromPayload(undefined)).toBe('');
  });

  it('{action:"handled"} ⇒ {kind:"reject"}，且不调 next()（并上报 reject 语义未核实）', async () => {
    const reports: string[] = [];
    const next = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn(() => ({ action: 'handled' }));
    const listener = makeDshListener('input', handler, { report: (m) => reports.push(m) });
    const out = await listener(payloadWithText('命令'), next);
    expect(out).toEqual({ kind: 'reject' });
    expect(next).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(reports).toContain('hook.input.handled');
  });

  it('undefined / {action:"continue"} ⇒ 调 next()（不干预）', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const listener = makeDshListener('input', () => undefined, { report: () => undefined });
    await listener(payloadWithText('普通输入'), next);
    expect(next).toHaveBeenCalledTimes(1);
    const next2 = vi.fn().mockResolvedValue(undefined);
    const listener2 = makeDshListener('input', () => ({ action: 'continue' }), { report: () => undefined });
    await listener2(payloadWithText('x'), next2);
    expect(next2).toHaveBeenCalledTimes(1);
  });

  it('{action:"transform"} 暂不实现 ⇒ **按不干预处理**并显式上报（不静默改行为）', async () => {
    const reports: string[] = [];
    const next = vi.fn().mockResolvedValue(undefined);
    const listener = makeDshListener('input', () => ({ action: 'transform', text: '改写后' }), {
      report: (m) => reports.push(m),
    });
    await listener(payloadWithText('原样'), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(reports).toContain('hook.input.transform');
  });

  it('处理器能从事件里读到文本；streamingBehavior 缺失会被上报', async () => {
    const reports: string[] = [];
    let seenText: string | undefined;
    let seenBehavior: string | undefined;
    const listener = makeDshListener(
      'input',
      (event) => {
        const e = event as { text?: string; streamingBehavior?: string };
        seenText = e.text;
        seenBehavior = e.streamingBehavior;
      },
      { report: (m) => reports.push(m) },
    );
    await listener(payloadWithText('读我'), vi.fn().mockResolvedValue(undefined));
    expect(seenText).toBe('读我\n（附图）');
    expect(seenBehavior).toBeUndefined();
    expect(reports).toContain('hook.input.streamingBehavior');
  });
});

describe('agent_settled / agent_end：只在 idle 方向触发', () => {
  it('idleOnly：idle 放行、running 拦住、**形状不认识时失败开放**', () => {
    expect(idleOnly({ status: 'idle' })).toBe(true);
    expect(idleOnly({ status: 'running' })).toBe(false);
    expect(idleOnly({})).toBe(true);            // 没有 status ⇒ 放行（宁可多跑）
    expect(idleOnly({ status: 42 })).toBe(true); // 形状不对 ⇒ 放行
    expect(idleOnly(undefined)).toBe(true);
  });

  it('被过滤时**不调处理器但 next() 照调**', async () => {
    const handler = vi.fn(() => undefined);
    const next = vi.fn().mockResolvedValue(undefined);
    const listener = makeDshListener('agent_settled', handler, { report: () => undefined, payloadFilter: idleOnly });
    await listener({ status: 'running' }, next);
    expect(handler).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    await listener({ status: 'idle' }, next);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('经外观层：agent_settled 订到 agent/status、过滤 running，且状态为 degraded', async () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const handler = vi.fn(() => undefined);
    facade.api.on('agent_settled' as never, handler as never);
    const listener = fake.listeners.get('agent/status')?.[0];
    expect(listener).toBeDefined();
    await listener?.({ status: 'running' });
    await listener?.({ status: 'idle' });
    expect(handler).toHaveBeenCalledTimes(1);
    const entry = facade.surfaceReport().find((e) => e.member === 'on(agent_settled)');
    expect(entry?.status).toBe('degraded');
    expect(entry?.detail).toContain('两个方向');
  });
});

describe('facade 外观层', () => {
  it('registerTool 落到 ctx.tools.register，disposer 可回收', () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    facade.api.registerTool(samplePiTool() as never);
    expect(fake.tools).toHaveLength(1);
    expect(fake.tools[0]?.name).toBe('sample_tool');
    facade.dispose();
    expect(fake.unregistered).toEqual(['sample_tool']);
  });

  it('ctx 缺 tools 服务时**显式上报**，不静默丢弃', () => {
    const fake = makeFakeDsh({ withTools: false });
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m) => reports.push(m) });
    facade.api.registerTool(samplePiTool() as never);
    expect(reports).toContain('registerTool');
    expect(facade.surfaceReport().find((e) => e.member === 'registerTool')?.status).toBe('unsupported');
  });

  it('on(tool_call) 订阅到 tools/pre-execute；on(turn_start) 走 session/event 且按 type 过滤', () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const toolCall = vi.fn();
    const turnStart = vi.fn();
    facade.api.on('tool_call' as never, toolCall as never);
    facade.api.on('turn_start' as never, turnStart as never);
    expect(fake.listeners.get('tools/pre-execute')).toHaveLength(1);
    // 2 条：基础设施（回合用量累积）+ 本测试注册的 turn_start 桥接
    expect(fake.listeners.get('session/event')).toHaveLength(2);

    const sessionListener = sessionBridge(fake);
    sessionListener?.({ type: 'turn/start' });
    expect(turnStart).toHaveBeenCalledTimes(1);
    sessionListener?.({ type: 'turn/end' });
    expect(turnStart).toHaveBeenCalledTimes(1);
  });

  it('未登记的事件直接抛错（不注册永不触发的钩子）', () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    expect(() => facade.api.on('before_tool_call' as never, (() => undefined) as never)).toThrow(/before_tool_call/);
  });

  it('压缩生命周期事件走 session/event 且按 compaction/start 派发（2026-10-16 更正）', () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const handler = vi.fn();
    facade.api.on('session_before_compact' as never, handler as never);
    // 订阅的是会话事件流，不是某个 cordis 事件
    // （2 条：基础设施的回合用量累积 + 本测试注册的桥接）
    expect(fake.listeners.get('session/event')).toHaveLength(2);
    expect(fake.listeners.get('compaction')).toBeUndefined();

    const listener = sessionBridge(fake);
    // 只转发压缩开始；其它会话事件（及 turn/end 之类）不应触发我们的处理器
    listener?.({ type: 'compaction/start', compactionId: 'c1', turn: 3 });
    expect(handler).toHaveBeenCalledTimes(1);
    listener?.({ type: 'compaction/summary' });
    listener?.({ type: 'turn/end' });
    expect(handler).toHaveBeenCalledTimes(1);
    // 状态是 **degraded** 而不是 supported：会话事件是"提交后观察"，丢失了 pi 的"可否决"语义
    // （我们这处只需要观察+快照 ⇒ 够用，但要在报告里如实体现降级）
    const entry = facade.surfaceReport().find((e) => e.member === 'on(session_before_compact)');
    expect(entry?.status).toBe('degraded');
    expect(entry?.detail).toContain('不可否决');
  });

  it('未支持的 pi 成员被调用时上报，且返回安全值', () => {
    const fake = makeFakeDsh();
    const reports: string[] = [];
    const facade = createDshExtensionApi(fake.ctx, { onUnsupported: (m) => reports.push(m) });
    expect(facade.api.getThinkingLevel()).toBeUndefined();
    expect(reports).toContain('getThinkingLevel');
    facade.api.setThinkingLevel('high' as never);
    expect(reports).toContain('setThinkingLevel');
  });

  it('surfaceReport 列出"已声明"的全部 pi 面，并用 called 标记哪些真的被用到', () => {
    const fake = makeFakeDsh();
    const facade = createDshExtensionApi(fake.ctx);
    const before = facade.surfaceReport();
    // 声明阶段就登记完整面（便于一眼看出"哪些面在 DSH 上根本没有"），此时都还没被调用
    expect(before.length).toBeGreaterThan(10);
    expect(before.every((e) => e.called === false)).toBe(true);
    expect(before.filter((e) => e.status === 'unsupported').length).toBeGreaterThan(5);

    facade.api.registerTool(samplePiTool() as never);
    const tool = facade.surfaceReport().find((e) => e.member === 'registerTool');
    expect(tool?.status).toBe('supported');
    expect(tool?.called).toBe(true);
  });
});
