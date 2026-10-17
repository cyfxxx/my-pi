/**
 * DSH 插件入口（**可打包产物**）：把 my-pi 的全部特性挂到 DSH 上。
 *
 * 与 `custom/adapters/dsh/plugin.ts` 的分工：
 *   - `plugin.ts` 是**机制**（`apply(ctx, config)`，特性列表由调用方传入，便于测试/增量迁移）；
 *   - 本文件是**产品入口**：把 `custom/bootstrap.ts` 的全量特性固定进来，交给 esbuild 打成
 *     单个 ESM 产物（`dsh/plugin/dist/my-pi-plugin.mjs`），DSH profile 直接引用它。
 *
 * 为什么"全量"在这里是安全的：`custom/adapters/dsh/pi-shims/` 已经让 pi 包 specifier 有等价物，
 * 于是 ui-adapter/session-adapter 不再需要 pi 的包（实测：别名到 shim 后全量 bootstrap 仍
 * 注册 54 个工具、0 个特性失败）。
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineTool } from '@deepseek-ai/dsh-tools';

import bootstrap from '../../custom/bootstrap';
import { apply as applyFacade, inject, name } from '../../custom/adapters/dsh/plugin';
import { registerMyPiSystemPrompt } from '../../custom/adapters/dsh/system-prompt';
import { listDshSessions } from '../../custom/adapters/dsh/session-list';
import { auditSubagentCapacity } from '../../custom/adapters/dsh/subagent-capacity';
import { planNamedAgentTools, registerNamedAgentTools } from '../../custom/adapters/dsh/named-agents';
import { discoverAgents } from '../../custom/features/subagent/core/agents';
import { setSessionLister } from '../../custom/adapters/session-adapter';
import type { DshContext } from '../../custom/adapters/dsh/types';
import { getDshService } from '../../custom/adapters/dsh/service';
import type { DshFacade } from '../../custom/adapters/dsh/facade';

export { inject, name };

/**
 * 宿主的 `subagent` 工具插件模块（可选项"具名 agent 工具"要用）。
 *
 * 在**模块加载期**取一次：拿得到就同步装载成"每个 agent 一个工具实例"；
 * 拿不到（该部署没装这个包）置 null ⇒ 打开开关时会**逐条报失败**，而不是假装注册成功。
 * 用 try/catch 包住是刻意的：这条可选能力**不该**让整个插件装载失败。
 */
let hostToolSubagent: unknown | null = null;
try {
  const mod = (await import('@deepseek-ai/dsh-tool-subagent')) as unknown as { default?: unknown };
  hostToolSubagent = mod?.default ?? mod;
} catch {
  hostToolSubagent = null;
}

/** 与 `custom/adapters/dsh/plugin.ts` 的配置同形（DSH 的 patch 条目 config 会原样传进来） */
export interface MyPiPluginConfig {
  readonly facade?: Parameters<typeof applyFacade>[1] extends { facade?: infer F } ? F : never;
  /**
   * my-pi 仓库根目录（**强烈建议显式给**）。
   * 缺省按"产物位置上溯三级"猜（`dsh/plugin/dist/` → 仓库根），只在"仓库就在本机且布局未变"时成立；
   * 正式部署请用 patch 条目的 `config.root` 或环境变量 `MY_PI_ROOT` 指定。
   */
  readonly root?: string;
  /**
   * **具名 agent → 宿主 `subagent` 工具实例**（可选项，**默认关闭**；能力审计 DR-2）。
   *
   * 打开后：my-pi 的每个 agent（`<agent dir>/agents/*.md` 与 `<cwd>/.pi/agents/*.md`）会变成一个
   * **模型可见工具**（工具名 = 规范化后的 agent 名），携带它的 `persona` 与工具权限（只读 agent 自动限到 read/grep/find/ls）。
   *
   * 为什么默认关：每多一个 agent 就多一个模型可见工具 ⇒ 工具面/token 成本上升、模型选择变噪。
   * 本项目对工具面有预算纪律 ⇒ 必须显式打开，并用 `maxTools` 限总量；**跳过的每一条都会打原因**。
   */
  readonly namedAgents?: {
    /** 打开开关（`true` 才注册；缺省/`false` = 完全不碰工具面） */
    readonly enabled?: boolean;
    /** 发现范围（默认 `both`：用户目录 + 最近的项目 `.pi/agents`） */
    readonly scope?: 'user' | 'project' | 'both';
    /** 最多注册几个（默认 6） */
    readonly maxTools?: number;
    /** 宿主 provider 名（默认 `spawn`） */
    readonly provider?: string;
    /** 工具名前缀（默认空；建议留空，撞名时有上报） */
    readonly toolNamePrefix?: string;
    /** 人设截断上限（默认 8000 字符） */
    readonly personaMaxChars?: number;
  };
}

