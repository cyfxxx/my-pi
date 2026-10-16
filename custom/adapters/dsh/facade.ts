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
import {
  dedupeByTurn,
  deriveSessionInfo,
  idleOnly,
  makeDshListener,
  streamingBehaviorFromInboxTarget,
  withSessionContext,
  type PiHookHandler,
} from './hooks';
import { getDshService } from './service';
import { toDshToolPayload, type UnsupportedReporter } from './tool';
import { createTurnUsageAccumulator, mergeTurnUsage } from './usage-accumulator';
import type {
  DshAgentLike,
  DshDefineTool,
  DshAgents,
  DshCommandDefinition,
  DshCommandInvocation,
  DshCommandResult,
  DshContext,
  DshDisposer,
  DshCommandRuntime,
  DshEventListener,
  DshEventVia,
  DshSessions,
  DshSessionTitle,
  DshToolRegistry,
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
  /**
   * DSH 的 `defineTool` 编译器（**强烈建议提供**）。
   *
   * 为什么必须：`ctx.tools.register()` 要的是 `defineTool(options)` 的**编译产物**
   * （逐属性 spec → 模型侧 JSON Schema）；直接注册原始 options 会让真实 provider 拒掉每个请求
   * （2026-10-18 Host 冒烟实测：`schema must be a JSON Schema of 'type: "object"', got 'type: null'`）。
   * 由 `dsh/plugin/entry.ts` 注入，`custom/` 因此保持零 DSH import。
   */
  readonly compileTool?: DshDefineTool;
  /**
   * **命令名重映射**（pi 命令名 → DSH 命令名）。
   *
   * 用途：宿主已占用某个命令名时，**不丢** my-pi 的命令面，而是换一个名字注册
   * （本仓实际用法：`plan` → `mypi-plan`，让位宿主的 `/plan` 同时保住自己的子命令面）。
   *
   * 为什么只给**命令**留重映射、不给工具：工具名对**模型**可见，改名会改变模型行为
   * （所以要改就走 feature 侧改名 + 重新过声明面基线）；命令名是**用户敲的**，
   * 换名只影响输入习惯、不改变能力 ⇒ 可以在适配层解决。合法性由宿主校验
   * （`dsh-commands`：`/^[a-z][a-z0-9_-]*$/`），非法名会被宿主拒绝并如实上报。
   */
  readonly commandNameMap?: Readonly<Record<string, string>>;
}

/** 注册汇总（诊断用；见 `DshFacade.registrationSummary`） */
export interface RegistrationSummary {
  /** 成功注册进 DSH 的工具名（按注册顺序） */
  readonly tools: readonly string[];
  /** 成功注册进 DSH 的命令名（规范化后、按注册顺序） */
  readonly commands: readonly string[];
  /**
   * 因**同名冲突**被跳过的名字（`工具:subagent` / `命令:plan` 形式）。
   * 为什么单独记：DSH 原生已占用这些名字，而"跳过"必须是**可见**的（不然就是静默少能力）。
   */
  readonly skippedDuplicates: readonly string[];
  /**
   * 真正订阅成功的 pi 事件名（去重）。
   * 为什么单独记：同名冲突原先会让冲突之后的注册（**含钩子**）全部丢失 —— 而"钩子少了几条"
   * 从工具数量上看不出来（plan-mode 的只读护栏就在钩子里）⇒ 必须可量。
   */
  readonly hooks: readonly string[];
}

