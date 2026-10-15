/**
 * 工具映射：**pi 形状**的 `ToolDefinition` → DSH 的 `defineTool` 载荷。
 *
 * ## 为什么输入是 pi 形状（而不是本仓 features 用的内部形状）—— 迁移中的一次认知修正 ✗✓
 *
 * 本仓有两个"工具定义"形状，名字一样但内容不同：
 *
 * ```
 * features/**  ──registerTool(pi, internalDef)──▶  custom/adapters/tool-adapter.ts
 *                                                    │ 内部形状 { parameters: Record<string, ToolParameter>, execute(args, ctx) => string }
 *                                                    │ 编译成 TypeBox + 包一层 execute
 *                                                    ▼
 *                                              pi 形状 { parameters: TSchema(object), execute(toolCallId, params, signal, onUpdate, piCtx) }
 *                                                    │
 *                                              pi.registerTool(...)   ← 底座在 pi 时到此为止
 * ```
 *
 * 换到 DSH 后，**外观层坐在 pi 原来的位置上**，所以它拿到的是**pi 形状**：
 *   - 参数是 **JSON Schema/TypeBox 对象**（`{type:'object', properties:{…}, required:[…]}`），
 *     不是逐属性的 `ToolParameter`；
 *   - `execute` 的签名是 `(toolCallId, params, signal, onUpdate, piCtx)`，返回值是
 *     `{ content: [{type:'text',text}], details }`。
 *
 * 若按"内部形状"去解析（本文件的第一版就是这么写的 ✗），TypeBox 根 schema 的
 * `type/properties/required/additionalProperties` 会被当成**四个参数**，
 * 而且 `execute` 的实参全错位——真实 spike 当场暴露为：
 * `tool "web_search" returned invalid output: value is not lossless JSON`。
 * ⇒ 结论：**外观层必须消费 pi 形状**；这条写进 `DSH-MIGRATION-PLAN.md` 的实测补充。
 *
 * ## 输出：通用合成（评估阶段高估的那一条被实测推翻）
 *
 * DSH 的 `output` 必填 `{schema, render}`（`dsh-tools/lib/types/schema.d.ts:186-196`）。
 * 我们统一取 canonical = **字符串**（`StringValueSchemaSpec`），`render` 产出一个文本块
 * （`TextBlock = {type:'text',text}`，与 pi 的内容块同形）⇒ **每个工具零额外工作** ✓；
 * 想把某工具输出做成结构化（可被程序化消费）时再单独精化。
 */

import type { ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent';
import type { DshContentBlock, DshDefineToolOptions, DshParameterProperty, DshParameterSchema, DshToolRunContext, DshValueSchema } from './types';

/** 让调用方（外观层）能感知"这里没有等价物"，而不是以为映射成功了 */
export type UnsupportedReporter = (member: string, detail: string) => void;

export interface ToDshToolOptions {
  /** 无等价物时的上报通道（默认 console.warn） */
  readonly onUnsupported?: UnsupportedReporter;
  /** 传给 pi 工具 `execute` 第 5 参（`piCtx`）的对象；DSH 侧没有等价物 ⇒ 默认给最小可用形状 */
  readonly piContext?: unknown;
}

const defaultReporter: UnsupportedReporter = (member, detail) => {
  console.warn(`[dsh-adapter] 无等价物：${member} —— ${detail}`);
};

/** JSON Schema 节点的宽松读法（我们只读需要的字段，不引入 JSON Schema 库） */
interface JsonSchemaNode {
  readonly type?: unknown;
  readonly description?: unknown;
  readonly enum?: unknown;
  readonly const?: unknown;
  readonly items?: unknown;
  readonly properties?: unknown;
  readonly required?: unknown;
  readonly additionalProperties?: unknown;
  readonly anyOf?: unknown;
  readonly oneOf?: unknown;
}

function asNode(value: unknown): JsonSchemaNode | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonSchemaNode) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined;
}

