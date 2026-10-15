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
import { dedupeByTurn, deriveSessionInfo, idleOnly, makeDshListener, mapToolCallDecision, mapToolResultDecision, withSessionContext } from '../hooks';
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

  it('档位分布：①11 / ②8 / ③0（②比 HOOK-MAPPING §3.1 多 1：session_before_switch）', () => {
    const s = mappingSummary();
    expect(s.direct).toHaveLength(11);
    expect(s.semantic).toHaveLength(8);
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

    const listener = fake.listeners.get('agent/created')?.[0];
    expect(listener).toBeDefined();
    await listener?.({ agent: { session: { id: 'sess-7', header: { id: 'sess-7', cwd: '/work/w' } } } });
    expect(seen).toEqual(['sess-7']);
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
    expect(fake.listeners.get('session/event')).toHaveLength(1);

    const sessionListener = fake.listeners.get('session/event')?.[0];
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
    expect(fake.listeners.get('session/event')).toHaveLength(1);
    expect(fake.listeners.get('compaction')).toBeUndefined();

    const listener = fake.listeners.get('session/event')?.[0];
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
