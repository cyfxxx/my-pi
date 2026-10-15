/**
 * 钩子桥接：把 pi 形状的处理器**翻译**成 DSH 期望的监听器。
 *
 * ## 为什么必须翻译（本轮实测的硬事实）
 *
 * DSH 的 `tools/pre-execute` / `tools/execute` / `tools/post-execute` 是 **waterfall**：
 * 监听器返回的东西就是**决策**。实测（真实 `@deepseek-ai/dsh-tools@0.2.0-rc.2`，最小 harness）：
 *
 * ```
 * ctx.on('tools/pre-execute', () => undefined)      // 一个"只观察"的监听器
 * → 执行结果 = { isError: true, error: { message: "Cannot read properties of undefined (reading 'kind')" } }
 * ```
 *
 * ⇒ **直接把 pi 处理器原样挂上去会把工具调用打挂**（静默变成 isError）。正确做法：
 *   ① 处理器不干预（pi 语义：返回 `undefined`）⇒ 必须调用 `next()` 放行；
 *   ② 处理器要拦（pi：`{ block: true, reason }`）⇒ 翻译成 DSH 的 `{ kind: 'deny', reason }`；
 *   ③ 有形态差异的能力（改参数 / `terminate` / `details`）⇒ **显式上报**，不静默吞掉。
 *
 * ## 逐项映射（pi → DSH）
 *
 * | pi（`tool_call` 处理器） | DSH（`tools/pre-execute`） | 说明 |
 * |---|---|---|
 * | 返回 `undefined` | `next()` | 不干预 = 放行 |
 * | `{ block: true, reason }` | `{ kind: 'deny', reason }` | **安全关键路径**（plan-mode 之类靠它否决工具） |
 * | `{ block: false }` | `next()` | |
 * | `{ terminate: true }` | 无对应 ✗ | 上报；DSH 的回合终止在 agent 层 |
 * | **就地改 `event.input`** | 无对应 ✗（DSH 明确排除：参数已记录/已呈现） | 通过"执行前后快照比对"**检测到并上报** |
 *
 * | pi（`tool_result` 处理器） | DSH（`tools/post-execute`） | 说明 |
 * |---|---|---|
 * | 返回 `undefined` | `next()` | |
 * | `{ content }` | `{ kind: 'accept', content }` | 文本/图片块同形 |
 * | `{ details }` / `{ isError }` | 无对应 ✗ | 上报 |
 */

import type { DshContentBlock, DshEventListener, DshEventVia } from './types';

/** 上报通道（与 facade 共用形状） */
export type ReportFn = (member: string, detail: string) => void;

/** DSH 的 pre-execute 决策（只声明我们会产出的分支） */
type PreToolDecision = { kind: 'allow' } | { kind: 'deny'; reason: string };

/** DSH 的 post-execute 决策（只声明我们会产出的分支） */
type PostToolDecision = { kind: 'accept'; content?: DshContentBlock[] } | { kind: 'allow' };

/** pi 的 `tool_call` 处理器返回值（只声明我们认识的字段） */
interface PiToolCallResult {
  block?: boolean;
  reason?: string;
  terminate?: boolean;
}

/** pi 的 `tool_result` 处理器返回值（只声明我们认识的字段） */
interface PiToolResultResult {
  content?: readonly DshContentBlock[];
  details?: unknown;
  isError?: boolean;
}

/** 处理器签名：pi 侧是 `(event, ctx) => …`；桥接层不解释 ctx 内容，原样透传 */
export type PiHookHandler = (event: unknown, context: unknown) => unknown;

export interface HookBridgeContext {
  readonly report: ReportFn;
  /** pi 形状的事件上下文字段（DSH 侧能拿到的部分；拿不到的留给使用方显式降级） */
  readonly piContext?: unknown;
  /**
   * 按**本次负载**派生 pi 上下文（可选）。
   *
   * 为什么需要：会话生命周期事件的负载里带着**本会话的身份**（DSH 的 `session/created` 给
   * `{session}`、`agent/created` 给 `{agent}`，而 `agent.session` 是 `Session`），
   * 而 pi 的处理器习惯从第二个参数（ExtensionContext）读会话身份。
   * 不派生的话，那些处理器在 DSH 上拿不到"这是哪个会话"——这正是 pi→DSH 最容易静默出错的地方。
   */
  readonly piContextFor?: (payload: unknown) => unknown;
  /**
   * 把"每步"事件适配成"每回合一次"用的去重键（可选）。
   *
   * 背景：pi 的 `before_agent_start` 是**每回合一次**，DSH 的对应点 `agent/pre-step` 是**每步一次**
   * （一回合里可能有多次模型请求）⇒ 不去重会让"回合开始才该跑一次"的逻辑跑多次。
   * ★ 只对 **pi 处理器**去重：waterfall 的 `next()` **每次都要调**，否则会打挂调用链。
   * 返回 `undefined` 表示"这次不去重"（例如负载里没有回合号）。
   */
  readonly dedupeKey?: (payload: unknown) => string | undefined;
  /**
   * 负载过滤器（可选）：返回 `false` 时**跳过 pi 处理器**，但 `next()` 仍然照调。
   *
   * 用途：DSH 的一个事件可能覆盖 pi 的两个语义。例如 `agent/status` 在 `running` 与 `idle`
   * **两个方向**都发，而 pi 的 `agent_settled`/`agent_end` 只在"静置"时该跑 ⇒ 必须按
   * `payload.status === 'idle'` 过滤，否则处理器会在每回合开始时也跑一遍。
   */
  readonly payloadFilter?: (payload: unknown) => boolean;
}

