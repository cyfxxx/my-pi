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
  /** 命令服务（`@deepseek-ai/dsh-commands`）——**契约未读** ✗，故只做形状探测 */
  readonly commands?: { register(name: string, definition: unknown): DshDisposer };
  /** 会话事件信封（用于 `session/event` 派发：`event.type` 是日志事件类型） */
  readonly [service: string]: unknown;
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
