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

import bootstrap from '../../custom/bootstrap';
import { apply as applyFacade, inject, name } from '../../custom/adapters/dsh/plugin';
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
  return applyFacade(ctx, {
    ...(config.facade ?? {}),
    features: [
      (api) => {
        bootstrap(api as Parameters<typeof bootstrap>[0]);
      },
    ],
  });
}

export default apply;