/**
 * 只在 `agent/status` 翻到 `idle` 时放行（供 `agent_settled` / `agent_end` 使用）。
 *
 * **失败开放**：负载里读不到 `status`（形状不是预期的）时返回 `true` —— 宁可多跑一次，
 * 也不要因为"认不出形状"而静默少跑一次清理（这正是本项目最忌讳的失效形态）。
 */
export function idleOnly(payload: unknown): boolean {
  const status = (typeof payload === 'object' && payload !== null ? (payload as { status?: unknown }).status : undefined);
  if (typeof status !== 'string') return true;
  return status === 'idle';
}

/** 从 `agent/pre-step` 的负载里取回合号（`{agent, messages, turn, step, signal}`） */
export function dedupeByTurn(payload: unknown): string | undefined {
  const turn = (typeof payload === 'object' && payload !== null ? (payload as { turn?: unknown }).turn : undefined);
  return typeof turn === 'number' || typeof turn === 'string' ? `turn:${String(turn)}` : undefined;
}

/**
 * 从事件负载里提取 DSH 的会话身份（**只读已有字段，不编造**）。
 *
 * 支持的形状（都来自真实契约）：
 *   - `{ session: { id, header: { id, cwd } } }`   ← `session/created`（`dsh-session/lib/types/index.d.ts:42`）
 *   - `{ agent: { session: … } }`                   ← `agent/created`（`dsh-agent/lib/types/runtime-types.d.ts:143` 有 `readonly session`）
 *   - `{ header: … }`                               ← 会话日志信封
 *
 * ✗ 注意：DSH 的会话是**存储模型**，`SessionHeader` 只有 `id`/`createdAt`/`cwd`，
 *   **没有磁盘文件路径**（`dsh-session/lib/types/types.d.ts` 的 `SessionHeader`）。
 *   所以这里**绝不**伪造 `getSessionFile()`；调用方要用稳定键就用 `getSessionId()`。
 */
export function deriveSessionInfo(payload: unknown): { sessionId?: string; cwd?: string } {
  const asRecord = (v: unknown): Record<string, unknown> | undefined =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  const root = asRecord(payload);
  const session =
    asRecord(root?.session) ?? asRecord(asRecord(root?.agent)?.session) ?? undefined;
  const header = asRecord(session?.header) ?? asRecord(root?.header) ?? undefined;
  const id = session?.id ?? header?.id;
  const cwd = header?.cwd ?? session?.cwd;
  return {
    ...(typeof id === 'string' && id.length > 0 ? { sessionId: id } : {}),
    ...(typeof cwd === 'string' && cwd.length > 0 ? { cwd } : {}),
  };
}

/** 从 DSH 的执行对象里取字段（不假设它一定有，缺就缺） */
function execField(exec: unknown, key: string): unknown {
  if (typeof exec === 'object' && exec !== null) return (exec as Record<string, unknown>)[key];
  return undefined;
}

/** 深拷贝一份"参数快照"用于检测就地改动（args 是 lossless JSON ⇒ JSON 往返安全） */
function snapshotArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? null);
  } catch {
    return '<unserializable>';
  }
}

/**
 * 构造给 pi 处理器的 `tool_call` 事件（形状对齐 pi：`{type, toolCallId, toolName, input}`）。
 * `input` 是**可变的副本**——这样"就地改参数"的处理器不会直接改到 DSH 的冻结参数，
 * 我们也就能检测到它想改（然后显式上报"DSH 不支持改参数"）。
 */
export function toPiToolCallEvent(exec: unknown): Record<string, unknown> {
  const input = execField(exec, 'arguments');
  return {
    type: 'tool_call',
    toolCallId: execField(exec, 'callId') ?? '',
    toolName: execField(exec, 'name') ?? '',
    input: typeof input === 'object' && input !== null ? { ...(input as Record<string, unknown>) } : input,
  };
}

