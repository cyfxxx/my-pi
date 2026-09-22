/**
 * 工具分层运行态（feature 内部模块）
 *
 * 持有启用组状态并调用适配器切换活跃工具。位于 features 下但 import 的是
 * 本地适配器（非 Pi 包），符合隔离约束（check-isolation 检查 3/4）。
 */

import type { PiApi } from '../../../adapters/ui-adapter';
import { getAllToolNames, getActiveTools, setActiveTools } from '../../../adapters/ui-adapter';
import { CORE_TOOLS, SLEEPING_GROUPS, computeActiveTools, buildSleepingSummary } from './tool-groups';

/** 已启用工具组（进程内存态，重启恢复默认分层） */
export const enabledGroups = new Set<string>();

/** 应用工具分层：全部注册工具减去未启用休眠组的工具 */
export function applyToolLayering(pi: PiApi): void {
  const all = getAllToolNames(pi);
  setActiveTools(pi, computeActiveTools(all, enabledGroups));
}

/** 是否存在"已启用但处于休眠名单"的工具（用于计划模式退出等场景自愈） */
export function dormantToolsActive(pi: PiApi): boolean {
  const current = new Set(getActiveTools(pi));
  return SLEEPING_GROUPS.some((g) => !enabledGroups.has(g.name) && g.tools.some((t) => current.has(t)));
}

/** 启用某个休眠组，返回结果说明 */
export function enableGroup(pi: PiApi, name: string): { ok: boolean; message: string } {
  const group = SLEEPING_GROUPS.find((g) => g.name === name);
  if (!group) {
    return { ok: false, message: `未知工具组: ${name || '(空)'}。可用组: ${SLEEPING_GROUPS.map((g) => g.name).join(', ')}` };
  }
  if (enabledGroups.has(group.name)) {
    return { ok: true, message: `工具组 ${group.name} 已在启用状态（${group.tools.join(', ')}），无操作。` };
  }
  enabledGroups.add(group.name);
  applyToolLayering(pi);
  return {
    ok: true,
    message: `已启用工具组 ${group.name}: ${group.tools.join(', ')}。本会话内保持可用；重启 pi 后恢复默认分层。`,
  };
}

/** 生成 /tools list 报告 */
export function buildToolsReport(pi: PiApi): string {
  const active = new Set(getActiveTools(pi));
  const lines = ['## 工具分层状态'];
  lines.push(`核心常驻（${CORE_TOOLS.length}）: ${CORE_TOOLS.join(', ')}`);
  for (const g of SLEEPING_GROUPS) {
    const state = enabledGroups.has(g.name) ? '已启用' : '休眠';
    lines.push(`- ${g.name} [${state}]（${g.tools.length}）: ${g.tools.join(', ')}`);
  }
  lines.push(`当前活动工具: ${active.size} 个`);
  return lines.join('\n');
}

export { buildSleepingSummary };
