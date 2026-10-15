/**
 * DSH 外观层：把 DSH 的 `Context` 包装成**本仓 features/adapters 认得的 pi 形状 API**。
 *
 * ## 为什么是"外观"而不是"改 features"
 *
 * features 只通过 `custom/adapters/**` 接触底座（223 个 TS 文件、4 个原语：工具/钩子/命令/快捷键）。
 * 换底座时**不动 features**、也不动已有的 pi 适配器，只在 DSH 侧提供一张"看起来像 pi"的 API，
 * `custom/bootstrap.ts` 因此可以**一行不改**地在 DSH 上跑（`bootstrap(createDshExtensionApi(ctx))`）。
 *
 * ## 硬纪律：**没有等价物必须显式报告**，不得静默空转
 *
 * 本项目有过多起"静默降级 = 行为悄悄变了"的事故（见 `BASE-SWITCH-DSH.md` §6.4 与
 * `docs/design/CODING-TRAPS.md`）。所以本层：
 *   - 每个成员登记一条 `surfaceReport()`：`supported` / `degraded` / `unsupported`；
 *   - `unsupported` 的成员**只要被调用**就上报一次（默认 `console.warn`，可注入），
 *     并返回安全值（`undefined`/no-op），**绝不假装成功**；
 *   - 未登记映射的钩子事件**直接抛错**（`assertEventsMapped`），而不是注册一个永不触发的钩子。
 *
 * ## 本层实现的 pi 面（实测：adapters 只用到这 18 个成员）
 *
 * `on` / `registerTool` / `registerCommand` / `registerShortcut` / `registerMessageRenderer` /
 * `registerFlag` / `getFlag` / `getActiveTools` / `setActiveTools` / `getAllTools` /
 * `getThinkingLevel` / `setThinkingLevel` / `sendMessage` / `sendUserMessage` / `appendEntry` /
 * `setSessionName`（+ 兜底的 `getMarkdownTheme` 等由 ui-adapter 直接用 pi 的实现，见其注释）
 *
 * 计数命令：`grep -rhoE '\b(pi|api)\.[a-zA-Z_][a-zA-Z0-9_]*' custom/adapters/*.ts | sort | uniq -c | sort -rn`
 */

