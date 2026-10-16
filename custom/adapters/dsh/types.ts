/**
 * DSH 侧的最小类型声明（**本仓自持，不依赖 `@deepseek-ai/*` 包**）
 *
 * 为什么要自己声明而不是 `import type { … } from '@deepseek-ai/dsh-tools'`：
 *   1. DSH 目前是 **RC（0.2.0-rc.2）** ⇒ 接口可能变动。把用到的形状**固化在一处**，
 *      上游变了只改本文件，而不是散落到 223 个特性文件（见 DSH-MIGRATION-PLAN.md §5#6）；
 *   2. `custom/` 的类型检查走 `tsc -p custom/`（vendor/pi 的 tsconfig.base），
 *      引入 RC 包会把它的整条依赖树拖进 `paths`/`node_modules`，与"换平台不动业务代码"的目标相反；
 *   3. 本文件同时是**契约快照**：每条声明都注明出处（包、文件、行号），便于日后核对。
 *
 * 真实形状出处（本机实测的 `@deepseek-ai/dsh-tools@0.2.0-rc.2`）：
 *   - `lib/types/schema.d.ts:178-200`（`DefineToolOptions`：name/description/parameters/output/execute…）
 *   - `lib/types/schema.d.ts:11-75`（schema DSL：`StringValueSchemaSpec`…、`ParameterPropertySpec.required`）
 *   - `lib/types/index.d.ts:636`（`ToolRuntime.register(definition): () => void`）
 *   - `lib/types/index.d.ts:32-70`（`tools/pre-execute` / `tools/execute` / `tools/post-execute`，均 waterfall）
 *   - `dsh-llm/lib/types/types.d.ts:46-49`（`TextBlock = { type: 'text'; text: string }`）
 *
 * 口径：**只声明我们真的用到的部分**；用 `unknown` 而不是 `any`（本仓守门 C 禁 `any`）。
 */

/** 模型/用户可见的文本块（与 pi 的 `{type:'text',text}` 同形，见出处 5） */
export interface DshTextBlock {
  readonly type: 'text';
  readonly text: string;
}

/** 结果内容块：DSH 有多个变体（text/reasoning/image…），本仓当前只产出 text */
export type DshContentBlock = DshTextBlock | (Record<string, unknown> & { type: string });

/** 值 schema（DSH 的 author-facing DSL；此处仅列出本仓会用到的分支） */
export type DshValueSchema =
  | { readonly type: 'string'; readonly description?: string; readonly enum?: readonly string[] }
  | { readonly type: 'number'; readonly description?: string }
  | { readonly type: 'integer'; readonly description?: string }
  | { readonly type: 'boolean'; readonly description?: string }
  | { readonly type: 'null'; readonly description?: string }
  | { readonly type: 'array'; readonly description?: string; readonly items?: DshValueSchema }
  | {
      readonly type: 'object';
      readonly description?: string;
      readonly properties?: DshParameterSchema;
      /** DSH 要求显式声明开放性（`schema.d.ts:56-60`），不给默认值 */
      readonly additionalProperties: boolean;
    }
  | { readonly type: 'json'; readonly description?: string };

/** 单个参数属性：值 schema + 可选 `required: true`（DSH 用"标 required"而非"标 optional"） */
export type DshParameterProperty = DshValueSchema & { readonly required?: true };

/** 参数表本身就是隐式开放对象根 */
export type DshParameterSchema = { readonly [key: string]: DshParameterProperty };

/** 工具执行上下文（`ToolRunContext extends ToolExecution`，此处列出本仓会读的字段） */
export interface DshToolRunContext {
  /** 调用方取消信号（`ToolExecutionInput.signal`，必需） */
  readonly signal: AbortSignal;
  /** 工具名 */
  readonly name: string;
  /** 已解析参数（lossless JSON） */
  readonly arguments: unknown;
  /** 调用 id */
  readonly callId: string;
}

/** `defineTool` 的入参形状（本仓用到的那部分） */
export interface DshDefineToolOptions {
  readonly name: string;
  readonly description: string;
  readonly parameters: DshParameterSchema;
  readonly output: {
    readonly schema: DshValueSchema;
    render(args: unknown, value: unknown): DshContentBlock[];
    presentationMeta?(args: unknown, value: unknown): unknown;
  };
  readonly deferLoading?: true;
  readonly timeoutMs?: number;
  isConcurrencySafe?(args: unknown): boolean;
  execute(args: unknown, exec: DshToolRunContext): Promise<unknown>;
  readonly [extra: string]: unknown;
}

/** 注册表返回的 disposer（DSH 比 pi 多这一层，便于卸载/HMR） */
export type DshDisposer = () => void;