/**
 * 一个 JSON Schema 节点 → DSH 值 schema。
 * 返回 `undefined` 表示"该形状无法表达"（调用方上报，不静默塞一个错的）。
 */
export function jsonSchemaNodeToDsh(node: unknown, report: UnsupportedReporter, where: string): DshValueSchema | undefined {
  const n = asNode(node);
  if (!n) return undefined;
  const description = asString(n.description);

  // `anyOf`/`oneOf`：本仓只由两种构造产生 —— `Union([String, Null])` 与 `Union(Literal…)`
  const branches = Array.isArray(n.anyOf) ? n.anyOf : Array.isArray(n.oneOf) ? n.oneOf : undefined;
  if (branches) {
    const consts = branches.map((b) => asNode(b)?.const);
    const nulls = branches.filter((b) => asNode(b)?.type === 'null').length;
    if (branches.length === 2 && nulls === 1) {
      report(`${where}`, 'pi 的 `Type.Union([String, Null])`（即 ToolParameter 的 string|null）在 DSH 只能表达为"可选 string"：显式 null 会被拒');
      return { type: 'string', ...(description ? { description } : {}) };
    }
    if (consts.every((c) => typeof c === 'string')) {
      return { type: 'string', enum: consts as string[], ...(description ? { description } : {}) };
    }
    report(`${where}`, `联合类型（anyOf/oneOf，${branches.length} 个分支）在 DSH 无直接对应`);
    return undefined;
  }

  switch (n.type) {
    case 'string':
      return { type: 'string', ...(description ? { description } : {}), ...(asStringArray(n.enum) ? { enum: asStringArray(n.enum) as string[] } : {}) };
    case 'number':
      return { type: 'number', ...(description ? { description } : {}) };
    case 'integer':
      return { type: 'integer', ...(description ? { description } : {}) };
    case 'boolean':
      return { type: 'boolean', ...(description ? { description } : {}) };
    case 'null':
      report(`${where}`, '纯 null 类型在 DSH 无实际用途');
      return undefined;
    case 'array': {
      const items = jsonSchemaNodeToDsh(n.items, report, `${where}.items`) ?? { type: 'json' };
      return { type: 'array', ...(description ? { description } : {}), items };
    }
    case 'object':
      report(`${where}`, '嵌套对象参数暂未映射（本仓当前没有工具用到；需要时再补 properties 递归）');
      return undefined;
    default: {
      // TypeBox 的 `Type.Unknown()` 产出空 schema（只有 description）⇒ 视为任意 lossless JSON
      if (n.type === undefined && !branches) return { type: 'json', ...(description ? { description } : {}) };
      report(`${where}`, `JSON Schema 类型 ${String(n.type)} 在 DSH 的 schema DSL 里没有对应分支`);
      return undefined;
    }
  }
}

/** pi 工具的参数根 schema（TypeBox 对象）→ DSH 参数表 */
export function toDshParametersFromJsonSchema(
  root: unknown,
  report: UnsupportedReporter = defaultReporter,
  toolName = '',
): DshParameterSchema {
  const n = asNode(root);
  const properties = asNode(n?.properties) ?? {};
  const required = new Set(asStringArray(n?.required) ?? []);
  const prefix = toolName ? `tool.${toolName}.parameters` : 'tool.parameters';
  const out: Record<string, DshParameterProperty> = {};
  for (const [name, child] of Object.entries(properties)) {
    // ★ 无法精确表达时**降级为 `{type:'json'}` 并上报**，而不是把参数丢掉：
    //   丢参数会改变工具的签名（模型看到的入参少了），比"类型放宽"更危险。
    const mapped = jsonSchemaNodeToDsh(child, report, `${prefix}.${name}`);
    if (!mapped) {
      report(`${prefix}.${name}`, '该参数类型无法精确映射到 DSH ⇒ 已降级为任意 JSON（保持参数存在、不改变签名）');
    }
    const value = mapped ?? { type: 'json' };
    out[name] = required.has(name) ? { ...value, required: true } : value;
  }
  return out;
}