export interface DshFacade {
  /** 传给 `custom/bootstrap.ts` 的 pi 形状 API */
  readonly api: ExtensionAPI;
  /** 注册出来的 disposer（工具/事件/命令），用于卸载或 HMR */
  /**
   * 注册出来的 disposer（工具/事件/命令），用于卸载或 HMR。
   *
   * ★ 数组类型是**可变**的（属性本身只读）：插件入口在 facade 建好后会继续挂自己那条 disposer
   *   （`dsh/plugin/entry.ts` 的 system-prompt 注册）。原先标成 `readonly DshDisposer[]` 会让那段代码
   *   **类型检查失败**，而 `dsh/` 长期不在官方 tsc 覆盖内（只过 esbuild/tsx，不做类型检查）⇒
   *   这个错一直没被发现（2026-10-18 手工 typecheck 才暴露，见 `dsh/README.md`）。
   */
  readonly disposers: DshDisposer[];
  /** 成员可用性报告（**只含被调用过的成员**，便于一眼看出"哪些面真的被用到了"） */
  surfaceReport(): readonly SurfaceEntry[];
  /**
   * 注册汇总：到底成功注册了哪些工具/命令、哪些因同名冲突被跳过。
   *
   * 为什么需要：同名冲突原先会**连带丢掉该特性后面的注册**（见 registerTool 里的注释），
   * 而"少注册了哪些"必须可**量**（真 Host 上 grep 日志即可核对），不能靠读代码推。
   */
  registrationSummary(): RegistrationSummary;
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
 * @param ctx DSH 的插件上下文（`tools` / `ctx.on` 至少要有其一；缺 `tools` 时工具注册会如实上报）
 */
export function createDshExtensionApi(ctx: DshContext, options: DshFacadeOptions = {}): DshFacade {
  const report = options.onUnsupported ?? ((member, detail) => console.warn(`[dsh-facade] 无等价物：${member} —— ${detail}`));
  const ledger = new SurfaceLedger(report);
  const disposers: DshDisposer[] = [];
  const flags = new Map<string, string | boolean>();
  let disposed = false;

  // ── 能力探测：先声明基线，再按运行时实际拥有的服务降级 ─────────────────────
  // ★ 服务一律经 `getDshService` 取：cordis 里"未 inject 就访问 `ctx.x`"会**抛错**（真实 Host 实测）
  const tools = getDshService<DshToolRegistry>(ctx, 'tools');
  const commands = getDshService<DshCommandRuntime>(ctx, 'commands');
  const sessions = getDshService<DshSessions>(ctx, 'sessions');
  const sessionTitleService = getDshService<DshSessionTitle>(ctx, 'sessionTitle');
  const agents = getDshService<DshAgents>(ctx, 'agents');

  const canRegisterTool = typeof tools?.register === 'function';
  ledger.declare('registerTool', canRegisterTool ? 'supported' : 'unsupported', canRegisterTool ? undefined : 'tools 缺失（需要加载 DSH 的工具插件；裸 Context 没有该服务）');
  const canOn = typeof ctx.on === 'function';
  ledger.declare('on', canOn ? 'supported' : 'unsupported', canOn ? undefined : 'ctx.on 缺失');
  const canCommand = typeof commands?.register === 'function';
  ledger.declare('registerCommand', canCommand ? 'degraded' : 'unsupported', canCommand ? 'DSH 命令服务契约未读（dsh-commands），载荷为尽力映射' : 'commands 缺失（命令服务未加载）');
  const canRestrict = typeof (tools as { restrict?: unknown } | undefined)?.restrict === 'function';
  ledger.declare('setActiveTools', canRestrict ? 'degraded' : 'unsupported', canRestrict ? '映射到 tools.restrict（DSH 的限制是"求交"，与 pi 的"设置激活集"不完全等价）' : undefined);
  ledger.declare(
    'getActiveTools',
    typeof (tools as { schemas?: unknown } | undefined)?.schemas === 'function' ? 'degraded' : 'unsupported',
    '落到 ToolRuntime.schemas()（DSH 没有"全部 vs 激活"两个清单）',
  );
  ledger.declare(
    'getAllTools',
    typeof (tools as { schemas?: unknown } | undefined)?.schemas === 'function' ? 'degraded' : 'unsupported',
    '与 getActiveTools 同源（DSH 没有未受限的完整清单 API）',
  );
  ledger.declare(
    'setSessionName',
    typeof (sessionTitleService as { rename?: unknown } | undefined)?.rename === 'function' ? 'degraded' : 'unsupported',
    '映射到 sessionTitleService.rename(当前会话, 标题)（@deepseek-ai/dsh-session-title）；会话对象来自 session/created 跟踪',
  );
  for (const member of [
    'registerShortcut',
    'registerMessageRenderer',
    'registerFlag',
    'getFlag',
    'getThinkingLevel',
    'setThinkingLevel',
    'appendEntry',
  ]) {
    ledger.declare(member, 'unsupported', '内核侧无等价服务；需要时由具体 DSH 客户端 bundle 提供（不得静默当作已支持）');
  }

  // ── 工具 ───────────────────────────────────────────────────────────────────
  /**
   * 当前会话对象（由 `session/created` 自动跟踪）。
   *
   * 为什么需要：pi 的 `setSessionName(title)` **只给标题**，而 DSH 的
   * `SessionTitleService.rename(session, title)` 需要 **Session 对象**
   * （`dsh-session-title/lib/types/index.d.ts`）⇒ 不跟踪就无从下手。
   * ★ 这条订阅是**基础设施**，不对外声明成 pi 面成员。
   */
  let currentSession: unknown;
  /** 当前 agent（由 `agent/created` 跟踪；拿不到时回退 `agents.currentInitiator()`） */
  let currentAgent: unknown;
  /** 生成 UserMessage 的稳定 id 的序号（brand 在运行时是恒等函数，实测 `MessageId('abc') === 'abc'`） */
  let messageSeq = 0;
  /**
   * 回合用量累积器：`assistant/message` 的 usage 攒起来，补进 `turn/end` 的 pi 负载。
   *
   * 为什么必须是**基础设施**订阅（而不是挂在 pi 的 `message_end` 上）：`turn_end` 要用到用量，
   * 但 `message_end` 只有 voice 这一个默认关闭的 feature 注册（`custom/features/voice/index.ts:377`）
   * ⇒ 挂在 pi 面事件上就等于"没人注册 message_end 时用量永远攒不到"。详见 usage-accumulator.ts。
   */
  const turnUsage = createTurnUsageAccumulator();
  /**
   * 会话事件诊断开关（默认关）：只在实际排查"事件到底到没到"时打开。
   *
   * 为什么需要它：`session/event` 这类**日志事件**的派发依赖 DSH 的会话挂载与作用域，
   * 一旦不通就是**静默失效**（处理器不报错、也不触发 —— 2026-10-18 Host 冒烟踩过一次）。
   * 打开后每收到一条会话事件就打一行，能把"没到 / 到了但没识别 / 识别了但处理器没跑"三者分开。
   */
  const traceSessionEvents = process.env.MY_PI_DSH_TRACE_EVENTS === '1';
  /** 注册汇总的记账（成功项 + 同名冲突跳过项；见 `registrationSummary()`） */
  const registeredTools: string[] = [];
  const registeredCommands: string[] = [];
  const skippedDuplicates: string[] = [];
  /** 真正订阅成功的 pi 事件名（去重；用于核对"哪些钩子真的活着"） */
  const registeredHooks = new Set<string>();
  /**
   * 收件箱投递目标（消息 id → `InboxTarget`）：从会话日志的 `agent/inbox/spliced` 记录。
   *
   * 为什么需要：pi 的 `input` 负载带 `streamingBehavior`（steer/followUp），而 DSH 的 `agent/pre-step`
   * 负载不带这一维 ⇒ 只能从"这条消息当初被投到哪个收件箱"反查（`next-step`=steer、`next-turn`=followUp）。
   * 上限 64 条并淘汰最早的：这是长跑进程里的长期订阅，不能无限增长。
   */
  const inboxTargetByMessage = new Map<string, string>();
  const INBOX_TARGET_MAX = 64;
  /**
   * 从 `session/event` 的实参里取会话 id（第一参就是 Session；见 A13 实测的 `(session, event)`）。
   * 用途：把用量桶按会话隔离 —— 另一个会话的回合号会**重新从 1 开始**，不隔离必然串账。
   */
  const sessionIdOf = (args: readonly unknown[]): string | undefined => {
    for (const arg of args) {
      const { sessionId } = deriveSessionInfo(arg);
      if (sessionId) return sessionId;
      // 兜底：真实 Session **既有** `id` 也有 `header.id`，但中间层/测试假对象可能只带 `id`。
      // 不兜底就会出现"会话 id 读不出来 ⇒ 不同会话落到同一个兜底桶 ⇒ 串账"（单测当场抓到过）。
      const direct = (arg as { id?: unknown } | undefined)?.id;
      if (typeof direct === 'string' && direct.length > 0) return direct;
    }
    return undefined;
  };

  /** pi 处理器第二个参数（ExtensionContext）的 DSH 侧替身：能给的给，给不了的不编造 */
  const basePiContext: unknown = options.piContext ?? { hasUI: options.hasUI, cwd: options.cwd };

  /** 从 `agent/pre-step` 负载里找"进入本步的消息"，按收件箱目标派生 streamingBehavior（找不到 ⇒ undefined） */
  const streamingBehaviorOfPreStep = (payload: unknown): string | undefined => {
    const messages = (payload as { messages?: unknown } | undefined)?.messages;
    if (!Array.isArray(messages)) return undefined;
    for (const m of messages) {
      const id = typeof (m as { id?: unknown })?.id === 'string' ? (m as { id: string }).id : undefined;
      if (!id) continue;
      const derived = streamingBehaviorFromInboxTarget(inboxTargetByMessage.get(id));
      if (derived) return derived;
    }
    return undefined;
  };

  const registerTool = (definition: PiToolDefinition): void => {
    ledger.use('registerTool');
    if (!canRegisterTool || !tools) return;
    // 输入是 **pi 形状**的 ToolDefinition（外观层坐在 pi 原来的位置上）——
    // 详见 custom/adapters/dsh/tool.ts 文件头的"两个形状"说明。
    const payload = toDshToolPayload(definition, {
      onUnsupported: report,
      piContext: options.piContext ?? { hasUI: options.hasUI, cwd: options.cwd },
    });
    // ★ 必须注册**编译产物**：`ctx.tools.register()` 要的是 `defineTool(options)` 的结果
    //   （spec → 模型侧 JSON Schema）。直接注册原始 options 会让真实 provider 拒掉每个请求
    //   （Host 冒烟实测：`Invalid schema for function …: got 'type: null'`）。
    if (typeof options.compileTool !== 'function') {
      report(
        'registerTool.compile',
        '未提供 DSH 的 defineTool 编译器（facadeOptions.compileTool）⇒ 注册的是**未编译**定义，'
          + '真实 provider 会以 "schema must be a JSON Schema of type object" 拒绝请求；请由插件入口注入 defineTool',
      );
    }
    const registered = options.compileTool ? options.compileTool(payload) : payload;
    try {
      disposers.push(tools.register(registered as never));
      registeredTools.push(definition.name);
    } catch (error) {
      // ★ 同名冲突（DSH 原生已占用）**不能**让它冒泡：冒泡会被 registerAll 的"每特性 try/catch"抓住，
      //   于是该特性**排在后面的**注册**全部被跳过**。2026-10-18 Host 冒烟实测的连带损失：
      //   `web-search` 因此丢了 `fetch_url`、`subagent` 与 `plan-mode` 因此丢了各自的钩子
      //   （plan-mode 的钩子就是只读护栏）⇒ 冲突的影响面远大于"少一个同名工具"。
      //   这里只跳过**这一个**，并把冲突如实点名上报（不静默）。
      //
      // ★★ 处置策略（2026-10-18 **已决策**，依据 docs/design/DSH-DUPLICATE-CAPABILITY-AUDIT.md）：
      //   - 工具 `subagent`：**让位** DSH 原生（宿主的是同进程 spawn/fork + steer/cancel/list，
      //     我们那套是跨运行时 spawn pi 且 fork 在 DSH 上已降级）⇒ 命中这里被跳过是**预期行为**；
      //     被让位后 my-pi 独有的 5 项（chain、目录扫描式 agent 定义、逐任务 cwd、进程外投递、
      //     Termux 并发降级）已在审计文档登记为**待重设计**，不静默丢。
      //   - 命令 `plan`：**让位** DSH 的 `/plan`（入口层），但保留 my-pi 的只读护栏钩子与
      //     `plan_enter`/`plan_exit`（它们不在冲突范围内）⇒ 强制语义不丢。
      //   - 工具 `web_search`：**不让位**——宿主那个是 DeepSeek 后端（需 key），我们的是自建后端
      //     （免 key、可降级），能力不同 ⇒ 已在 2026-10-18 **改名 `searxng`**，从此不再命中这里。
      //   ★ 机制上刻意保留"靠注册表抛错来发现冲突"（而不是写死一份让位名单）：这样**万一宿主
      //     不再提供同名工具，我们的注册会自动生效**，不会因为名单过期而静默少能力。
      skippedDuplicates.push(`工具:${definition.name}`);
      report(
        `registerTool.duplicate:${definition.name}`,
        `工具 "${definition.name}" 注册失败：${error instanceof Error ? error.message : String(error)}`
          + ' ⇒ 只跳过这一个（其余注册继续）；这正是"宿主同名工具优先"的预期路径'
          + '（策略与待重设计项见 docs/design/DSH-DUPLICATE-CAPABILITY-AUDIT.md）',
      );
    }
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
      // pi 的 input 负载要 streamingBehavior，而 DSH 的 pre-step 负载没有 ⇒ 按"进入本步的消息 id"
      // 反查收件箱目标（记录见 inboxTargetByMessage）。查不到就返回 undefined ⇒ 桥接层置空并上报。
      ...(event === 'input' ? { streamingBehaviorFor: streamingBehaviorOfPreStep } : {}),
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
      registeredHooks.add(event);
      return;
    }
    // session-event：只能订阅追加流，再按 event.type 派发（**提交后**，观察型）
    ledger.declare(
      `on(${event})`,
      'degraded',
      `→ session/event 里 type=${target}（追加流：提交后观察、**不可否决**）${mapping.degradedNote ? `；${mapping.degradedNote}` : ''}`,
    );
    ledger.use(`on(${event})`);
    registeredHooks.add(event);
    disposers.push(
      ctx.on('session/event', (...args: readonly unknown[]) => {
        // ★ 2026-10-17 修：`session/event` 的真实签名是 `(session, event)`（scoped）
        // —— 第一参是 **Session**，事件在第二参。此前按 args[0] 取 type 永远拿不到，
        //   于是所有走 session-event 的 pi 事件**从未被触发**（spike A13 当场暴露）。
        const envelope = args.find(
          (a): a is { type: string } =>
            typeof a === 'object' && a !== null && typeof (a as { type?: unknown }).type === 'string',
        );
        if (!envelope) return undefined;
        if (envelope.type !== target) return undefined;
        // 交给 pi 处理器时：
        //   ① `type` 换成 **pi 的事件名**（处理器按 pi 语义读事件）；
        //   ② 把 DSH 日志事件的 `data` **摊平到顶层** —— 实测日志事件是 `{type, seq, time, data}`
        //      （例：`turn/start` 的回合号在 `data.turn`），而 pi 处理器习惯读顶层字段（`event.turn`）。
        //   ③ 保留原始 `data` 与 `seq/time`，不丢信息。
        // ✗ 仍有字段名差异：`turn/end` 的 data 是 `{turn, reason}`，没有 pi 的 `message`；
        //   `message_update` 的 pi 字段是 `assistantMessageEvent` ⇒ 这类要**字段翻译或改处理器**。
        const raw = envelope as { data?: unknown } & Record<string, unknown>;
        const data = typeof raw.data === 'object' && raw.data !== null ? (raw.data as Record<string, unknown>) : {};
        const piPayload: Record<string, unknown> = { ...raw, ...data, type: event };
        // `turn/end` 补用量：DSH 的 turn/end 只有 {turn, reason}，pi 处理器读的是
        // `event.message.usage` ⇒ 用基础设施订阅从 assistant/message 攒出来的结果**只补缺失字段**
        // （用量累计与字段翻译见 usage-accumulator.ts；真 Host 日志实测的形状差异也在那里）。
        if (envelope.type === 'turn/end') {
          // ★ 用 `read`（不销毁）而不是"取走"：**多个特性**都注册了 `turn_end` ⇒ 一条 `turn/end`
          //   会触发多条桥接，谁先谁后不确定；销毁式取值会让除第一条外的特性永远拿不到用量
          //   （2026-10-18 Host 冒烟实测：补丁只落在第一条桥接上，`recordUsage` 恰好不是它 ⇒ 用量丢失）。
          const patch = turnUsage.read(sessionIdOf(args), typeof data.turn === 'number' ? data.turn : undefined);
          if (traceSessionEvents) {
            console.log(
              `[dsh-facade] trace turn/end 桥接触发 turn=${String(data.turn)} 用量补丁=${patch ? `yes(calls=${patch.usageCalls})` : 'no'}`,
            );
          }
          return listener(mergeTurnUsage(piPayload, patch), undefined);
        }
        return listener(piPayload, undefined);
      }),
    );
  };