/**
 * 工具定义的**编译器**：DSH 的 `defineTool(options)`（`dsh-tools/lib/index.js:844-856`）。
 *
 * ★ 为什么必须过它（2026-10-18 Host 级冒烟实测的**致命 bug**）：
 *   `ctx.tools.register()` 要的是**已编译**的 `ToolDefinition` —— `defineTool()` 会把
 *   "逐属性 spec" 编译成模型侧的 JSON Schema（`{type:'object', properties:{…}}`）。
 *   我们此前直接把**原始 options**（spec）注册进去，于是 provider 收到的
 *   `input_schema` 是 `{key:{type:'string'}}`（没有 `type:'object'`）⇒ 真实 Host 里
 *   **每一个请求都被拒**：`Invalid schema for function 'admin_get_config': schema must be a
 *   JSON Schema of 'type: "object"', got 'type: null'`。
 *   本地 harness 一直没抓到，是因为我们只比对了"注册成功/能执行"，没比对**注册结果本身是不是编译产物**。
 *
 * 由 `dsh/plugin/entry.ts` 注入（那里可以 import DSH 包），从而让 `custom/` 保持零 DSH import。
 */
export type DshDefineTool = (options: unknown) => unknown;

/** 工具注册服务（`ctx.tools`） */
export interface DshToolRegistry {
  register(definition: DshDefineToolOptions): DshDisposer;
}

/** cordis 事件订阅：`ctx.on('tools/pre-execute', handler)` */
export type DshEventListener = (...args: readonly unknown[]) => unknown;

/**
 * 插件可见的 DSH 上下文（**只声明本适配层用到的服务/方法**）。
 * 真实 `Context` 上还有几百个服务；此处故意收窄，避免误以为我们已经对接了它们。
 */
export interface DshContext {
  /** 工具注册表（由工具插件注入；裸 Context 没有该服务，见评估文档 §2） */
  readonly tools?: DshToolRegistry;
  /** cordis 事件订阅（返回 disposer） */
  on?(event: string, listener: DshEventListener): DshDisposer;
  /** 命令服务（`@deepseek-ai/dsh-commands`；契约见 `DshCommandRuntime`） */
  readonly commands?: DshCommandRuntime;
  /** 会话存储（`@deepseek-ai/dsh-session`；没有它就没有会话身份可用） */
  readonly sessions?: DshSessions;
  /** 会话标题服务（`@deepseek-ai/dsh-session-title`；`setSessionName` 的落点） */
  readonly sessionTitle?: DshSessionTitle;
  /** agent 注册表（`@deepseek-ai/dsh-agent`；`sendUserMessage`/`sendMessage` 靠它拿当前 agent） */
  readonly agents?: DshAgents;
  /** 会话事件信封（用于 `session/event` 派发：`event.type` 是日志事件类型） */
  readonly [service: string]: unknown;
}

/**
 * 命令服务（`@deepseek-ai/dsh-commands` 的 `CommandRuntime extends TypertRemoteService`）。
 *
 * 出处：`dsh-commands/lib/types/index.d.ts:80-106` 与 `types.d.ts:20-41`（2026-10-16 读）。
 * ★ 契约要点（与 pi 的差异都在这里）：
 *   - **注册需要 `description`（必填）**，pi 侧是可选的；
 *   - `name` 必须**小写、不带前导斜杠**；
 *   - handler 收到的是 `{commandId, agent, rawInput, attachments, signal}`（pi 是 `(args, ctx)`）；
 *   - **必须返回 `CommandResult`**：`{kind:'success', text?} | {kind:'error', text}`（pi 返回 void）；
 *   - 输入补全（pi 的 `getArgumentCompletions`）只有 `input.hint`/`attachments` 两个字段 ⇒ 无对应 ✗。
 */
export interface DshCommandRuntime {
  register(definition: DshCommandDefinition): DshDisposer;
  list?(agent: unknown): readonly unknown[];
}

/** `CommandDefinition` 的最小快照 */
export interface DshCommandDefinition {
  readonly definitionId?: string;
  /** 小写、无前导斜杠 */
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string; readonly attachments?: boolean };
  readonly recordInput?: boolean;
  readonly handler: (invocation: DshCommandInvocation) => DshCommandResult | Promise<DshCommandResult>;
}

/** `CommandInvocation` 的最小快照 */
export interface DshCommandInvocation {
  readonly commandId?: unknown;
  readonly agent?: { readonly session?: unknown };
  /** 命令名之后的原文（**含分隔空白**） */
  readonly rawInput: string;
  readonly attachments?: readonly unknown[];
  readonly signal?: AbortSignal;
}

