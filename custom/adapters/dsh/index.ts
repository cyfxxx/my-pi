/**
 * DSH 侧适配层入口。
 *
 * 分层（与 `custom/adapters/README.md` 的约定一致）：
 *   - `types.ts`   DSH 契约的**本地最小快照**（不依赖 `@deepseek-ai/*` 包，RC 变动只改这里）
 *   - `events.ts`  18 个 pi 钩子事件 → DSH 事件的**数据化映射表**（带档位）
 *   - `tool.ts`    内部 `ToolDefinition` → DSH `defineTool` 载荷（**通用合成 output**）
 *   - `hooks.ts`   pi 形状处理器 → DSH waterfall 监听器（含决策翻译与"无等价物"上报）
 *   - `facade.ts`  DSH `Context` → pi 形状 API（`bootstrap.ts` 因此可以一行不改）
 *   - `plugin.ts`  DSH/cordis 插件入口（`apply(ctx, config)`）
 */

export { createDshExtensionApi, type DshFacade, type DshFacadeOptions, type SurfaceEntry, type SurfaceStatus } from './facade';
export { PI_TO_DSH_EVENTS, assertEventsMapped, mappingSummary, resolveDshEvent, type DshEventMapping, type MappingTier } from './events';
export { makeDshListener, mapToolCallDecision, mapToolResultDecision, toPiToolCallEvent, type HookBridgeContext, type PiHookHandler } from './hooks';
export { jsonSchemaNodeToDsh, toDshParametersFromJsonSchema, toDshToolPayload, type ToDshToolOptions, type UnsupportedReporter } from './tool';
export { apply, inject, name, type MyPiDshConfig } from './plugin';
export type { DshContext, DshDefineToolOptions, DshDisposer, DshToolRegistry, DshValueSchema } from './types';