/** pi 工具结果的宽松读法（内容块：`{type:'text', text}` / 其它块） */
interface PiResultLike {
  readonly content?: unknown;
  readonly details?: unknown;
}

interface PiContentBlockLike {
  readonly type?: unknown;
  readonly text?: unknown;
}

/** pi 工具执行返回的 `{content, details}` → DSH 的 canonical 字符串 + 文本块 */
function piResultToText(result: unknown, report: UnsupportedReporter, toolName: string): string {
  const r = (typeof result === 'object' && result !== null ? result : undefined) as PiResultLike | undefined;
  const content = r?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    // pi 允许工具返回 undefined/其它形状；DSH 要求 lossless JSON ⇒ 统一转成字符串并上报
    report(`tool.${toolName}.output`, `工具返回了非内容块形状（${typeof result}）⇒ 已转成字符串`);
    return result === undefined ? '' : JSON.stringify(result ?? '');
  }
  const texts: string[] = [];
  let others = 0;
  for (const block of content) {
    const b = (typeof block === 'object' && block !== null ? block : undefined) as PiContentBlockLike | undefined;
    if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    else others += 1;
  }
  if (others > 0) report(`tool.${toolName}.output`, `结果含 ${others} 个非文本块（DSH 侧统一按文本呈现，已忽略非文本块）`);
  return texts.join('\n');
}

/**
 * 构造 DSH 的工具定义载荷（**纯函数**，便于单测）。
 * 注意：**不注册**（注册由外观层做，因为需要 `ctx.tools` 与 disposer 管理）。
 */
export function toDshToolPayload(piDef: PiToolDefinition, options: ToDshToolOptions = {}): DshDefineToolOptions {
  const report = options.onUnsupported ?? defaultReporter;
  const definition = piDef as unknown as {
    name: string;
    description?: string;
    parameters?: unknown;
    exposure?: string;
    executionMode?: string;
    renderCall?: unknown;
    renderResult?: unknown;
    execute?: (...args: readonly unknown[]) => unknown;
  };

  if (definition.renderCall || definition.renderResult) {
    report(
      `tool.${definition.name}.render`,
      'pi 的 renderCall/renderResult 是终端 TUI 渲染回调；DSH 的表现层走 output.render / presentationMeta ⇒ 不迁移',
    );
  }
  if (definition.exposure && definition.exposure !== 'direct' && definition.exposure !== 'deferred') {
    report(`tool.${definition.name}.exposure`, `exposure=${definition.exposure} 在 DSH 无对应（只有 direct 与 deferLoading 两种落点）`);
  }

  const payload: DshDefineToolOptions = {
    name: definition.name,
    description: definition.description ?? definition.name,
    parameters: toDshParametersFromJsonSchema(definition.parameters, report, definition.name),
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown): DshContentBlock[] => [
        { type: 'text', text: typeof value === 'string' ? value : String(value) },
      ],
    },
    execute: async (args: unknown, exec: DshToolRunContext): Promise<unknown> => {
      const call = definition.execute;
      if (typeof call !== 'function') throw new Error(`工具 ${definition.name} 没有可执行的 execute`);
      // 复刻 pi 的调用签名：execute(toolCallId, params, signal, onUpdate, piCtx)
      const piCtx = options.piContext ?? { hasUI: false, cwd: undefined };
      const result = await call(exec.callId, args, exec.signal, undefined, piCtx);
      return piResultToText(result, report, definition.name);
    },
    ...(definition.exposure === 'deferred' ? { deferLoading: true as const } : {}),
    // 并发语义必须转发：不标 = 声明"可以并发"，而本仓部分工具持有非文件的共享可变状态
    // （Playwright page / tmux 会话 / 待办列表），并发会得到错结果（见 tool-adapter.ts 的说明）。
    ...(definition.executionMode === 'sequential' ? { isConcurrencySafe: (): boolean => false } : {}),
  };
  return payload;
}