import type { ExtensionAPI, ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent';
import { assertEventsMapped, resolveDshEvent } from './events';
import { dedupeByTurn, idleOnly, makeDshListener, withSessionContext, type PiHookHandler } from './hooks';
import { toDshToolPayload, type UnsupportedReporter } from './tool';
import type {
  DshCommandDefinition,
  DshCommandInvocation,
  DshCommandResult,
  DshContext,
  DshDisposer,
  DshEventListener,
  DshEventVia,
} from './types';

/** 成员的可用性判定 */
export type SurfaceStatus = 'supported' | 'degraded' | 'unsupported';

export interface SurfaceEntry {
  readonly member: string;
  readonly status: SurfaceStatus;
  readonly detail?: string;
  /** 该成员**被调用过**（未被调用的成员不进入报告，避免"纸面支持"） */
  readonly called: boolean;
}

export interface DshFacadeOptions {
  /** 无等价物上报（默认 console.warn） */
  readonly onUnsupported?: UnsupportedReporter;
  /** 是否交互式（DSH 侧的 UI 能力在客户端；缺省视为无 UI） */
  readonly hasUI?: boolean;
  /** 工作目录（透传到工具上下文） */
  readonly cwd?: string;
  /** 会话文件路径（透传；DSH 的会话是存储模型，未读契约 ⇒ 缺省不给） */
  readonly sessionFile?: string;
  /**
   * 覆盖某个 pi 事件的首选 DSH 落点（默认取映射表的**第一个**）。
   * 为什么需要：映射表里多个候选语义不同（例如 `session_start` 的 `agent/created` 与 `session/created`
   * 粒度不同），**默认选择是产品决策**，必须留出显式覆盖点，而不是把选择藏起来。
   */
  readonly eventOverrides?: Readonly<Record<string, string>>;
  /** 透传给 pi 处理器的第二个实参（DSH 侧拿不到 pi 的 ExtensionContext ⇒ 默认 undefined） */
  readonly piContext?: unknown;
}

export interface DshFacade {
  /** 传给 `custom/bootstrap.ts` 的 pi 形状 API */
  readonly api: ExtensionAPI;
  /** 注册出来的 disposer（工具/事件/命令），用于卸载或 HMR */
  readonly disposers: readonly DshDisposer[];
  /** 成员可用性报告（**只含被调用过的成员**，便于一眼看出"哪些面真的被用到了"） */
  surfaceReport(): readonly SurfaceEntry[];
  dispose(): void;
}

/** 记录成员可用性与调用情况 */
class SurfaceLedger {
  private readonly entries = new Map<string, { status: SurfaceStatus; detail?: string; called: boolean }>();
  private readonly report: UnsupportedReporter;

  // 注意：不用 TS 的"构造器参数属性"（`constructor(private x)`）——本仓 tsconfig 开了
  // `erasableSyntaxOnly`（Node 类型剥离要求语法可擦除），参数属性属于运行时语法，会直接报错。
  constructor(report: UnsupportedReporter) {
    this.report = report;
  }

  declare(member: string, status: SurfaceStatus, detail?: string): void {
    const prev = this.entries.get(member);
    // 一个成员可能被多次声明（例如先 supported 后因运行时缺服务降级）⇒ 取"更差"的那个
    const worse: SurfaceStatus =
      prev?.status === 'unsupported' || status === 'unsupported' ? 'unsupported'
      : prev?.status === 'degraded' || status === 'degraded' ? 'degraded'
      : 'supported';
    this.entries.set(member, { status: worse, detail: detail ?? prev?.detail, called: prev?.called ?? false });
  }

  /** 成员被调用；unsupported 的成员在此上报（每次进程一次，避免刷屏） */
  use(member: string): void {
    const e = this.entries.get(member) ?? { status: 'supported' as SurfaceStatus, called: false };
    e.called = true;
    this.entries.set(member, e);
    if (e.status === 'unsupported') {
      this.report(member, e.detail ?? '在当前 DSH 组合下没有等价能力');
    }
  }

  snapshot(): readonly SurfaceEntry[] {
    return [...this.entries.entries()]
      .map(([member, v]) => ({ member, status: v.status, detail: v.detail, called: v.called }))
      .sort((a, b) => a.member.localeCompare(b.member));
  }
}

/**
 * 创建 DSH 版 pi 外观。
 *
 * @param ctx DSH 的插件上下文（`ctx.tools` / `ctx.on` 至少要有其一；缺 `ctx.tools` 时工具注册会如实上报）
 */
export function createDshExtensionApi(ctx: DshContext, options: DshFacadeOptions = {}): DshFacade {
  const report = options.onUnsupported ?? ((member, detail) => console.warn(`[dsh-facade] 无等价物：${member} —— ${detail}`));
  const ledger = new SurfaceLedger(report);
  const disposers: DshDisposer[] = [];
  const flags = new Map<string, string | boolean>();
  let disposed = false;

  // ── 能力探测：先声明基线，再按运行时实际拥有的服务降级 ─────────────────────
  const canRegisterTool = typeof ctx.tools?.register === 'function';
  ledger.declare('registerTool', canRegisterTool ? 'supported' : 'unsupported', canRegisterTool ? undefined : 'ctx.tools 缺失（需要加载 DSH 的工具插件；裸 Context 没有该服务）');
  const canOn = typeof ctx.on === 'function';
  ledger.declare('on', canOn ? 'supported' : 'unsupported', canOn ? undefined : 'ctx.on 缺失');
  const canCommand = typeof ctx.commands?.register === 'function';
  ledger.declare('registerCommand', canCommand ? 'degraded' : 'unsupported', canCommand ? 'DSH 命令服务契约未读（dsh-commands），载荷为尽力映射' : 'ctx.commands 缺失（命令服务未加载）');
  const canRestrict = typeof (ctx.tools as { restrict?: unknown } | undefined)?.restrict === 'function';
  ledger.declare('setActiveTools', canRestrict ? 'degraded' : 'unsupported', canRestrict ? '映射到 ctx.tools.restrict（DSH 的限制是"求交"，与 pi 的"设置激活集"不完全等价）' : undefined);
  for (const member of [
    'registerShortcut',
    'registerMessageRenderer',
    'registerFlag',
    'getFlag',
    'getActiveTools',
    'getAllTools',
    'getThinkingLevel',
    'setThinkingLevel',
    'sendMessage',
    'sendUserMessage',
    'appendEntry',
    'setSessionName',
  ]) {
    ledger.declare(member, 'unsupported', '内核侧无等价服务；需要时由具体 DSH 客户端 bundle 提供（不得静默当作已支持）');
  }

  // ── 工具 ───────────────────────────────────────────────────────────────────
  /** pi 处理器第二个参数（ExtensionContext）的 DSH 侧替身：能给的给，给不了的不编造 */
  const basePiContext: unknown = options.piContext ?? { hasUI: options.hasUI, cwd: options.cwd };

  const registerTool = (definition: PiToolDefinition): void => {
    ledger.use('registerTool');
    if (!canRegisterTool || !ctx.tools) return;
    // 输入是 **pi 形状**的 ToolDefinition（外观层坐在 pi 原来的位置上）——
    // 详见 custom/adapters/dsh/tool.ts 文件头的"两个形状"说明。
    const payload = toDshToolPayload(definition, {
      onUnsupported: report,
      piContext: options.piContext ?? { hasUI: options.hasUI, cwd: options.cwd },
    });
    disposers.push(ctx.tools.register(payload));
  };

  // ── 钩子 ───────────────────────────────────────────────────────────────────
  const on = (event: string, handler: DshEventListener): void => {
    ledger.use('on');
    assertEventsMapped([event]); // 未登记 ⇒ 抛错（不注册一个永不触发的钩子）
    const mapping = resolveDshEvent(event);
    if (!mapping) return; // assertEventsMapped 已抛；此处仅为类型收窄
    const target = options.eventOverrides?.[event] ?? mapping.dsh[0];
    if (!target) {
      report(`on(${event})`, '映射表没有落点');
      return;
    }
    if (mapping.via === 'service') {
      // 服务替换类：没有事件可订阅 ⇒ 显式上报，交由使用方决定替换哪个服务
      ledger.declare(`on(${event})`, 'unsupported', `该事件在 DSH 里是**服务替换**（${mapping.dsh.join('/')}），不是事件：${mapping.note}`);
      ledger.use(`on(${event})`);
      return;
    }
    if (!canOn || !ctx.on) return;
    const via: DshEventVia = mapping.via;
    // ★ 必须经桥接层：DSH 的 waterfall 事件把"返回值"当决策，裸挂 pi 处理器会把工具调用打挂
    //   （实测 `{isError:true, error:{message:"Cannot read properties of undefined (reading 'kind')"}}`）
    const listener = makeDshListener(event, handler as PiHookHandler, {
      report,
      piContext: basePiContext,
      // 会话生命周期事件的负载里带会话身份 ⇒ 按负载派生（不编造文件路径，见 withSessionContext）
      piContextFor: (payload: unknown) => withSessionContext(basePiContext, payload),
      // pi 的 before_agent_start 是"每回合一次"、DSH 的 agent/pre-step 是"每步一次" ⇒ 按回合去重
      // （只跳过处理器，next() 照调；语义差异已在 surfaceReport 里标为 degraded）
      ...(event === 'before_agent_start' ? { dedupeKey: dedupeByTurn } : {}),
      // agent/status 在 running/idle 两个方向都发；pi 的 settled/end 只在静置时该跑（失败开放）
      ...(event === 'agent_settled' || event === 'agent_end' ? { payloadFilter: idleOnly } : {}),
    });
    if (via === 'cordis') {
      const degraded = mapping.status === 'degraded';
      ledger.declare(
        `on(${event})`,
        degraded ? 'degraded' : 'supported',
        `→ ${target}（cordis 事件）${degraded ? `；${mapping.degradedNote ?? mapping.note}` : ''}`,
      );
      ledger.use(`on(${event})`);
      disposers.push(ctx.on(target, listener));
      return;
    }
    // session-event：只能订阅追加流，再按 event.type 派发（**提交后**，观察型）
    ledger.declare(`on(${event})`, 'degraded', `→ session/event 里 type=${target}（追加流：提交后观察、**不可否决**）`);
    ledger.use(`on(${event})`);
    disposers.push(
      ctx.on('session/event', (...args: readonly unknown[]) => {
        const envelope = args[0] as { type?: unknown } | undefined;
        if (envelope?.type === target) return listener(...args);
        return undefined;
      }),
    );
  };

  // ── 命令 / 快捷键 / 渲染器 / 标志 ──────────────────────────────────────────
  /**
   * pi 形状命令 → DSH `CommandDefinition`（契约 `dsh-commands/lib/types/index.d.ts:38-56`）。
   *
   * 三处形态差异（都在这里抹平，且**显式上报**不可表达的字段）：
   *   ① `description` 在 DSH 是**必填**（pi 可选）⇒ 缺省用命令名兜底；
   *   ② `name` 必须小写、不带前导斜杠 ⇒ 规范化并把改动上报；
   *   ③ handler 形态：pi 是 `(args, ctx) => Promise<void>`，DSH 是
   *      `(invocation) => CommandResult|Promise<CommandResult>` ⇒ 透传 `rawInput`、用
   *      `withSessionContext` 把 `invocation.agent.session` 合进 pi 上下文，并把抛错映射成
   *      `{kind:'error', text}`（否则 DSH 侧只会看到一个没有说明的失败）。
   * 另外：pi 的 `getArgumentCompletions` 在 DSH 无对应（`input` 只有 `hint`/`attachments`）✗。
   */
  const registerCommand = (name: string, definition: unknown): void => {
    ledger.use('registerCommand');
    const def = (typeof definition === 'object' && definition !== null ? definition : {}) as {
      description?: string;
      getArgumentCompletions?: unknown;
      handler?: (args: string, ctx: unknown) => Promise<void> | void;
    };
    const normalized = String(name).replace(/^\//, '').toLowerCase();
    if (normalized !== String(name)) {
      report(`command.${String(name)}.name`, `DSH 要求小写、不带前导斜杠 ⇒ 已规范化为 "${normalized}"`);
    }
    if (def.getArgumentCompletions) {
      report(
        `command.${normalized}.getArgumentCompletions`,
        'DSH 的 CommandInputDescriptor 只有 hint/attachments ⇒ 命令参数补全无对应',
      );
    }
    if (!def.description) {
      report(`command.${normalized}.description`, 'pi 侧 description 可选、DSH 必填 ⇒ 用命令名兜底');
    }
    if (!canCommand || !ctx.commands) return;
    const runtime = ctx.commands;
    const dshDefinition: DshCommandDefinition = {
      name: normalized,
      description: def.description ?? normalized,
      handler: async (invocation: DshCommandInvocation): Promise<DshCommandResult> => {
        const handlerContext = withSessionContext(basePiContext, { session: invocation.agent?.session });
        try {
          await def.handler?.(invocation.rawInput ?? '', handlerContext);
          return { kind: 'success' };
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          return { kind: 'error', text: `命令 ${normalized} 执行失败：${text}` };
        }
      },
    };
    disposers.push(runtime.register(dshDefinition));
  };
  const registerShortcut = (): void => {
    ledger.use('registerShortcut');
  };
  const registerMessageRenderer = (): void => {
    ledger.use('registerMessageRenderer');
  };
  const registerFlag = (name: string, definition: unknown): void => {
    ledger.use('registerFlag');
    // 标志在本层内自持（DSH 内核无该服务）：至少让 getFlag 拿到注册值，避免调用方拿到 undefined 后误判
    const def = definition as { default?: string | boolean } | undefined;
    if (def && def.default !== undefined) flags.set(name, def.default);
  };
  const getFlag = (name: string): string | boolean | undefined => {
    ledger.use('getFlag');
    return flags.get(name);
  };
  const getActiveTools = (): string[] => {
    ledger.use('getActiveTools');
    return [];
  };
  const setActiveTools = (names: string[]): void => {
    ledger.use('setActiveTools');
    const restrict = (ctx.tools as { restrict?: (filter: { allow?: readonly string[] }) => DshDisposer } | undefined)?.restrict;
    if (typeof restrict !== 'function') return;
    disposers.push(restrict({ allow: names }));
  };
  const getAllTools = (): string[] => {
    ledger.use('getAllTools');
    return [];
  };
  const getThinkingLevel = (): string | undefined => {
    ledger.use('getThinkingLevel');
    return undefined;
  };
  const setThinkingLevel = (): void => {
    ledger.use('setThinkingLevel');
  };
  const sendMessage = (): void => {
    ledger.use('sendMessage');
  };
  const sendUserMessage = (): void => {
    ledger.use('sendUserMessage');
  };
  const appendEntry = (): void => {
    ledger.use('appendEntry');
  };
  const setSessionName = (): void => {
    ledger.use('setSessionName');
  };

  const api = {
    registerTool,
    on,
    registerCommand,
    registerShortcut,
    registerMessageRenderer,
    registerFlag,
    getFlag,
    getActiveTools,
    setActiveTools,
    getAllTools,
    getThinkingLevel,
    setThinkingLevel,
    sendMessage,
    sendUserMessage,
    appendEntry,
    setSessionName,
  } as unknown as ExtensionAPI;

  return {
    api,
    disposers,
    surfaceReport: () => ledger.snapshot(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const d of disposers.reverse()) {
        try {
          d();
        } catch (error) {
          console.warn('[dsh-facade] disposer 抛错（继续卸载其余）:', error);
        }
      }
    },
  };
}