/**
 * 解析仓库根：`config.root` → `MY_PI_ROOT` → 产物位置上溯三级（`dsh/plugin/dist/…` → 仓库根）。
 *
 * 为什么不能只靠"上溯"：`custom/core/config.ts` 的 `getProjectRoot()` 在**打包后**
 * `import.meta.url` 指向产物；见那里的注释（实测产生过 `dsh/portable/agent/` 脏目录）。
 */
function resolveRoot(config: MyPiPluginConfig): string {
  if (config.root) return resolve(config.root);
  if (process.env.MY_PI_ROOT) return resolve(process.env.MY_PI_ROOT);
  return resolve(fileURLToPath(new URL('../../../', import.meta.url)));
}

/**
 * DSH/cordis 插件入口。
 *
 * `bootstrap()` 内部按启动模式过滤特性（`isFeatureEnabled`），并**逐个 try/catch**：
 * 单个特性注册失败不会拖垮其余，但会打印（不静默）。
 *
 * **★ 必须保持同步**：实测把 `apply` 改成 `async` 后，**工具在全局 `tools.schemas()` 里看不见**
 * （经 cordis 装载 54 → 0；直接 `await apply()` 又正常）。可选项"具名 agent 工具"需要的宿主模块
 * 因此在**模块加载期**用顶层 await + try/catch 取好（见下方 `hostToolSubagent`），apply 里只做同步装载。
 */