/** `CommandResult`（DSH 侧必须给，pi 的 handler 返回 void） */
export type DshCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string };

/**
 * 一个 agent 的最小快照（`@deepseek-ai/dsh-agent` 的 `Agent`，出处 `runtime-types.d.ts:138-200`）。
 *
 * ★ 与 pi 的对应关系（2026-10-17 读到）：
 *   - `followup(message)`：排队一个**普通后续回合**并唤醒驱动 ⇒ pi 的 `sendUserMessage(..., {deliverAs:'followUp'})`；
 *   - `steer(message)`：给**最近一步**注入转向 ⇒ pi 的 `deliverAs:'steer'`；
 *   - `send(message, target, wakeup)`：更底层的路由（可指定 next-turn/next-step 边界）；
 *   - `status`：`idle` ⇄ `running`；`session`：它驱动的会话。
 */
export interface DshAgentLike {
  readonly status?: string;
  readonly session?: unknown;
  send?(message: unknown, target: unknown, wakeup: boolean): void;
  followup?(message: unknown): void;
  steer?(message: unknown): void;
}

/** agent 注册表（`ctx.agents`）：`currentInitiator()` 在工具/事件处理里给出"当前这个 agent" */
export interface DshAgents {
  currentInitiator?(): DshAgentLike | undefined;
  requireInitiator?(): DshAgentLike;
  get?(id: unknown): DshAgentLike | undefined;
}

/**
 * 会话存储服务（`@deepseek-ai/dsh-session` 的 `SessionStore`，服务名 **`sessions`**）。
 *
 * 出处：`dsh-session/lib/types/index.d.ts:27-29`（`interface Context { sessions: SessionStore }`）与
 * `:334` 起的类声明。★ 会话对象**没有磁盘文件路径**（`SessionHeader` 只有 id/createdAt/cwd）——
 * 这是 pi 的 `getSessionFile()` 在 DSH 上没有对应物的原因。
 */
export interface DshSessions {
  create?(id?: unknown, options?: unknown): unknown;
  get?(id: unknown): unknown;
  list?(): readonly unknown[];
  enter?(session: unknown): DshDisposer;
  announce?(session: unknown): void;
}

/** 会话标题服务（`@deepseek-ai/dsh-session-title`，服务名 `sessionTitle`） */
export interface DshSessionTitle {
  get(session: unknown): unknown;
  rename(session: unknown, title: string): unknown;
}

/**
 * 系统提示词服务（`@deepseek-ai/dsh-system-prompt` 的 `SystemPrompt extends Service`）。
 *
 * 出处：`dsh-system-prompt/lib/types/index.d.ts:165-230`（2026-10-15 读）。
 * 只声明本仓用到的四个方法；**不 import** 该包（同 `DshContext` 的理由：本地快照，RC 变动只改一处）。
 */
export interface DshSystemPromptService {
  /**
   * 注册一个有序的静态提示段（返回 disposer）。
   * - `name` 必须唯一（重名会抛）；
   * - `order` 升序拼接，同序按名字的 code-unit 顺序；
   * - `interpolate: false` 保留 `{{...}}` 字面量（我们自己的文案不该被 harness 变量插值）。
   */
  section(section: DshPromptSection): DshDisposer;
  /** 解析 harness 中心分配的段位置（如 `'TOOL_GOAL'`），用于"排在工具段之后"这类诉求 */
  getSectionOrder?(name: string): number;
  /** 组装当前提示词（我们用它做**注入面基线**：哈希模型真正看到的文本） */
  assemble?(context?: unknown): Promise<DshPromptAssembly>;
}

/** 一个提示段（`PromptSection` 的最小快照） */
export interface DshPromptSection {
  readonly name: string;
  readonly order: number;
  readonly text: string | ((context: unknown) => string);
  readonly interpolate?: boolean;
  readonly complete?: boolean;
}

/** 组装结果（`PromptAssembly` 的最小快照：只取我们要哈希的部分） */
export interface DshPromptAssembly {
  readonly sections: ReadonlyArray<{ readonly name: string; readonly order: number; readonly text: string }>;
}

/**
 * 事件订阅的落点类型：
 *   - `cordis`：可 `ctx.on(名字, fn)` 直接订阅（含 waterfall）
 *   - `session-event`：只能订阅 `session/event` 后按 `event.type` 派发（**提交后**，不可拦截）
 *   - `service`：不是事件，而是**服务替换**（如替换 `ctx.compaction`）
 */
export type DshEventVia = 'cordis' | 'session-event' | 'service';