/** 构造给 pi 处理器的 `tool_result` 事件（只填我们能填的字段） */
export function toPiToolResultEvent(exec: unknown, result: unknown): Record<string, unknown> {
  return {
    type: 'tool_result',
    toolCallId: execField(exec, 'callId') ?? '',
    toolName: execField(exec, 'name') ?? '',
    input: execField(exec, 'arguments'),
    result,
  };
}

/**
 * pi 的 `tool_call` 决策 → DSH 的 `PreToolDecision`。
 * 返回 `undefined` 表示"无干预"（调用方必须 `next()`）。
 */
export function mapToolCallDecision(decision: unknown): PreToolDecision | undefined {
  if (decision === undefined || decision === null) return undefined;
  const d = decision as PiToolCallResult;
  if (d.block === true) {
    return { kind: 'deny', reason: d.reason ?? '被扩展钩子阻断（pi 兼容层）' };
  }
  if (d.block === false) return undefined;
  // 只写了 terminate / 其它未知字段：没有可翻译的决策 ⇒ 视为无干预（由调用方上报）
  return undefined;
}

/** pi 的 `tool_result` 决策 → DSH 的 `PostToolDecision`；`undefined` = 无干预 */
export function mapToolResultDecision(decision: unknown): PostToolDecision | undefined {
  if (decision === undefined || decision === null) return undefined;
  const d = decision as PiToolResultResult;
  if (Array.isArray(d.content)) return { kind: 'accept', content: d.content as DshContentBlock[] };
  return undefined;
}

/**
 * 把 pi 形状的处理器包装成 DSH 监听器。
 *
 * 判定 waterfall 的方式是**运行时探测**：cordis 的 waterfall 监听器收到的最后一个实参是 `next` 函数。
 * 这比在映射表里硬编码 `@mode` 更可靠（映射表里的 mode 来自文档注解，未逐个回源确认，见
 * DSH-HOOK-MAPPING.md §4#5）。
 */
export function makeDshListener(piEvent: string, handler: PiHookHandler, bridge: HookBridgeContext): DshEventListener {
  let lastDedupeKey: string | undefined;
  return async (...args: readonly unknown[]): Promise<unknown> => {
    const report = bridge.report;
    const last = args.length > 0 ? args[args.length - 1] : undefined;
    const next = typeof last === 'function' ? (last as () => Promise<unknown>) : undefined;
    const first = args.length > 0 ? args[0] : undefined;

    // 本次负载对应的 pi 上下文（会话事件里带会话身份；其它事件回落到默认）
    const piContext = bridge.piContextFor ? bridge.piContextFor(first) : bridge.piContext;

    // 负载过滤：不匹配时**只跳过 pi 处理器**，`next()` 仍然必须调
    if (bridge.payloadFilter && !bridge.payloadFilter(first)) return next ? next() : undefined;

    // "每步"→"每回合一次"的去重：**只跳过 pi 处理器**，`next()` 仍然必须调（见 dedupeKey 说明）
    if (bridge.dedupeKey) {
      const key = bridge.dedupeKey(first);
      if (key !== undefined) {
        if (key === lastDedupeKey) return next ? next() : undefined;
        lastDedupeKey = key;
      }
    }

    if (piEvent === 'tool_call') {
      const event = toPiToolCallEvent(first);
      const before = snapshotArgs((event as { input?: unknown }).input);
      const decision = await handler(event, piContext);
      // ① 想改参数？DSH 在 pre-execute 阶段明确不支持（参数已记录/已呈现）⇒ 检测到就上报
      const after = snapshotArgs((event as { input?: unknown }).input);
      if (before !== after) {
        report(
          'hook.tool_call.input',
          '处理器就地修改了 event.input；DSH 的 tools/pre-execute 不支持改写参数（参数已记录/已呈现）⇒ 改动被忽略',
        );
      }
      // ② terminate 无对应
      const terminate = (decision as PiToolCallResult | undefined)?.terminate;
      if (terminate === true) {
        report('hook.tool_call.terminate', 'DSH 的 tools/pre-execute 无 terminate 语义（回合终止在 agent 层）');
      }
      // ③ 决策翻译
      const mapped = mapToolCallDecision(decision);
      if (mapped) return mapped;
      return next ? next() : undefined;
    }

    if (piEvent === 'tool_result') {
      const event = toPiToolResultEvent(first, args.length > 1 ? args[1] : undefined);
      const decision = await handler(event, piContext);
      const d = decision as PiToolResultResult | undefined;
      if (d && d.details !== undefined) {
        report('hook.tool_result.details', 'DSH 的 tools/post-execute 决策没有 details 字段');
      }
      if (d && d.isError !== undefined) {
        report('hook.tool_result.isError', 'DSH 的 tools/post-execute 决策没有 isError 字段（错误由结果自身携带）');
      }
      const mapped = mapToolResultDecision(decision);
      if (mapped) return mapped;
      return next ? next() : undefined;
    }

    if (piEvent === 'input') {
      // pi 的 input 处理器返回 {action:'continue'|'transform'|'handled'}；
      // DSH 的 agent/pre-step 是 waterfall，判定是 {kind:'reject'} | {kind:'enter',messages}
      const text = inputTextFromPayload(first);
      const event = { type: 'input', text, source: 'user' } as {
        type: string;
        text: string;
        source: string;
        streamingBehavior?: string;
      };
      // DSH 的 pre-step 负载里没有"steer / followUp"这一维 ⇒ 置空并**上报**（否则 pi 处理器会以为不是 steer）
      report('hook.input.streamingBehavior', 'DSH 的 agent/pre-step 负载不含 streamingBehavior（steer/followUp）⇒ 该字段为空，依赖它的处理器会走非 steer 分支');
      const decision = (await handler(event, piContext)) as { action?: unknown } | undefined;
      const action = decision?.action;
      if (action === 'handled') {
        // pi：输入已被处理，不要送给模型 ⇒ DSH：否决这一步
        // ✗ 语义差异（未核实）：DSH 的 reject 之后消息是否回到收件箱未知；若否，行为是"输入被吞掉"而非"被处理"
        report('hook.input.handled', 'pi 的 handled ⇒ DSH 的 {kind:"reject"}（已实现）；但 reject 后消息是否回到收件箱**未核实**（需真 agent）');
        return { kind: 'reject' };
      }
      if (action === 'transform') {
        report(
          'hook.input.transform',
          'pi 的 transform 要替换进入 step 的消息内容（DSH 的 UserMessage 有稳定 id 与不可变 content）⇒ 需真 agent 上下文验证后再实现；本次按不干预处理',
        );
        return next ? next() : undefined;
      }
      if (action !== undefined && action !== 'continue') {
        report(`hook.${piEvent}.decision`, `未知 action=${String(action)} ⇒ 按不干预处理`);
      }
      return next ? next() : undefined;
    }

    // 其余事件：先按观察者语义调用处理器，然后**必须**按 waterfall/emit 语义收尾
    const decision = await handler(first, piContext);
    if (decision !== undefined && decision !== null) {
      report(`hook.${piEvent}.decision`, '该事件的返回值在本层还没有翻译规则（可能是拦截语义）⇒ 本次按"不干预"处理');
    }
    return next ? next() : undefined;
  };
}

