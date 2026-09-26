/**
 * Plan-mode Feature — 纯逻辑 barrel
 *
 * 实现按职责分组：core/（state/store/selectors/readonly）、ui/（view/overlay）。
 */
export * from './core/state';
export * from './core/store';
export * from './core/selectors';
export * from './core/readonly';
export * from './ui/view';
// core/plans 与 ui/view 存在历史重复导出（renderPlanFile/parsePlanFile），
// 故按名导出活跃计划查找，避免 `export *` 产生歧义导出。
export { findActivePlan } from './core/plans';
export type { ActivePlan } from './core/plans';
