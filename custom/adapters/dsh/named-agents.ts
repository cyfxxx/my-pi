/**
 * 具名 agent → 宿主 `subagent` 工具实例（**默认关闭的可选能力**，DR-2 的落地）
 *
 * ## 为什么需要
 *
 * my-pi 的模型有"具名专员"（`scout` / `worker` / `reviewer` + 用户目录里的自定义 agent）：
 * 名字 → 人设（系统提示）+ 工具权限（例如只读）。换到 DSH 后，宿主的 `subagent` 工具**没有 agent 参数**
 * （只有 `prompt`/`description`/`provider`/`model`/…），所以"这次委派给谁"表达不出来 —— 这是 DR-2 记的缺口。
 *
 * 宿主其实提供了两个零件，只是要**按 agent 各装一个工具实例**才能用上：
 * `@deepseek-ai/dsh-tool-subagent` 的 Config 支持 `toolName`（每实例必须不同）、`persona`、
 * `toolFilter {allow,deny}`、`agentOptions`、`maxDepth`。⇒ 每个具名 agent 变成一个**模型可见工具**
 * （例如 `scout`），工具名本身承载"给谁"。
 *
 * ## 为什么默认关闭
 *
 * 每多一个具名 agent 就多一个**模型可见工具**：工具面变大、token 变贵、模型选择变噪。
 * 本项目对工具面有预算纪律，宿主也刻意保持精简 ⇒ 这条能力**必须显式打开**（见 `MyPiDshConfig.namedAgents`），
 * 打开后还有 `maxTools` 上限与逐条"跳过原因"上报（不静默）。
 *
 * ## 边界（如实标注）
 *
 * - 只映射能在宿主上表达的字段：`persona`（人设）、`toolFilter`（工具权限）、`model`（若形如 `provider/model`）。
 * - `chain`/`{previous}` 不在这里（宿主 `workflow` 工具已覆盖，见能力审计 DR-1）。
 * - 该项目级目录约定是 `<cwd>/.pi/agents`（沿用 my-pi 原有发现逻辑），不做另起一套。
 */

import { READONLY_ALLOWED_TOOLS } from '../../features/subagent/core/helpers';
import type { AgentConfig } from '../../features/subagent/core/agents';

/** 单个具名 agent → 一个宿主工具实例的规划结果 */
export interface NamedAgentToolPlan {
  /** 暴露给模型的工具名（已规范化；可能与 agent 名不同，见 `sourceName`） */
  readonly toolName: string;
  /** 原始 agent 名（用于上报） */
  readonly sourceName: string;
  /** 传给 `dsh-tool-subagent` 的配置（形状与宿主 Config 对齐，只放能表达的字段） */
  readonly config: {
    readonly provider: string;
    readonly toolName: string;
    readonly persona: string;
    readonly toolFilter?: { readonly allow?: readonly string[] };
    readonly agentOptions?: { readonly model: string };
  };
  /** 人设是否被截断（长 prompt 会显著抬升每个子代理的输入成本） */
  readonly personaTruncated: boolean;
}

/** 被跳过的 agent（**必须上报**，否则就是静默少能力） */
export interface NamedAgentSkip {
  readonly name: string;
  readonly reason: string;
}

export interface NamedAgentPlan {
  readonly tools: readonly NamedAgentToolPlan[];
  readonly skipped: readonly NamedAgentSkip[];
}

export interface NamedAgentPlanOptions {
  /** 宿主 provider 名（`spawn`/`fork`/…；由部署层决定） */
  readonly provider: string;
  /** 最多注册几个（工具面纪律；默认 6） */
  readonly maxTools?: number;
  /** 已经存在的工具名（避免撞名；含宿主核心工具与我们自己注册的） */
  readonly reserved?: Iterable<string>;
  /** 工具名前缀（建议留空；想要 `agent-scout` 这种就传 `agent-`） */
  readonly toolNamePrefix?: string;
  /** 人设截断上限（字符；默认 8000） */
  readonly personaMaxChars?: number;
}

const DEFAULT_MAX_TOOLS = 6;
const DEFAULT_PERSONA_MAX = 8000;
/** 宿主工具名习惯：小写 + 数字 + `-`/`_`，且以字母开头 */
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * 把 agent 名规范成工具名：小写、非 `[a-z0-9_-]` 折叠成 `-`、去首尾 `-`；
 * 仍然不以字母开头则视为不可用（返回 undefined，由调用方记跳过）。
 */
export function toToolName(rawName: string, prefix = ''): string | undefined {
  const folded = rawName
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!folded) return undefined;
  const withPrefix = `${prefix}${folded}`;
  return TOOL_NAME_RE.test(withPrefix) ? withPrefix : undefined;
}

/** 只读 agent 的允许列表：沿用 my-pi 的判据（`features/subagent/core/helpers.ts` 的 `READONLY_ALLOWED_TOOLS`） */
function filterFor(agent: AgentConfig): { allow?: readonly string[] } | undefined {
  if (agent.readonly) return { allow: [...READONLY_ALLOWED_TOOLS] };
  if (agent.tools && agent.tools.length > 0) return { allow: [...agent.tools] };
  return undefined;
}

/**
 * 纯规划：agent 定义 → 宿主工具实例计划（不碰 ctx，纯函数便于单测）。
 *
 * @param agents 发现到的 agent（`discoverAgents()` 的结果）
 * @param options provider / 上限 / 保留名 / 前缀 / 截断
 */