/**
 * 把会话身份合进 pi 上下文（**只增不减、不编造**）。
 *
 * 行为：负载里能读出会话身份时，返回一个带 `sessionManager.getSessionId()`/`getSessionCwd()`
 * 的新对象（保留原有字段）；读不出就**原样返回**，绝不给假值。
 * ✗ 刻意**不**提供 `getSessionFile()`：DSH 的会话是存储模型，没有磁盘文件路径；
 *   伪造一个路径会让上层把它当真实文件用（例如写进重启请求的 `targetSession`）。
 */
export function withSessionContext(base: unknown, payload: unknown): unknown {
  const info = deriveSessionInfo(payload);
  if (!info.sessionId && !info.cwd) return base;
  const asRecord = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const b = asRecord(base);
  const sm = asRecord(b.sessionManager);
  return {
    ...b,
    ...(info.cwd ? { cwd: info.cwd } : {}),
    sessionManager: {
      ...sm,
      ...(info.sessionId ? { getSessionId: (): string | undefined => info.sessionId } : {}),
      ...(info.cwd ? { getSessionCwd: (): string | undefined => info.cwd } : {}),
    },
  };
}

/**
 * 从 `agent/pre-step` 的负载里取"这次要进入模型的用户文本"。
 *
 * pi 的 `input` 处理器读 `event.text`；DSH 的对应负载是 `{messages: UserMessage[]}`
 * （消息刚从收件箱里取出来）⇒ 取**最后一条**含文本块的 user 消息的文本（多块用换行拼接）。
 * 取不到就返回空串（不编造）。
 */
export function inputTextFromPayload(payload: unknown): string {
  const messages = (typeof payload === 'object' && payload !== null ? (payload as { messages?: unknown }).messages : undefined);
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = (typeof messages[i] === 'object' && messages[i] !== null ? (messages[i] as { content?: unknown }).content : undefined);
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    for (const block of content) {
      const b = typeof block === 'object' && block !== null ? (block as { type?: unknown; text?: unknown }) : undefined;
      if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    }
    if (texts.length > 0) return texts.join('\n');
  }
  return '';
}

/** 映射表的落点类型（供 facade 判断是否需要包 session/event 信封） */
export type { DshEventVia };