export function apply(ctx: DshContext, config: MyPiPluginConfig = {}): DshFacade {
  // 把根目录与两个运行时目录显式钉住（**只在未设置时**设，尊重部署侧的显式配置）。
  // my-pi.sh 在 shell 侧做的是同一件事（PI_CODING_AGENT_DIR / PI_MEMORY_DIR）。
  const root = resolveRoot(config);
  if (!process.env.MY_PI_ROOT) process.env.MY_PI_ROOT = root;
  if (!process.env.PI_CODING_AGENT_DIR) process.env.PI_CODING_AGENT_DIR = resolve(root, 'portable/agent');
  if (!process.env.PI_MEMORY_DIR) process.env.PI_MEMORY_DIR = resolve(root, 'portable/memory');
  const facade = applyFacade(ctx, {
    // ★ 必须注入：`ctx.tools.register()` 要的是 `defineTool(options)` 的**编译产物**
    //   （spec → 模型侧 JSON Schema）；不注入会被真实 provider 拒掉每个请求。
    compileTool: defineTool as never,
    // ★ facade 选项必须**嵌在 `facade:` 下**（`MyPiDshConfig` 的字段是 `compileTool` / `facade` / `features`）。
    //   原先这里写的是 `...(config.facade ?? {})`（把 facade 选项摊在**顶层**）⇒ 部署方在 profile 里写的
    //   `config.facade.*` 会被**静默忽略**（只有 `compileTool` 侥幸还能命中）。这是"配置看起来生效、实际没生效"
    //   那类静默失效，2026-10-18 加 `commandNameMap` 时被 TS 当场拦下才发现。
    facade: {
      // 宿主已占用 `plan`（DSH 自己的建议式计划模式）⇒ 把 my-pi 的 `plan` 命令**换名注册**为 `mypi-plan`，
      // 从而保住它的子命令面（enter/exit/resume/todos/plans/clear/help）与 `clear`/`resume` 那两条
      // 计划落盘/续跑路径 —— 不靠改 feature（feature 不认识 DSH）。
      // 工具**不**做这种重映射：工具名对模型可见，改名会改变模型行为，那是另一个决策
      // （`web_search` 就是走 feature 侧改名 + 重过声明面基线，见 DSH-DUPLICATE-CAPABILITY-AUDIT.md）。
      // 部署方可用 `config.facade.commandNameMap` 覆盖（展开顺序：默认在前、部署方在后）。
      commandNameMap: { plan: 'mypi-plan' },
      ...(config.facade ?? {}),
    },
    features: [
      (api) => {
        bootstrap(api as Parameters<typeof bootstrap>[0]);
      },
    ],
  });
  // 静态 system 注入（pi 的 APPEND_SYSTEM.md 语义）——不接这一步，那段指令在 DSH 上根本不会出现，
  // 而且**不会报错**；disposer 交给 facade 统一回收。
  // 会话枚举：把底座实现注入 session-adapter（pi 路径不变；不注入的话 DSH 上会走 pi shim 返回空表）
  setSessionLister(async (cwd?: string) => {
    const listed = listDshSessions(ctx, cwd);
    return listed.success ? { success: true, data: listed.data } : { success: false, error: listed.error };
  });
  facade.disposers.push(() => setSessionLister(undefined));

  facade.disposers.push(
    registerMyPiSystemPrompt(ctx, {
      root,
      report: (member, detail) => console.warn(`[my-pi-dsh] ${member}：${detail}`),
    }),
  );
  // 子代理并发核对（**只读 + 明确报警**）：移动端上宿主默认允许 8 个并发子代理，而 my-pi 的移动端上限是 2。
  // 宿主的 maxActiveSubagents 是 Volatile（契约：只有其拥有者可写）⇒ 我们改不动，那就**别静默**：
  // 读出来、说清楚、给出部署层改法（完整理由与"做不到什么"见 custom/adapters/dsh/subagent-capacity.ts）。
  try {
    const audit = auditSubagentCapacity(getDshService(ctx, 'subagents'));
    const line = `[my-pi-dsh] subagent 并发：${audit.note}`;
    if (audit.tooHigh) console.warn(line);
    else console.log(line);
  } catch (error) {
    console.warn(`[my-pi-dsh] subagent 并发核对失败（不影响启动）：${String(error)}`);
  }

  // ── 可选项：具名 agent → 宿主 subagent 工具实例（**默认关闭**，DR-2）──────────────
  // 开关打开才动工具面；上限/撞名/空人设等**逐条给原因**（不静默少能力）。
  if (config.namedAgents?.enabled) {
    try {
      const scope = config.namedAgents.scope ?? 'both';
      const discovered = discoverAgents(process.cwd(), scope);
      // ★ 必须用 getDshService()：直接 `ctx.tools` 在 cordis 里会抛 `cannot get property "tools" without inject`
      //   （同一个坑在 A18 就踩过；本次真 Host 又踩了一次，所以只走这一条安全入口）。
      const toolsService = getDshService(ctx, 'tools') as
        | { schemas?: () => readonly { name?: string }[] }
        | undefined;
      const existing = new Set<string>(
        (toolsService?.schemas?.() ?? []).map((t) => t?.name ?? '').filter(Boolean),
      );
      for (const name of facade.registrationSummary().tools) existing.add(name);
      const plan = planNamedAgentTools(discovered.agents, {
        provider: config.namedAgents.provider ?? 'spawn',
        ...(config.namedAgents.maxTools !== undefined ? { maxTools: config.namedAgents.maxTools } : {}),
        ...(config.namedAgents.toolNamePrefix !== undefined ? { toolNamePrefix: config.namedAgents.toolNamePrefix } : {}),
        ...(config.namedAgents.personaMaxChars !== undefined ? { personaMaxChars: config.namedAgents.personaMaxChars } : {}),
        reserved: existing,
      });
      const result = registerNamedAgentTools(
        ctx as unknown as {
          plugin: (module: unknown, config?: unknown) => unknown;
          inject?: (deps: readonly string[], cb: (child: unknown) => void) => unknown;
        },
        plan,
        hostToolSubagent,
      );
      // ★ 上报必须**行为验证**，而且要**延后一拍**：`ctx.inject(deps, cb)` 的回调是异步落地的，
      //   在 apply 里立刻读 `tools.schemas()` 会读到"还没装进去"的状态（实测把"成功 2 个"误报成"可见 0 个"）。
      //   所以这里 setTimeout(0) 后再算，并把"注册调用成功"与"工具面真的可见"分开报。
      setTimeout(() => {
        try {
          // ★ 计数也必须在**回调里**取：`result` 的数组是 `ctx.inject` 回调落地后才被填充的
          //   （在 apply 里取会永远是 0 —— 实测把 2/2 误报成"注册 0 / 可见 2"）。
          const registeredCount = result.registered.length;
          const visibleNames = new Set<string>(
            (getDshService(ctx, 'tools') as { schemas?: () => readonly { name?: string }[] } | undefined)
              ?.schemas?.()
              ?.map((t) => t?.name ?? '') ?? [],
          );
          const visible = result.registered.filter((n) => visibleNames.has(n));
          const okList = visible.length ? visible.join(', ') : '（无）';
          console.log(`[my-pi-dsh] 具名 agent 工具：**工具面可见** ${visible.length} 个（${okList}）`
            + `${plan.skipped.length ? `；跳过 ${plan.skipped.length} 个（${plan.skipped.map((sk) => `${sk.name}: ${sk.reason}`).join('；')}）` : ''}`
            + `${result.failed.length ? `；装载失败 ${result.failed.length} 个（${result.failed.map((f) => `${f.toolName}: ${f.reason}`).join('；')}）` : ''}`
            + `｜注册调用成功=${registeredCount}｜发现范围=${scope}`);
          if (visible.length !== registeredCount) {
            console.warn('[my-pi-dsh] 具名 agent：注册调用与工具面可见数不一致 ⇒ 缺注入/宿主拒绝（不假装成功）');
          }
        } catch {
          /* 自检失败绝不影响启动 */
        }
      }, 0);
    } catch (error) {
      console.warn(`[my-pi-dsh] 具名 agent 注册失败（不影响启动）：${String(error)}`);
    }
  }

  // 诊断汇总（`MY_PI_DSH_TRACE_EVENTS=1` 才打）：把"到底注册成功了多少 / 哪些因同名冲突被跳过"
  // 变成**可核对的一行**。为什么需要：DSH 原生会占用同名工具/命令，而"跳过"如果不可见，
  // 就变成静默少能力（2026-10-18 Host 冒烟实测过连带损失，见 custom/adapters/dsh/facade.ts）。
  if (process.env.MY_PI_DSH_TRACE_EVENTS === '1') {
    const summary = facade.registrationSummary();
    console.log(
      `[my-pi-dsh] trace 注册汇总：工具 ${summary.tools.length} 个、命令 ${summary.commands.length} 个`
        + `（${summary.commands.join(', ')}）；`
        + `同名冲突跳过 ${summary.skippedDuplicates.length} 个`
        + `${summary.skippedDuplicates.length > 0 ? `（${summary.skippedDuplicates.join(', ')}）` : ''}；`
        + `钩子 ${summary.hooks.length} 个（${summary.hooks.join(', ')}）`,
    );
  }
  return facade;
}

export default apply;
