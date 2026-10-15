/**
 * DSH/cordis 插件入口：`apply(ctx, config)`。
 *
 * ## 为什么特性注册函数**由调用方传入**，而不是在这里 `import bootstrap`
 *
 * `custom/bootstrap.ts` 会静态 import 全部 13 个特性；其中多数特性（memory/context/plan-mode/…）
 * 经 `custom/adapters/ui-adapter.ts` 或 `session-adapter.ts` **运行时** import pi 的包
 * （`@earendil-works/pi-tui` 的 TUI 组件、`pi-coding-agent` 的 `SessionManager`）。
 * 在只有 DSH 的部署里这些包不存在 ⇒ **静态 import 会直接崩**，而不是"优雅降级"。
 *
 * 因此本插件的契约是"**迁移到哪一步，就传哪些特性**"：
 *
 * ```ts
 * import { apply } from './custom/adapters/dsh';
 * import { register as registerWebSearch } from './custom/features/web-search';
 * export const plugin = (ctx) => apply(ctx, { features: [registerWebSearch] });
 * ```
 *
 * 这与项目纪律一致：**不假装整体已迁移**——`surfaceReport()` 会如实列出当前哪些 pi 面
 * 没有等价物，未传入的特性就是"尚未迁移"。
 *
 * ## 下一步（已登记的缺口 ✗）
 *
 * 让 `ui-adapter` / `session-adapter` 不再运行时 import pi 包（改为注入 UI 原语与资源解析器），
 * 之后才能 `apply(ctx, { features: [ …全部 ] })`。详见 `docs/design/DSH-MIGRATION-PLAN.md` P5。
 */

import { createDshExtensionApi, type DshFacade, type DshFacadeOptions } from './facade';
import type { DshContext } from './types';

/** cordis 插件名（DSH profile 里引用它） */
export const name = 'my-pi';

/** 声明依赖的服务：`tools`（缺它时工具面不可用，`surfaceReport()` 会如实标注） */
export const inject = ['tools'];

export interface MyPiDshConfig {
  /** 已迁移的特性注册函数（`(api: ExtensionAPI) => void`） */
  readonly features?: readonly ((api: unknown) => void)[];
  /** 外观层选项（上报通道、hasUI、cwd、事件落点覆盖…） */
  readonly facade?: DshFacadeOptions;
}

/**
 * 插件入口。返回 facade（含 `dispose()` 与 `surfaceReport()`），便于调用方在测试/HMR 里收尾。
 */
export function apply(ctx: DshContext, config: MyPiDshConfig = {}): DshFacade {
  const facade = createDshExtensionApi(ctx, config.facade ?? {});
  for (const register of config.features ?? []) {
    try {
      register(facade.api);
    } catch (error) {
      // 单个特性注册失败不拖垮其余（与 custom/core/registry.ts 的 registerAll 同策略），
      // 但**必须打印**：静默吞掉会让"没迁移"看起来像"迁移好了"。
      console.error('[dsh-plugin] 特性注册失败:', error);
    }
  }
  return facade;
}