export function planNamedAgentTools(
  agents: readonly AgentConfig[],
  options: NamedAgentPlanOptions,
): NamedAgentPlan {
  const maxTools = options.maxTools ?? DEFAULT_MAX_TOOLS;
  const personaMaxChars = options.personaMaxChars ?? DEFAULT_PERSONA_MAX;
  const prefix = options.toolNamePrefix ?? '';
  const reserved = new Set(options.reserved ?? []);
  const used = new Set<string>(reserved);
  const tools: NamedAgentToolPlan[] = [];
  const skipped: NamedAgentSkip[] = [];

  for (const agent of agents) {
    const toolName = toToolName(agent.name, prefix);
    if (!toolName) {
      skipped.push({ name: agent.name, reason: '名字规范化后不是合法工具名（需以字母开头，仅含 a-z0-9_-）' });
      continue;
    }
    if (reserved.has(toolName)) {
      skipped.push({ name: agent.name, reason: `工具名 "${toolName}" 与已有工具同名（改名或用 toolNamePrefix）` });
      continue;
    }
    if (used.has(toolName)) {
      skipped.push({ name: agent.name, reason: `工具名 "${toolName}" 与另一个 agent 冲突` });
      continue;
    }
    const personaRaw = agent.systemPrompt?.trim() ?? '';
    if (!personaRaw) {
      skipped.push({ name: agent.name, reason: '人设为空（md 正文为空）⇒ 会让子代理行为退化，跳过' });
      continue;
    }
    if (tools.length >= maxTools) {
      skipped.push({ name: agent.name, reason: `超过本次注册上限 maxTools=${maxTools}` });
      continue;
    }
    const personaTruncated = personaRaw.length > personaMaxChars;
    const persona = personaTruncated ? `${personaRaw.slice(0, personaMaxChars)}\n…（人设已截断）` : personaRaw;
    const toolFilter = filterFor(agent);
    // `model` 只在形如 `provider/model` 时才传：宿主的 agentOptions.model 是"由所选 provider 解释的模型 id"，
    // 直接塞一个裸名字可能让子代理路由失败 —— 宁可**不传**（用宿主默认），并在文档里说明。
    const model = typeof agent.model === 'string' && /^[^/\s]+\/[^/\s]+$/.test(agent.model) ? agent.model : undefined;
    tools.push({
      toolName,
      sourceName: agent.name,
      personaTruncated,
      config: {
        provider: options.provider,
        toolName,
        persona,
        ...(toolFilter ? { toolFilter } : {}),
        ...(model ? { agentOptions: { model } } : {}),
      },
    });
    used.add(toolName);
  }
  return { tools, skipped };
}

/** 注册结果（逐条成功/失败，绝不"整批成功或整批静默"） */
export interface NamedAgentRegistrationResult {
  readonly registered: readonly string[];
  readonly failed: readonly { readonly toolName: string; readonly reason: string }[];
}

/**
 * 把计划落地：每个 agent 装一个宿主 `dsh-tool-subagent` 实例。**同步**。
 *
 * ★ 为什么必须同步：`apply()` 一旦改成 async，cordis 装载后工具**在全局 `tools.schemas()` 里看不见**
 *   （实测 54 → 0；直接 `await apply()` 又正常）⇒ 具名工具会在第一次模型请求时缺席。
 *   所以宿主模块在**模块加载期**用顶层 await + try/catch 取好，这里只做同步装载。
 *
 * @param ctx cordis 上下文（宿主里是活的那个）
 * @param plan  `planNamedAgentTools()` 的结果
 * @param toolSubagentModule 宿主 `dsh-tool-subagent` 插件模块；`null` = 该部署没装（逐条报失败，不假装）
 */
export function registerNamedAgentTools(
  ctx: { plugin: (module: unknown, config?: unknown) => unknown; inject?: (deps: readonly string[], cb: (child: unknown) => void) => unknown },
  plan: NamedAgentPlan,
  toolSubagentModule: unknown | null,
  options: { readonly inject?: readonly string[] } = {},
): NamedAgentRegistrationResult {
  const registered: string[] = [];
  const failed: { toolName: string; reason: string }[] = [];
  if (plan.tools.length === 0) return { registered, failed };
  if (!toolSubagentModule) {
    const reason = '该部署没有 @deepseek-ai/dsh-tool-subagent（宿主的 subagent 工具包未安装）';
    return { registered, failed: plan.tools.map((t) => ({ toolName: t.toolName, reason })) };
  }
  // ★ 关键：宿主的工具插件自己 inject 了 `tools/subagents/systemPrompt/sessionProjections`
  //   （`dsh-tool-subagent/lib/index.js:246-251`）。**必须**用 `ctx.inject([...], child => child.plugin(...))`
  //   把它装在一个"这几个服务可见"的子上下文里 —— 直接在自己的 ctx 上 `plugin()` 的话，
  //   它只会**静默不激活**（缺注入 ⇒ 不报错、也不出现在工具面）。这正是"乐观上报"的来源。
  const services = options.inject ?? ['tools', 'subagents', 'systemPrompt', 'sessionProjections'];
  const load = (target: { plugin: (module: unknown, config?: unknown) => unknown }): void => {
    for (const item of plan.tools) {
      try {
        target.plugin(toolSubagentModule, item.config);
        registered.push(item.toolName);
      } catch (error) {
        // ★ 逐条隔离：一个失败不能带走其余（同 registerTool/registerCommand 的教训，见 BUG-REPLAYS #41）
        failed.push({ toolName: item.toolName, reason: (error as Error).message });
      }
    }
  };
  if (typeof ctx.inject === 'function') ctx.inject(services, (child) => load(child as { plugin: typeof load extends never ? never : (module: unknown, config?: unknown) => unknown }));
  else load(ctx);
  return { registered, failed };
}