  // 基础设施订阅：跟踪最近创建/公告的会话与 agent（供 setSessionName / sendUserMessage 等映射使用）
  if (canOn && ctx.on) {
    // 回合用量累积（**必须先于**任何 pi 面 `turn_end` 订阅注册 ⇒ 放在基础设施这批里，
    // 而基础设施订阅都在 createDshExtensionApi 内部完成，调用方的 on() 之后才发生）
    disposers.push(
      ctx.on('session/event', (...args: readonly unknown[]) => {
        const envelope = args.find(
          (a): a is { type: string } & Record<string, unknown> =>
            typeof a === 'object' && a !== null && typeof (a as { type?: unknown }).type === 'string',
        );
        if (!envelope || envelope.type !== 'assistant/message') {
          // 收件箱投递目标：`agent/inbox/spliced` 的 `target` 是 InboxTarget（见 inboxTargetByMessage 注释）
          if (envelope?.type === 'agent/inbox/spliced') {
            const spliced = typeof envelope.data === 'object' && envelope.data !== null ? (envelope.data as Record<string, unknown>) : {};
            const target = typeof spliced.target === 'string' ? spliced.target : undefined;
            const inserted = Array.isArray(spliced.inserted) ? spliced.inserted : [];
            if (target) {
              for (const m of inserted) {
                const id = typeof (m as { id?: unknown })?.id === 'string' ? (m as { id: string }).id : undefined;
                if (!id) continue;
                inboxTargetByMessage.set(id, target);
                if (inboxTargetByMessage.size > INBOX_TARGET_MAX) {
                  const oldest = inboxTargetByMessage.keys().next();
                  if (!oldest.done) inboxTargetByMessage.delete(oldest.value);
                }
              }
            }
            if (traceSessionEvents) {
              console.log(
                `[dsh-facade] trace session/event type=agent/inbox/spliced target=${target ?? '(无)'} 插入 ${inserted.length} 条`,
              );
            }
          } else if (traceSessionEvents) {
            console.log(`[dsh-facade] trace session/event type=${envelope?.type ?? '(无 type)'}`);
          }
          return undefined;
        }
        const data = typeof envelope.data === 'object' && envelope.data !== null ? (envelope.data as Record<string, unknown>) : {};
        // 记录**摊平后**的形状（`{type, turn, step, message, usage, …}`），与交给 pi 处理器的形状一致
        const sessionId = sessionIdOf(args);
        turnUsage.record(sessionId, { ...envelope, ...data });
        if (traceSessionEvents) {
          // ★ 报"桶内调用数"而不是"入桶 yes/no"：同一回合的**第二个** step 不会让桶数增加，
          //   原先那种写法会把"已记录（并入已有桶）"打印成"没入桶"，**诊断本身在说谎**
          //   （2026-10-18 实跑就看到了 `入桶=no` 而该回合确实累积了 2 次调用）。
          //   `read` 是只读的（不清桶），拿它当探针是安全的。
          const probe = turnUsage.read(sessionId, typeof data.turn === 'number' ? data.turn : undefined);
          console.log(
            `[dsh-facade] trace session/event type=assistant/message turn=${String(data.turn)} `
              + `usage=${data.usage ? 'yes' : 'no'} 桶内调用数=${probe ? probe.usageCalls : '(未入桶)'}`,
          );
        }
        return undefined;
      }),
    );
    disposers.push(
      ctx.on('session/created', (...args: readonly unknown[]) => {
        const first = args[0];
        if (typeof first === 'object' && first !== null) currentSession = first;
        return undefined;
      }),
    );
    disposers.push(
      ctx.on('agent/created', (...args: readonly unknown[]) => {
        // `agent/created` 的负载是 `{agent, ...}`（serial 事件）——两种形状都兜住
        const first = args[0] as { agent?: unknown } | undefined;
        const agent = first && typeof first === 'object' && 'agent' in first ? first.agent : first;
        if (typeof agent === 'object' && agent !== null) currentAgent = agent;
        return undefined;
      }),
    );
  }

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
    // ★ 命令名重映射（宿主占用了这个名字时，换名注册以**保住命令面**，见 DshFacadeOptions.commandNameMap）
    const registeredName = options.commandNameMap?.[normalized] ?? normalized;
    if (registeredName !== normalized) {
      report(
        `command.${normalized}.renamed`,
        `宿主已占用 "${normalized}" ⇒ 本仓这条命令以 "${registeredName}" 注册（命令名是用户敲的，`
          + '换名只影响输入习惯、不改变能力；工具名不做这种重映射，因为工具名对模型可见）',
      );
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
    if (!canCommand || !commands) return;
    const runtime = commands;
    const dshDefinition: DshCommandDefinition = {
      name: registeredName,
      description: def.description ?? normalized,
      handler: async (invocation: DshCommandInvocation): Promise<DshCommandResult> => {
        const handlerContext = withSessionContext(basePiContext, { session: invocation.agent?.session });
        try {
          await def.handler?.(invocation.rawInput ?? '', handlerContext);
          return { kind: 'success' };
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          return { kind: 'error', text: `命令 ${registeredName} 执行失败：${text}` };
        }
      },
    };
    try {
      disposers.push(runtime.register(dshDefinition));
      registeredCommands.push(registeredName);
    } catch (error) {
      // 与 registerTool 同一条纪律：同名命令冲突只跳过这一个，不让它冒泡拖垮该特性其余注册
      //（Host 实测：plan-mode 的 3 个钩子排在 registerCommand('plan') 之后 ⇒ 冒泡就全丢）
      skippedDuplicates.push(`命令:${registeredName}`);
      report(
        `registerCommand.duplicate:${registeredName}`,
        `命令 "${registeredName}" 注册失败：${error instanceof Error ? error.message : String(error)}`
          + ' ⇒ 只跳过这一个（其余注册继续）；这正是"宿主同名命令优先"的预期路径'
          + '（`plan` 让位 DSH 的 `/plan`；my-pi 的护栏钩子与 plan_enter/plan_exit 不受影响）',
      );
    }
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
  /**
   * 当前**可见**的工具名（DSH `ToolRuntime.schemas(scope?)`，`dsh-tools/lib/types/index.d.ts:225`）。
   *
   * 说明：DSH 没有"全部注册项 vs 当前激活项"两个清单（只有 `schemas()` 这一个可见面），
   * 所以 `getActiveTools` 与 `getAllTools` 都落到它上面，并在报告里写明这是**降级**（不是等价）。
   */
  const toolNamesFromSchemas = (member: string): string[] => {
    const schemas = (tools as { schemas?: (scope?: unknown) => readonly { name?: unknown }[] } | undefined)?.schemas;
    if (typeof schemas !== 'function') {
      report(member, 'tools.schemas() 不可用 ⇒ 无法枚举工具名');
      return [];
    }
    try {
      return schemas.call(tools).map((sch) => String(sch?.name ?? '')).filter((n) => n.length > 0);
    } catch (error) {
      report(member, `tools.schemas() 调用失败：${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };

  const getActiveTools = (): string[] => {
    ledger.use('getActiveTools');
    ledger.declare('getActiveTools', 'degraded', 'DSH 只有 ToolRuntime.schemas() 一个可见面（没有"全部 vs 激活"两清单）⇒ 返回当前可见工具名');
    return toolNamesFromSchemas('getActiveTools');
  };
  const setActiveTools = (names: string[]): void => {
    ledger.use('setActiveTools');
    const restrict = (tools as { restrict?: (filter: { allow?: readonly string[] }) => DshDisposer } | undefined)?.restrict;
    if (typeof restrict !== 'function') return;
    disposers.push(restrict({ allow: names }));
  };
  const getAllTools = (): string[] => {
    ledger.use('getAllTools');
    ledger.declare('getAllTools', 'degraded', 'DSH 没有"未受限的完整清单"API ⇒ 与 getActiveTools 同源（ToolRuntime.schemas()）');
    return toolNamesFromSchemas('getAllTools');
  };
  const getThinkingLevel = (): string | undefined => {
    ledger.use('getThinkingLevel');
    return undefined;
  };
  const setThinkingLevel = (): void => {
    ledger.use('setThinkingLevel');
  };
  /**
   * 解析"当前 agent"：优先取 `agent/created` 跟踪到的，其次问注册表 `agents.currentInitiator()`
   * （在工具执行/事件处理里它给出当前 agent）。
   */
  const resolveAgent = (member: string): DshAgentLike | undefined => {
    if (currentAgent) return currentAgent as DshAgentLike;
    const registry = agents;
    const initiator = typeof registry?.currentInitiator === 'function' ? registry.currentInitiator() : undefined;
    if (initiator) return initiator;
    report(member, '拿不到当前 agent（未跟踪到 agent/created 且 agents.currentInitiator() 为空）⇒ 未发送');
    return undefined;
  };

  /**
   * 构造 DSH 的 `UserMessage`（`dsh-llm/lib/types/message.d.ts:128-147`）。
   * id 用普通字符串：DSH 的 brand 在运行时是**恒等函数**（实测 `MessageId('abc-123') === 'abc-123'`），
   * 这样适配层不必在运行时 import `@deepseek-ai/dsh-llm`（保持产物零 DSH import）。
   */
  const toUserMessage = (content: string | Array<{ type: 'text'; text: string }>): unknown => {
    messageSeq += 1;
    const blocks = Array.isArray(content)
      ? content.map((b) => ({ type: 'text', text: String(b?.text ?? '') }))
      : [{ type: 'text', text: String(content ?? '') }];
    return {
      id: `my-pi-${Date.now().toString(36)}-${messageSeq.toString(36)}`,
      role: 'user',
      content: blocks,
      source: { kind: 'user' },
    };
  };

  /** `deliverAs` 映射：`steer` → `agent.steer`；其余（followUp/nextTurn/缺省）→ `agent.followup` */
  const deliverAsUserMessage = (
    member: string,
    content: string | Array<{ type: 'text'; text: string }>,
    deliverAs: string | undefined,
  ): void => {
    const agent = resolveAgent(member);
    if (!agent) return;
    const message = toUserMessage(content);
    if (deliverAs === 'steer') {
      if (typeof agent.steer !== 'function') {
        report(member, 'agent.steer 不存在 ⇒ 未投递（steer 需要运行中的 agent）');
        return;
      }
      agent.steer(message);
      ledger.declare(member, 'degraded', '→ agent.steer(UserMessage)（注入最近一步）');
      return;
    }
    if (typeof agent.followup !== 'function') {
      report(member, 'agent.followup 不存在 ⇒ 未投递');
      return;
    }
    agent.followup(message);
    ledger.declare(
      member,
      'degraded',
      `→ agent.followup(UserMessage)${deliverAs && deliverAs !== 'followUp' ? `（交付意图 ${deliverAs} 归一到 followup）` : ''}`,
    );
  };

  const sendUserMessage = (
    content: string | Array<{ type: 'text'; text: string }>,
    options?: { deliverAs?: 'steer' | 'followUp'; expandPromptTemplates?: boolean },
  ): void => {
    ledger.use('sendUserMessage');
    if (options?.expandPromptTemplates) {
      report('sendUserMessage.expandPromptTemplates', 'pi 的模板展开在 DSH 没有对应 ⇒ 原样投递（不做展开）');
    }
    deliverAsUserMessage('sendUserMessage', content, options?.deliverAs);
  };

  const sendMessage = (
    message: { customType?: string; content?: string; display?: boolean; details?: unknown },
    options?: { triggerTurn?: boolean; deliverAs?: 'steer' | 'followUp' | 'nextTurn' },
  ): void => {
    ledger.use('sendMessage');
    // pi 的"自定义消息类型"（customType/display/details + 消息渲染器）在 DSH 没有概念：
    // DSH 的消息只有 user/assistant/tool/system/developer ⇒ 只投递文本，并**显式上报**丢失的字段。
    report(
      'sendMessage',
      `pi 的自定义消息字段（customType=${String(message?.customType ?? '')}、display、details）在 DSH 无对应 ⇒ 只投递文本内容`,
    );
    deliverAsUserMessage('sendMessage', String(message?.content ?? ''), options?.deliverAs);
  };
  /**
   * `appendEntry(customType, data)`：**显式不支持**（不是漏做）。
   *
   * 原因（实测 + 契约）：DSH 的会话日志是**强类型事件流**，每个 `type` 由某个包用
   * declaration merging 声明（`interface SessionEventMap`）。运行时不校验未知类型 ——
   * 实测 `session.append('my-pi/custom', {...})` **成功**并进入 durable log ——
   * 但把未声明的类型写进"投影/不变式都会读"的持久日志有**污染风险** ✗。
   * ⇒ 要支持它，必须先在 DSH 侧正式声明事件类型并确认投影接受，属**架构决策**，不做静默写入。
   */
  const appendEntry = (): void => {
    ledger.use('appendEntry');
    report(
      'appendEntry',
      'DSH 的会话日志类型是封闭声明（SessionEventMap）；运行时虽接受未声明类型（实测），但写入 durable log 有污染风险 ⇒ 需先在 DSH 侧声明事件类型再谈支持',
    );
  };
  /**
   * `setSessionName(title)` → `sessionTitleService.rename(session, title)`。
   *
   * 前置：① `sessionTitleService` 服务已加载（`@deepseek-ai/dsh-session-title`）；
   * ② 能拿到**当前会话对象** —— 优先用 `session/created` 跟踪到的那个，
   * 否则在"当前只有一个会话"时用它（多会话时**不猜**，直接上报）。
   * 拿不到就显式上报（不静默丢弃）。
   */
  const setSessionName = (title: string): void => {
    ledger.use('setSessionName');
    const titles = sessionTitleService as { rename?: (session: unknown, title: string) => unknown } | undefined;
    if (typeof titles?.rename !== 'function') {
      report('setSessionName', 'sessionTitleService 服务未加载（@deepseek-ai/dsh-session-title）⇒ 无法设置会话名');
      return;
    }
    let session = currentSession;
    if (!session) {
      const sessionStore = sessions as { list?: () => readonly unknown[] } | undefined;
      const list = typeof sessionStore?.list === 'function' ? sessionStore.list() : undefined;
      if (Array.isArray(list) && list.length === 1) session = list[0];
    }
    if (!session) {
      report('setSessionName', '拿不到当前会话对象（pi 只给标题、DSH 需要 Session）⇒ 未设置；多会话时不做猜测');
      return;
    }
    try {
      titles.rename(session, String(title));
      ledger.declare('setSessionName', 'degraded', '映射到 sessionTitleService.rename(当前会话, 标题)；会话对象来自 session/created 跟踪');
    } catch (error) {
      report('setSessionName', `sessionTitleService.rename 抛错：${error instanceof Error ? error.message : String(error)}`);
    }
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
    registrationSummary: () => ({
      tools: [...registeredTools],
      commands: [...registeredCommands],
      skippedDuplicates: [...skippedDuplicates],
      hooks: [...registeredHooks],
    }),
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
