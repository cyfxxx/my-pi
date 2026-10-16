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
import { setSessionLister } from '../../custom/adapters/session-adapter';
import type { DshContext } from '../../custom/adapters/dsh/types';
import type { DshFacade } from '../../custom/adapters/dsh/facade';

export { inject, name };

/** 与 `custom/adapters/dsh/plugin.ts` 的配置同形（DSH 的 patch 条目 config 会原样传进来） */
export interface MyPiPluginConfig {
  readonly facade?: Parameters<typeof applyFacade>[1] extends { facade?: infer F } ? F : never;
  /**
   * my-pi 仓库根目录（**强烈建议显式给**）。
   * 缺省按"产物位置上溯三级"猜（`dsh/plugin/dist/` → 仓库根），只在"仓库就在本机且布局未变"时成立；
   * 正式部署请用 patch 条目的 `config.root` 或环境变量 `MY_PI_ROOT` 指定。
   */
  readonly root?: string;
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
